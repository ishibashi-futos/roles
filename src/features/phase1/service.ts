import { logger } from "../../shared/logger";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { RequirementAgent } from "./requirement-agent";

type Phase1ServiceOptions = {
  maxUserReplyCount?: number;
};

export class Phase1Service {
  private readonly maxUserReplyCount: number;

  constructor(
    private readonly store: WorkflowSessionRepository,
    private readonly requirementAgent: RequirementAgent,
    options: Phase1ServiceOptions = {},
  ) {
    this.maxUserReplyCount = options.maxUserReplyCount ?? 3;
  }

  createSession(topic: string) {
    const session = this.store.createSession(topic);
    logger.info("Phase1 session created", {
      sessionId: session.id,
      topic,
    });
    void this.process(session.id);
    return session;
  }

  submitReply(sessionId: string, message: string) {
    const session = this.store.getSession(sessionId);

    if (!session) {
      throw new Error("session_not_found");
    }

    if (session.phase1.status !== "collecting_requirements") {
      throw new Error("session_not_collecting");
    }

    if (session.phase1.isProcessing) {
      throw new Error("session_processing");
    }

    this.store.appendPhase1UserMessage(sessionId, message);
    logger.info("Phase1 reply accepted", {
      sessionId,
      messageLength: message.length,
    });
    void this.process(sessionId);
  }

  getSession(sessionId: string) {
    return this.store.getSession(sessionId);
  }

  subscribe(
    sessionId: string,
    subscriber: Parameters<WorkflowSessionRepository["subscribe"]>[1],
  ) {
    return this.store.subscribe(sessionId, subscriber);
  }

  private async process(sessionId: string) {
    const session = this.store.getSession(sessionId);
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
        error instanceof Error
          ? error.message
          : "要件定義の処理に失敗しました。";
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
}
