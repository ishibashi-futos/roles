import { logger } from "../../shared/logger";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import { getLlmTimeoutMsFromEnv } from "../../shared/llm/openai-compatible-client";
import type { WorkflowSession } from "../../shared/workflow-types";
import type { RequirementAgent } from "./requirement-agent";
import type { SessionTitleAgent } from "./session-title-agent";

type Phase1ServiceOptions = {
  maxUserReplyCount?: number;
  staleProcessingTimeoutMs?: number;
};

export class Phase1Service {
  private readonly maxUserReplyCount: number;
  private readonly staleProcessingTimeoutMs: number;

  constructor(
    private readonly store: WorkflowSessionRepository,
    private readonly requirementAgent: RequirementAgent,
    private readonly sessionTitleAgent: SessionTitleAgent,
    options: Phase1ServiceOptions = {},
  ) {
    this.maxUserReplyCount = options.maxUserReplyCount ?? 4;
    this.staleProcessingTimeoutMs =
      options.staleProcessingTimeoutMs ??
      Math.max(getLlmTimeoutMsFromEnv() * 2, 120_000);
  }

  async createSession(topic: string) {
    const title = await this.generateSessionTitle({
      topic,
      userMessages: [topic],
    });
    const session = this.store.createSession({ title, topic });
    logger.info("Phase1 session created", {
      sessionId: session.id,
      title,
      topic,
    });
    void this.process(session.id);
    return session;
  }

  async createSessionFromExistingChat(sessionId: string, message: string) {
    const session = this.getLatestSession(sessionId);

    if (!session) {
      throw new Error("session_not_found");
    }

    if (session.phase1.status !== "completed" || !session.phase1.result) {
      throw new Error("session_phase1_not_completed");
    }

    const title = await this.generateSessionTitle({
      topic: session.topic,
      userMessages: [
        ...session.phase1.messages
          .filter((entry) => entry.role === "user")
          .map((entry) => entry.content),
        message,
      ],
      requirementTheme: session.phase1.result.requirements.theme,
      requirementObjective: session.phase1.result.requirements.objective,
      forkMessage: message,
    });

    const nextSession = this.store.createSessionFromPhase1Messages({
      title,
      topic: session.topic,
      messages: [
        ...session.phase1.messages,
        { role: "user", content: message },
      ],
      userReplyCount: 1,
    });

    logger.info("Phase1 follow-up session created", {
      sourceSessionId: sessionId,
      newSessionId: nextSession.id,
      title,
      messageLength: message.length,
    });
    void this.process(nextSession.id);
    return nextSession;
  }

  submitReply(sessionId: string, message: string) {
    const session = this.getLatestSession(sessionId);

    if (!session) {
      throw new Error("session_not_found");
    }

    if (
      session.phase1.status !== "collecting_requirements" &&
      !(
        session.phase1.status === "completed" &&
        session.phase2.status === "idle"
      )
    ) {
      throw new Error("session_not_collecting");
    }

    if (session.phase1.isProcessing) {
      throw new Error("session_processing");
    }

    if (session.phase1.status === "completed") {
      this.store.reopenPhase1(sessionId, 0);
    }

    this.store.appendPhase1UserMessage(sessionId, message);
    logger.info("Phase1 reply accepted", {
      sessionId,
      messageLength: message.length,
    });
    void this.process(sessionId);
  }

  getSession(sessionId: string) {
    return this.getLatestSession(sessionId);
  }

  subscribe(
    sessionId: string,
    subscriber: Parameters<WorkflowSessionRepository["subscribe"]>[1],
  ) {
    return this.store.subscribe(sessionId, subscriber);
  }

  private async process(sessionId: string) {
    const session = this.getLatestSession(sessionId);
    if (!session || session.phase1.isProcessing) {
      return;
    }

    logger.info("Phase1 processing started", {
      sessionId,
      status: session.phase1.status,
      userReplyCount: session.phase1.userReplyCount,
    });
    this.store.setPhase1Processing(sessionId, true);

    try {
      const latest = this.store.getSession(sessionId);
      if (!latest) {
        return;
      }

      const decision = await this.requirementAgent.decide({
        topic: latest.topic,
        messages: latest.phase1.messages,
        userReplyCount: latest.phase1.userReplyCount,
        maxUserReplyCount: this.maxUserReplyCount,
      });

      if (decision.kind === "ask") {
        this.store.appendPhase1AssistantMessage(sessionId, decision.message);
        logger.info("Phase1 agent requested more information", {
          sessionId,
          message: decision.message,
        });
        return;
      }

      this.store.completePhase1(sessionId, decision.message, decision.result);
      logger.info("Phase1 requirements completed", {
        sessionId,
        roleCount: decision.result.roles.length,
        discussionPointCount: decision.result.discussionPoints.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Phase1 processing failed.";
      logger.error("Phase1 processing failed", {
        sessionId,
        message,
      });
      this.store.failPhase1(sessionId, message);
    } finally {
      const latest = this.store.getSession(sessionId);
      if (latest) {
        this.store.setPhase1Processing(sessionId, false);
      }
      logger.info("Phase1 processing finished", {
        sessionId,
      });
    }
  }

  private getLatestSession(sessionId: string) {
    const session = this.store.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (!this.shouldRecoverStaleProcessing(session)) {
      return session;
    }

    logger.info("Phase1 stale processing recovered", {
      sessionId,
      updatedAt: session.updatedAt,
      staleProcessingTimeoutMs: this.staleProcessingTimeoutMs,
    });
    this.store.setPhase1Processing(sessionId, false);
    return this.store.getSession(sessionId);
  }

  private shouldRecoverStaleProcessing(session: WorkflowSession) {
    if (
      session.phase1.status !== "collecting_requirements" ||
      !session.phase1.isProcessing
    ) {
      return false;
    }

    const updatedAt = Date.parse(session.updatedAt);
    if (Number.isNaN(updatedAt)) {
      return true;
    }

    return Date.now() - updatedAt >= this.staleProcessingTimeoutMs;
  }

  private async generateSessionTitle(
    input: Parameters<SessionTitleAgent["generateTitle"]>[0],
  ) {
    try {
      return await this.sessionTitleAgent.generateTitle(input);
    } catch (error) {
      logger.error("Session title generation failed", {
        topic: input.topic,
        userMessageCount: input.userMessages.length,
        hasForkMessage: Boolean(input.forkMessage),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("failed to generate session title.");
    }
  }
}
