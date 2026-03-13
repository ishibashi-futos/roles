export type {
  DiscussionPoint,
  Phase1Result,
  Phase1SessionStatus,
  Phase1SseEvent,
  RequirementDefinition,
  RequirementMessage,
  RequirementMessageRole,
  RoleDefinition,
} from "../../shared/workflow-types";

export type { WorkflowSession as RequirementSession } from "../../shared/workflow-types";

export type RequirementAgentAskDecision = {
  kind: "ask";
  message: string;
};

export type RequirementAgentCompleteDecision = {
  kind: "complete";
  message: string;
  result: import("../../shared/workflow-types").Phase1Result;
};

export type RequirementAgentDecision =
  | RequirementAgentAskDecision
  | RequirementAgentCompleteDecision;
