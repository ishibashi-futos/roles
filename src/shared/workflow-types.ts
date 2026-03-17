export type Phase1SessionStatus =
  | "collecting_requirements"
  | "completed"
  | "failed";

export type RequirementMessageRole = "user" | "assistant";

export type RequirementMessage = {
  role: RequirementMessageRole;
  content: string;
};

export type RequirementDefinition = {
  theme: string;
  objective: string;
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
};

export type DiscussionPoint = {
  id: string;
  title: string;
  description: string;
  decisionOwnerRoleId: string;
};

export type RoleDefinition = {
  id: string;
  name: string;
  perspective: string;
  responsibilities: string[];
  concerns: string[];
  systemPromptSeed: string;
};

export type Phase1Result = {
  requirements: RequirementDefinition;
  discussionPoints: DiscussionPoint[];
  roles: RoleDefinition[];
};

export type Phase1State = {
  status: Phase1SessionStatus;
  messages: RequirementMessage[];
  result: Phase1Result | null;
  userReplyCount: number;
  isProcessing: boolean;
  errorMessage: string | null;
};

export type ArenaSpeakerType = "facilitator" | "role" | "judge";

export type ArenaMessage = {
  id: string;
  speakerType: ArenaSpeakerType;
  speakerId: string;
  speakerName: string;
  discussionPointId: string;
  content: string;
  turnNumber: number;
};

export type PointStatusValue = "pending" | "resolved" | "forced_stop";

export type PointStatus = {
  discussionPointId: string;
  status: PointStatusValue;
};

export type JudgeDecision = {
  isResolved: boolean;
  reason: string;
};

export type JudgeDecisionRecord = JudgeDecision & {
  discussionPointId: string;
  turnNumber: number;
};

export type FacilitatorDecision = {
  discussionPointId: string;
  targetRoleId: string;
  message: string;
};

export type Phase2Status = "idle" | "running" | "completed" | "failed";

export type Phase2CompletionReason = "resolved" | "circuit_breaker" | "failed";

export type Phase2Step = "facilitator" | "role" | "judge";

export type Phase2Error = {
  step: Phase2Step;
  message: string;
  retryCount: number;
};

export type Phase2State = {
  status: Phase2Status;
  currentDiscussionPointIndex: number;
  currentTurnCount: number;
  totalTurnCount: number;
  maxTurnsPerPointOverride: number | null;
  maxTotalTurnsOverride: number | null;
  messages: ArenaMessage[];
  pointStatuses: PointStatus[];
  judgeDecisions: JudgeDecisionRecord[];
  lastJudgeDecision: JudgeDecisionRecord | null;
  completionReason: Phase2CompletionReason | null;
  isProcessing: boolean;
  error: Phase2Error | null;
};

export type Phase3Status = "idle" | "running" | "completed" | "failed";

export type Phase3CompletionReason = "generated" | "failed";

export type Phase3State = {
  status: Phase3Status;
  reportMarkdown: string | null;
  completionReason: Phase3CompletionReason | null;
  isProcessing: boolean;
  errorMessage: string | null;
};

export type WorkflowSession = {
  id: string;
  topic: string;
  phase1: Phase1State;
  phase2: Phase2State;
  phase3: Phase3State;
  createdAt: string;
  updatedAt: string;
};

export type Phase1SseEvent =
  | {
      id: number;
      event: "session_created";
      data: {
        sessionId: string;
        topic: string;
      };
    }
  | {
      id: number;
      event: "assistant_delta";
      data: {
        sessionId: string;
        content: string;
      };
    }
  | {
      id: number;
      event: "assistant_done";
      data: {
        sessionId: string;
      };
    }
  | {
      id: number;
      event: "requirements_completed";
      data: {
        sessionId: string;
        result: Phase1Result;
      };
    }
  | {
      id: number;
      event: "error";
      data: {
        sessionId: string;
        message: string;
      };
    };

export type Phase2SseEvent =
  | {
      id: number;
      event: "phase2_started";
      data: {
        sessionId: string;
      };
    }
  | {
      id: number;
      event: "arena_message";
      data: {
        sessionId: string;
        message: ArenaMessage;
      };
    }
  | {
      id: number;
      event: "judge_result";
      data: {
        sessionId: string;
        result: JudgeDecisionRecord;
      };
    }
  | {
      id: number;
      event: "phase2_completed";
      data: {
        sessionId: string;
        reason: Phase2CompletionReason;
      };
    }
  | {
      id: number;
      event: "error";
      data: {
        sessionId: string;
        message: string;
      };
    };

export type Phase3SseEvent =
  | {
      id: number;
      event: "phase3_started";
      data: {
        sessionId: string;
      };
    }
  | {
      id: number;
      event: "phase3_completed";
      data: {
        sessionId: string;
      };
    }
  | {
      id: number;
      event: "error";
      data: {
        sessionId: string;
        message: string;
      };
    };

export type WorkflowSseEvent = Phase1SseEvent | Phase2SseEvent | Phase3SseEvent;

export const createInitialPhase2State = (): Phase2State => ({
  status: "idle",
  currentDiscussionPointIndex: 0,
  currentTurnCount: 0,
  totalTurnCount: 0,
  maxTurnsPerPointOverride: null,
  maxTotalTurnsOverride: null,
  messages: [],
  pointStatuses: [],
  judgeDecisions: [],
  lastJudgeDecision: null,
  completionReason: null,
  isProcessing: false,
  error: null,
});

export const createInitialPhase3State = (): Phase3State => ({
  status: "idle",
  reportMarkdown: null,
  completionReason: null,
  isProcessing: false,
  errorMessage: null,
});
