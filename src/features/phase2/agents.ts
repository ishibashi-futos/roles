import { OpenAiCompatibleClient } from "../../shared/llm/openai-compatible-client";
import { logger } from "../../shared/logger";
import {
  describeOutputLanguage,
  getOutputLanguageFromEnv,
  type OutputLanguage,
} from "../../shared/output-language";
import type {
  ArenaMessage,
  DiscussionPoint,
  FacilitatorDecision,
  JudgeDecision,
  Phase1Result,
  Phase2Step,
  RoleDefinition,
} from "../../shared/workflow-types";

const FACILITATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    discussionPointId: { type: "string", minLength: 1 },
    targetRoleId: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
  },
  required: ["discussionPointId", "targetRoleId", "message"],
} as const;

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    isResolved: { type: "boolean" },
    reason: { type: "string", minLength: 1 },
  },
  required: ["isResolved", "reason"],
} as const;

export const buildFacilitatorSystemPrompt = (
  outputLanguage: OutputLanguage,
) => `You are the facilitator for roles.
You must advance a structured discussion in ${describeOutputLanguage(outputLanguage)}.
Always focus on the current discussion point only.
Return JSON only with discussionPointId, targetRoleId, and message.
The message must be a concise facilitation utterance addressed to the selected role.`;

export const buildRoleSystemPrompt = (
  outputLanguage: OutputLanguage,
) => `You are a discussion participant for roles.
You must speak in ${describeOutputLanguage(outputLanguage)} and maintain the assigned role perspective consistently.
Use the role definition from the user message as the only source of truth.
Return plain text only.
Keep the response concise and specific to the current discussion point.
Do not agree too quickly or resolve tension prematurely.
Actively challenge weak assumptions, missing evidence, and hidden trade-offs from your role perspective.
If a proposal still has unresolved risks, conflicts, or execution gaps, point them out explicitly instead of pretending consensus.
Do not be rude, but be skeptical and hard to convince until the current point is genuinely addressed.`;

export const buildJudgeSystemPrompt = (
  outputLanguage: OutputLanguage,
) => `You are the judge for roles.
You must evaluate whether the current discussion point is resolved.
Return JSON only with isResolved and reason.
The reason must be in ${describeOutputLanguage(outputLanguage)} and refer only to the current discussion point.`;

const createClientFromEnv = () => {
  const baseUrl = process.env.OPENAI_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!baseUrl || !apiKey || !model) {
    logger.error("LLM environment variables are missing", {
      hasBaseUrl: Boolean(baseUrl),
      hasApiKey: Boolean(apiKey),
      hasModel: Boolean(model),
    });
    throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.");
  }

  return new OpenAiCompatibleClient(baseUrl, apiKey, model);
};

export interface FacilitatorAgent {
  decide(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    roles: RoleDefinition[];
    messages: ArenaMessage[];
  }): Promise<FacilitatorDecision>;
}

export interface RoleAgent {
  speak(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    role: RoleDefinition;
    facilitatorMessage: string;
    messages: ArenaMessage[];
  }): Promise<string>;
}

export interface JudgeAgent {
  decide(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    roles: RoleDefinition[];
    messages: ArenaMessage[];
  }): Promise<JudgeDecision>;
}

export class OpenAiFacilitatorAgent implements FacilitatorAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async decide(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    roles: RoleDefinition[];
    messages: ArenaMessage[];
  }) {
    const outputLanguage = getOutputLanguageFromEnv();
    const content = await this.client.createJsonChatCompletion(
      [
        {
          role: "system",
          content: buildFacilitatorSystemPrompt(outputLanguage),
        },
        {
          role: "user",
          content: JSON.stringify(input, null, 2),
        },
      ],
      {
        type: "json_schema",
        json_schema: {
          name: "facilitator_decision",
          schema: FACILITATOR_SCHEMA,
        },
      },
    );

    return parseFacilitatorDecision(content);
  }
}

export class OpenAiRoleAgent implements RoleAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async speak(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    role: RoleDefinition;
    facilitatorMessage: string;
    messages: ArenaMessage[];
  }) {
    const outputLanguage = getOutputLanguageFromEnv();
    const content = await this.client.createTextChatCompletion([
      {
        role: "system",
        content: buildRoleSystemPrompt(outputLanguage),
      },
      {
        role: "user",
        content: JSON.stringify(input, null, 2),
      },
    ]);

    const message = content.trim();
    if (!message) {
      throw new Error("Role response is empty.");
    }

    return message;
  }
}

export class OpenAiJudgeAgent implements JudgeAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async decide(input: {
    topic: string;
    requirements: Phase1Result["requirements"];
    currentDiscussionPoint: DiscussionPoint;
    roles: RoleDefinition[];
    messages: ArenaMessage[];
  }) {
    const outputLanguage = getOutputLanguageFromEnv();
    const content = await this.client.createJsonChatCompletion(
      [
        {
          role: "system",
          content: buildJudgeSystemPrompt(outputLanguage),
        },
        {
          role: "user",
          content: JSON.stringify(input, null, 2),
        },
      ],
      {
        type: "json_schema",
        json_schema: {
          name: "judge_decision",
          schema: JUDGE_SCHEMA,
        },
      },
    );

    return parseJudgeDecision(content);
  }
}

export const createPhase2AgentsFromEnv = () => {
  const client = createClientFromEnv();
  return {
    facilitatorAgent: new OpenAiFacilitatorAgent(client),
    roleAgent: new OpenAiRoleAgent(client),
    judgeAgent: new OpenAiJudgeAgent(client),
  };
};

export const createFallbackPhase2Agents = () => ({
  facilitatorAgent: {
    async decide() {
      throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.");
    },
  } satisfies FacilitatorAgent,
  roleAgent: {
    async speak() {
      throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.");
    },
  } satisfies RoleAgent,
  judgeAgent: {
    async decide() {
      throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.");
    },
  } satisfies JudgeAgent,
});

const parseJson = (content: string, step: Phase2Step) => {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse ${step} JSON.`);
  }
};

export const parseFacilitatorDecision = (content: string) => {
  const parsed = parseJson(content, "facilitator");

  if (
    typeof parsed.discussionPointId !== "string" ||
    parsed.discussionPointId.length === 0 ||
    typeof parsed.targetRoleId !== "string" ||
    parsed.targetRoleId.length === 0 ||
    typeof parsed.message !== "string" ||
    parsed.message.length === 0
  ) {
    throw new Error("Facilitator JSON format is invalid.");
  }

  return parsed as FacilitatorDecision;
};

export const parseJudgeDecision = (content: string) => {
  const parsed = parseJson(content, "judge");

  if (
    typeof parsed.isResolved !== "boolean" ||
    typeof parsed.reason !== "string" ||
    parsed.reason.length === 0
  ) {
    throw new Error("Judge JSON format is invalid.");
  }

  return parsed as JudgeDecision;
};
