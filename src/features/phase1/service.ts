import type { RequirementAgent } from "./requirement-agent";
import { logger } from "../../shared/logger";
import { Phase1SessionStore } from "./session-store";

type Phase1ServiceOptions = {
  maxUserReplyCount?: number;
};

export class Phase1Service {
  private readonly maxUserReplyCount: number;

  constructor(
    private readonly store: Phase1SessionStore,
    private readonly requirementAgent: RequirementAgent,
    options: Phase1ServiceOptions = {},
  ) {
    this.maxUserReplyCount = options.maxUserReplyCount ?? 3;
  }

  createSession(topic: string) {
    const session = this.store.create(topic);
    logger.info("Phase1 session created", {
      sessionId: session.id,
      topic,
    });
    void this.process(session.id);
    return session;
  }

  submitReply(sessionId: string, message: string) {
    const session = this.store.get(sessionId);

    if (!session) {
      throw new Error("session_not_found");
    }

    if (session.status !== "collecting_requirements") {
      throw new Error("session_not_collecting");
    }

    if (session.isProcessing) {
      throw new Error("session_processing");
    }

    this.store.appendUserMessage(sessionId, message);
    logger.info("Phase1 reply accepted", {
      sessionId,
      messageLength: message.length,
    });
    void this.process(sessionId);
  }

  getSession(sessionId: string) {
    return this.store.get(sessionId);
  }

  subscribe(
    sessionId: string,
    subscriber: Parameters<Phase1SessionStore["subscribe"]>[1],
  ) {
    return this.store.subscribe(sessionId, subscriber);
  }

  private async process(sessionId: string) {
    const session = this.store.get(sessionId);
    if (!session || session.isProcessing) {
      return;
    }

    logger.info("Phase1 processing started", {
      sessionId,
      status: session.status,
      userReplyCount: session.userReplyCount,
    });
    this.store.setProcessing(sessionId, true);

    try {
      const latest = this.store.get(sessionId);
      if (!latest) {
        return;
      }

      const decision = await this.requirementAgent.decide({
        topic: latest.topic,
        messages: latest.messages,
        userReplyCount: latest.userReplyCount,
        maxUserReplyCount: this.maxUserReplyCount,
      });

      if (decision.kind === "ask") {
        this.store.appendAssistantMessage(sessionId, decision.message);
        logger.info("Phase1 agent requested more information", {
          sessionId,
          message: decision.message,
        });
        return;
      }

      this.store.complete(sessionId, decision.message, decision.result);
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
      this.store.fail(sessionId, message);
    } finally {
      const latest = this.store.get(sessionId);
      if (latest) {
        this.store.setProcessing(sessionId, false);
      }
      logger.info("Phase1 processing finished", {
        sessionId,
      });
    }
  }
}
