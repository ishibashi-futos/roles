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

export type RequirementAgentAskDecision = {
  kind: "ask";
  message: string;
};

export type RequirementAgentCompleteDecision = {
  kind: "complete";
  message: string;
  result: Phase1Result;
};

export type RequirementAgentDecision =
  | RequirementAgentAskDecision
  | RequirementAgentCompleteDecision;

export type RequirementSession = {
  id: string;
  topic: string;
  status: Phase1SessionStatus;
  messages: RequirementMessage[];
  result: Phase1Result | null;
  userReplyCount: number;
  isProcessing: boolean;
  errorMessage: string | null;
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
