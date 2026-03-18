import { logger } from "../../shared/logger";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import { getPhase2DiscussionPoints } from "../../shared/workflow-types";
import type {
  ArenaMessage,
  FacilitatorDecision,
  Phase2CompletionReason,
  Phase2Error,
  Phase2Step,
  WorkflowSession,
} from "../../shared/workflow-types";
import type { FacilitatorAgent, JudgeAgent, RoleAgent } from "./agents";

type Phase2ServiceOptions = {
  maxTurnsPerPoint?: number;
  maxTotalTurns?: number;
  maxRetryCount?: number;
  onCompleted?: (
    sessionId: string,
    reason: Phase2CompletionReason,
  ) => void | Promise<void>;
};

const FACILITATOR_ID = "facilitator";
const FACILITATOR_NAME = "ファシリテーター";
const JUDGE_ID = "judge";
const JUDGE_NAME = "Judge";
const DEFAULT_MAX_TURNS_PER_POINT = 18;
const DEFAULT_MAX_TOTAL_TURNS = 60;
const RESUME_MAX_TURNS_PER_POINT = DEFAULT_MAX_TURNS_PER_POINT * 2;
const RESUME_MAX_TOTAL_TURNS_PER_DISCUSSION_POINT = DEFAULT_MAX_TOTAL_TURNS / 2;

export class Phase2Service {
  private readonly maxTurnsPerPoint: number;
  private readonly maxTotalTurns: number;
  private readonly maxRetryCount: number;
  private readonly onCompleted?: Phase2ServiceOptions["onCompleted"];
  private readonly activeSessions = new Set<string>();

