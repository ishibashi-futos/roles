import {
  createFallbackPhase2Agents,
  createPhase2AgentsFromEnv,
  type FacilitatorAgent,
  type JudgeAgent,
  type RoleAgent,
} from "./features/phase2/agents";
import { Phase2Service } from "./features/phase2/service";
import {
  createRequirementAgentFromEnv,
  type RequirementAgent,
} from "./features/phase1/requirement-agent";
import { Phase1Service } from "./features/phase1/service";
import {
  createFallbackPhase3Agent,
  createPhase3AgentFromEnv,
  type ReportAgent,
} from "./features/phase3/agent";
import { Phase3Service } from "./features/phase3/service";
import { logger } from "./shared/logger";
import { WorkflowSessionRepository } from "./shared/workflow-session-repository";

export type CreateRuntimeOptions = {
  repository?: WorkflowSessionRepository;
  requirementAgent?: RequirementAgent;
  facilitatorAgent?: FacilitatorAgent;
  roleAgent?: RoleAgent;
  judgeAgent?: JudgeAgent;
  reportAgent?: ReportAgent;
  maxUserReplyCount?: number;
  maxTurnsPerPoint?: number;
  maxTotalTurns?: number;
  maxRetryCount?: number;
};

export const createRuntime = (options: CreateRuntimeOptions = {}) => {
  const repository = options.repository ?? new WorkflowSessionRepository();
  const requirementAgent =
    options.requirementAgent ?? safelyCreateRequirementAgentFromEnv();
  const phase2Agents =
    options.facilitatorAgent && options.roleAgent && options.judgeAgent
      ? {
          facilitatorAgent: options.facilitatorAgent,
          roleAgent: options.roleAgent,
          judgeAgent: options.judgeAgent,
        }
      : safelyCreatePhase2AgentsFromEnv();
  const reportAgent = options.reportAgent ?? safelyCreatePhase3AgentFromEnv();

  const phase1Service = new Phase1Service(repository, requirementAgent, {
    maxUserReplyCount: options.maxUserReplyCount,
  });
  const phase3Service = new Phase3Service(repository, reportAgent, {
    maxRetryCount: options.maxRetryCount,
  });
  const phase2Service = new Phase2Service(
    repository,
    phase2Agents.facilitatorAgent,
    phase2Agents.roleAgent,
    phase2Agents.judgeAgent,
    {
      maxTurnsPerPoint: options.maxTurnsPerPoint,
      maxTotalTurns: options.maxTotalTurns,
      maxRetryCount: options.maxRetryCount,
      onCompleted: (sessionId) => {
        try {
          phase3Service.start(sessionId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "unexpected_error";
          if (
            message === "phase3_not_idle" ||
            message === "phase3_already_running"
          ) {
            return;
          }
          logger.error("Phase3 auto-start failed", {
            sessionId,
            message,
          });
        }
      },
    },
  );

  return {
    repository,
    phase1Service,
    phase2Service,
    phase3Service,
  };
};

const safelyCreateRequirementAgentFromEnv = () => {
  try {
    return createRequirementAgentFromEnv();
  } catch {
    return {
      async decide() {
        throw new Error(
          "Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.",
        );
      },
    } satisfies RequirementAgent;
  }
};

const safelyCreatePhase2AgentsFromEnv = () => {
  try {
    return createPhase2AgentsFromEnv();
  } catch (error) {
    logger.error("Phase2 fallback agents enabled", {
      message: error instanceof Error ? error.message : String(error),
    });
    return createFallbackPhase2Agents();
  }
};

const safelyCreatePhase3AgentFromEnv = () => {
  try {
    return createPhase3AgentFromEnv();
  } catch (error) {
    logger.error("Phase3 fallback agent enabled", {
      message: error instanceof Error ? error.message : String(error),
    });
    return createFallbackPhase3Agent();
  }
};
