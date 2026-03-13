import { Hono } from "hono";
import {
  createFallbackPhase2Agents,
  createPhase2AgentsFromEnv,
} from "./features/phase2/agents";
import { registerPhase2Routes } from "./features/phase2/routes";
import { Phase2Service } from "./features/phase2/service";
import { registerPhase1Routes } from "./features/phase1/routes";
import {
  createRequirementAgentFromEnv,
  type RequirementAgent,
} from "./features/phase1/requirement-agent";
import { Phase1Service } from "./features/phase1/service";
import { logger } from "./shared/logger";
import { registerStaticAssetRoutes } from "./shared/static-assets";
import { WorkflowSessionRepository } from "./shared/workflow-session-repository";
import type {
  FacilitatorAgent,
  JudgeAgent,
  RoleAgent,
} from "./features/phase2/agents";

type CreateAppOptions = {
  repository?: WorkflowSessionRepository;
  requirementAgent?: RequirementAgent;
  facilitatorAgent?: FacilitatorAgent;
  roleAgent?: RoleAgent;
  judgeAgent?: JudgeAgent;
  maxUserReplyCount?: number;
  maxTurnsPerPoint?: number;
  maxTotalTurns?: number;
  maxRetryCount?: number;
};

export const createApp = (options: CreateAppOptions = {}) => {
  const app = new Hono();
  registerStaticAssetRoutes(app);
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

  const phase1Service = new Phase1Service(repository, requirementAgent, {
    maxUserReplyCount: options.maxUserReplyCount,
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
    },
  );

  registerPhase1Routes(app, {
    service: phase1Service,
    repository,
  });
  registerPhase2Routes(app, {
    service: phase2Service,
    repository,
  });

  return app;
};

const safelyCreateRequirementAgentFromEnv = () => {
  try {
    return createRequirementAgentFromEnv();
  } catch {
    return {
      async decide() {
        throw new Error(
          "OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL を設定してください。",
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

const app = createApp();

export default app;