  constructor(
    private readonly repository: WorkflowSessionRepository,
    private readonly facilitatorAgent: FacilitatorAgent,
    private readonly roleAgent: RoleAgent,
    private readonly judgeAgent: JudgeAgent,
    options: Phase2ServiceOptions = {},
  ) {
    this.maxTurnsPerPoint =
      options.maxTurnsPerPoint ?? DEFAULT_MAX_TURNS_PER_POINT;
    this.maxTotalTurns = options.maxTotalTurns ?? DEFAULT_MAX_TOTAL_TURNS;
    this.maxRetryCount = options.maxRetryCount ?? 3;
    this.onCompleted = options.onCompleted;
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

  getEffectiveMaxTurnsPerPoint(session: WorkflowSession) {
    return this.getMaxTurnsPerPoint(session);
  }

  getEffectiveMaxTotalTurns(session: WorkflowSession) {
    return this.getMaxTotalTurns(session);
  }

  start(sessionId: string) {
    const session = this.requireRunnableSession(sessionId);
    if (session.phase2.status !== "idle") {
      throw new Error("phase2_not_idle");
    }
    this.ensureUnlocked(sessionId);
    this.repository.markPhase2Started(sessionId);
    this.activeSessions.add(sessionId);
    void this.run(sessionId);
  }

  retry(sessionId: string) {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (session.phase2.status !== "failed") {
      throw new Error("phase2_not_failed");
    }
    this.ensureUnlocked(sessionId);
    this.repository.resetCurrentPointForRetry(sessionId);
    this.activeSessions.add(sessionId);
    void this.run(sessionId);
  }

  createResumeSession(sessionId: string) {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (session.phase1.status !== "completed" || !session.phase1.result) {
      throw new Error("session_phase1_not_completed");
    }
    if (
      session.phase2.status !== "completed" ||
      !session.phase2.pointStatuses.some(
        (pointStatus) => pointStatus.status !== "resolved",
      )
    ) {
      throw new Error("phase2_not_resumable");
    }

    return this.repository.createSessionForPhase2Resume({
      sourceSessionId: sessionId,
      maxTurnsPerPointOverride: RESUME_MAX_TURNS_PER_POINT,
      maxTotalTurnsOverride:
        RESUME_MAX_TOTAL_TURNS_PER_DISCUSSION_POINT *
        getPhase2DiscussionPoints(session.phase1.result).length,
    });
  }

  private async run(sessionId: string) {
    try {
      while (true) {
        const session = this.requireRunnableSession(sessionId);
        const result = session.phase1.result;
        if (!result) {
          throw new Error("session_phase1_not_completed");
        }
        const discussionPoints = getPhase2DiscussionPoints(result);

        if (
          session.phase2.currentDiscussionPointIndex >= discussionPoints.length
        ) {
          await this.completePhase2(sessionId, "resolved");
          return;
        }

        if (session.phase2.totalTurnCount >= this.getMaxTotalTurns(session)) {
          await this.finishWithCircuitBreaker(session);
          return;
        }

        const currentPoint =
          discussionPoints[session.phase2.currentDiscussionPointIndex];
        if (!currentPoint) {
          await this.completePhase2(sessionId, "resolved");
          return;
        }

        if (
          session.phase2.currentTurnCount >= this.getMaxTurnsPerPoint(session)
        ) {
          this.repository.setPointStatus(
            sessionId,
            currentPoint.id,
            "forced_stop",
          );
          await this.finishWithCircuitBreaker(session);
          return;
        }

        const turnNumber = session.phase2.totalTurnCount + 1;
        const facilitatorDecision = await this.executeWithRetry(
          "facilitator",
          sessionId,
          async () => {
            const decision = await this.facilitatorAgent.decide({
              topic: session.topic,
              requirements: result.requirements,
              openQuestions: result.openQuestions,
              currentDiscussionPoint: currentPoint,
              roles: result.roles,
              messages: session.phase2.messages,
            });
            this.validateFacilitatorDecision(
              decision,
              currentPoint.id,
              result.roles.map((role) => role.id),
            );
            return decision;
          },
        );
        this.repository.appendArenaMessage(sessionId, {
          speakerType: "facilitator",
          speakerId: FACILITATOR_ID,
          speakerName: FACILITATOR_NAME,
          discussionPointId: currentPoint.id,
          content: facilitatorDecision.message,
          turnNumber,
        });

        const roleMessage = await this.executeWithRetry(
          "role",
          sessionId,
          async () => {
            const role = result.roles.find(
              (candidate) => candidate.id === facilitatorDecision.targetRoleId,
            );
            if (!role) {
              throw new Error("target_role_not_found");
            }
            return this.roleAgent.speak({
              topic: session.topic,
              requirements: result.requirements,
              openQuestions: result.openQuestions,
              currentDiscussionPoint: currentPoint,
              role,
              facilitatorMessage: facilitatorDecision.message,
              messages:
                this.repository.getSession(sessionId)?.phase2.messages ?? [],
            });
          },
        );
        const role = result.roles.find(
          (candidate) => candidate.id === facilitatorDecision.targetRoleId,
        );
        if (!role) {
          throw new Error("target_role_not_found");
        }
        this.repository.appendArenaMessage(sessionId, {
          speakerType: "role",
          speakerId: role.id,
          speakerName: role.name,
          discussionPointId: currentPoint.id,
          content: roleMessage,
          turnNumber,
        });

        const judgeDecision = await this.executeWithRetry(
          "judge",
          sessionId,
          async () =>
            this.judgeAgent.decide({
              topic: session.topic,
              requirements: result.requirements,
              openQuestions: result.openQuestions,
              currentDiscussionPoint: currentPoint,
              roles: result.roles,
              messages:
                this.repository.getSession(sessionId)?.phase2.messages ?? [],
            }),
        );
        this.repository.recordJudgeDecision(sessionId, {
          discussionPointId: currentPoint.id,
          isResolved: judgeDecision.isResolved,
          reason: judgeDecision.reason,
          turnNumber,
        });

        const nextCurrentTurnCount = session.phase2.currentTurnCount + 1;
        const nextTotalTurnCount = session.phase2.totalTurnCount + 1;

        if (judgeDecision.isResolved) {
          this.repository.setPointStatus(
            sessionId,
            currentPoint.id,
            "resolved",
          );
          this.repository.updatePhase2Counters(sessionId, {
            currentDiscussionPointIndex:
              session.phase2.currentDiscussionPointIndex + 1,
            currentTurnCount: 0,
            totalTurnCount: nextTotalTurnCount,
          });
          continue;
        }

        this.repository.updatePhase2Counters(sessionId, {
          currentTurnCount: nextCurrentTurnCount,
          totalTurnCount: nextTotalTurnCount,
        });
      }
    } catch (error) {
      const phase2Error =
        error instanceof Phase2StepError
          ? error.detail
          : {
              step: "judge" as const,
              message: error instanceof Error ? error.message : "Phase2 failed",
              retryCount: this.maxRetryCount,
            };
      logger.error("Phase2 processing failed", {
        sessionId,
        message: phase2Error.message,
      });
      if (phase2Error.message === "phase2_already_running") {
        return;
      }
      this.repository.failPhase2(sessionId, phase2Error);
    } finally {
      this.repository.setPhase2Processing(sessionId, false);
      this.activeSessions.delete(sessionId);
      logger.info("Phase2 processing finished", {
        sessionId,
      });
    }
  }

  private async finishWithCircuitBreaker(session: WorkflowSession) {
    await this.completePhase2(session.id, "circuit_breaker");
  }

  private async completePhase2(
    sessionId: string,
    reason: Phase2CompletionReason,
  ) {
    this.repository.completePhase2(sessionId, reason);
    await this.onCompleted?.(sessionId, reason);
  }

  private ensureUnlocked(sessionId: string) {
    if (this.activeSessions.has(sessionId)) {
      throw new Error("phase2_already_running");
    }
  }

  private requireRunnableSession(sessionId: string) {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    if (session.phase1.status !== "completed" || !session.phase1.result) {
      throw new Error("session_phase1_not_completed");
    }
    return session;
  }

  private getMaxTurnsPerPoint(session: WorkflowSession) {
    return session.phase2.maxTurnsPerPointOverride ?? this.maxTurnsPerPoint;
  }

  private getMaxTotalTurns(session: WorkflowSession) {
    return session.phase2.maxTotalTurnsOverride ?? this.maxTotalTurns;
  }

  private validateFacilitatorDecision(
    decision: FacilitatorDecision,
    discussionPointId: string,
    roleIds: string[],
  ) {
    if (decision.discussionPointId !== discussionPointId) {
      throw new Error("facilitator_discussion_point_mismatch");
    }
    if (!roleIds.includes(decision.targetRoleId)) {
      throw new Error("facilitator_role_not_found");
    }
  }

  private async executeWithRetry<T>(
    step: Phase2Step,
    sessionId: string,
    operation: () => Promise<T>,
  ) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetryCount; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error("Phase2 step failed", {
          sessionId,
          step,
          attempt,
          message: lastError.message,
        });
      }
    }

    const finalError: Phase2Error = {
      step,
      message: `${step} failed ${this.maxRetryCount} times: ${lastError?.message ?? "unknown_error"}`,
      retryCount: this.maxRetryCount,
    };
    throw new Phase2StepError(finalError);
  }
}

class Phase2StepError extends Error {
  constructor(readonly detail: Phase2Error) {
    super(detail.message);
  }
}
