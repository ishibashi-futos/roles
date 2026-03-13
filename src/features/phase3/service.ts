import { logger } from "../../shared/logger";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { WorkflowSession } from "../../shared/workflow-types";
import { validateReportMarkdown } from "./report-markdown";
import type { ReportAgent } from "./agent";

type Phase3ServiceOptions = {
  maxRetryCount?: number;
};

export class Phase3Service {
  private readonly maxRetryCount: number;
  private readonly activeSessions = new Set<string>();

  constructor(
    private readonly repository: WorkflowSessionRepository,
    private readonly reportAgent: ReportAgent,
    options: Phase3ServiceOptions = {},
  ) {
    this.maxRetryCount = options.maxRetryCount ?? 3;
  }

  getSession(sessionId: string) {
    return this.repository.getSession(sessionId);
  }

  subscribe(
    sessionId: string,
    subscriber: Parameters<WorkflowSessionRepository["subscribe"]>[1],
  ) {
    return this.repository.subscribe(sessionId, subscriber);
  }

  getEventHistory(sessionId: string) {
    return this.repository.getEventHistory(sessionId);
  }

  start(sessionId: string) {
    const session = this.requirePhase3AvailableSession(sessionId);
    if (session.phase3.status !== "idle") {
      throw new Error("phase3_not_idle");
    }
    this.ensureUnlocked(sessionId);
    this.repository.markPhase3Started(sessionId);
    this.activeSessions.add(sessionId);
    void this.run(sessionId);
  }

  retry(sessionId: string) {
    const session = this.requirePhase3AvailableSession(sessionId);
    if (session.phase3.status !== "failed") {
      throw new Error("phase3_not_failed");
    }
    this.ensureUnlocked(sessionId);
    this.repository.resetPhase3ForRetry(sessionId);
    this.activeSessions.add(sessionId);
    void this.run(sessionId);
  }

  private async run(sessionId: string) {
    try {
      const markdown = await this.executeWithRetry(sessionId, async () => {
        const session = this.requirePhase3AvailableSession(sessionId);
        const reportMarkdown = await this.reportAgent.generate(
          this.buildReportInput(session),
        );
        validateReportMarkdown(reportMarkdown);
        return reportMarkdown;
      });

      this.repository.completePhase3(sessionId, markdown, "generated");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "phase3_generation_failed";
      logger.error("Phase3 processing failed", {
        sessionId,
        message,
      });
      if (message === "phase3_already_running") {
        return;
      }
      this.repository.failPhase3(sessionId, message);
    } finally {
      this.repository.setPhase3Processing(sessionId, false);
      this.activeSessions.delete(sessionId);
      logger.info("Phase3 processing finished", {
        sessionId,
      });
    }
  }

  private buildReportInput(session: WorkflowSession) {
    const phase1Result = session.phase1.result;
    if (!phase1Result) {
      throw new Error("session_phase1_not_completed");
    }

    const unresolvedDiscussionPoints = phase1Result.discussionPoints
      .filter((point) =>
        session.phase2.pointStatuses.some(
          (status) =>
            status.discussionPointId === point.id &&
            status.status !== "resolved",
        ),
      )
      .map((point) => point.title);

    return {
      topic: session.topic,
      phase1Result: {
        requirements: phase1Result.requirements,
        discussionPoints: phase1Result.discussionPoints,
        roles: phase1Result.roles,
      },
      phase2: {
        completionReason: session.phase2.completionReason,
        messages: session.phase2.messages,
        judgeDecisions: session.phase2.judgeDecisions,
        pointStatuses: session.phase2.pointStatuses,
      },
      unresolvedDiscussionPoints,
    };
  }

  private ensureUnlocked(sessionId: string) {
    if (this.activeSessions.has(sessionId)) {
      throw new Error("phase3_already_running");
    }
  }

  private requirePhase3AvailableSession(sessionId: string) {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (session.phase1.status !== "completed" || !session.phase1.result) {
      throw new Error("session_phase1_not_completed");
    }
    if (session.phase2.status !== "completed") {
      throw new Error("phase2_not_completed");
    }
    return session;
  }

  private async executeWithRetry<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetryCount; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error("Phase3 step failed", {
          sessionId,
          attempt,
          message: lastError.message,
        });
      }
    }

    throw new Error(
      `report generation failed ${this.maxRetryCount} times: ${lastError?.message ?? "unknown_error"}`,
    );
  }
}
