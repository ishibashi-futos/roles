import { OpenAiCompatibleClient } from "../../shared/llm/openai-compatible-client";
import { logger } from "../../shared/logger";
import {
  describeOutputLanguage,
  getOutputLanguageFromEnv,
  type OutputLanguage,
} from "../../shared/output-language";
import type {
  Phase1Result,
  RequirementAgentDecision,
  RequirementMessage,
} from "./types";

const MAX_ROLE_COUNT = 5;

export const buildRequirementAgentSystemPrompt = (
  outputLanguage: OutputLanguage,
) => `You are the requirement-definition agent for roles.
Your job is to transform an ambiguous user topic into a discussion-ready definition with explicit requirements, discussion points, and role definitions.

You must return a JSON object only.
The JSON must match one of the following shapes.

1. When more information is required
{
  "kind": "ask",
  "message": "Question for the user"
}

2. When the requirements and role definitions are ready
{
  "kind": "complete",
  "message": "Short summary of the finalized definition",
  "result": {
    "requirements": {
      "theme": "Topic",
      "objective": "Objective",
      "successCriteria": ["Success criterion"],
      "constraints": ["Constraint"],
      "assumptions": ["Assumption"]
    },
    "discussionPoints": [
      {
        "id": "point-1",
        "title": "Discussion point",
        "description": "Description of the discussion point",
        "decisionOwnerRoleId": "role-1"
      }
    ],
    "roles": [
      {
        "id": "role-1",
        "name": "Role name",
        "perspective": "Perspective",
        "responsibilities": ["Responsibility"],
        "concerns": ["Concern"],
        "systemPromptSeed": "The viewpoint this role must maintain in the discussion"
      }
    ]
  }
}

Rules:
- Interact with the user in ${describeOutputLanguage(outputLanguage)}
- Follow this reasoning order internally: identify the business workflow, extract the objective, extract constraints, determine the essential stakeholders, draft 2-4 decision-grade discussion points, then decide whether any remaining gap is truly blocking
- You may return kind="complete" once the topic, objective, major constraints, and candidate stakeholders are sufficiently clear to start the discussion
- Return kind="ask" only when the missing information prevents you from producing at least 2 decision-grade discussion points or at least 3 meaningful conflicting roles
- Never ask for nice-to-have details
- When you ask, ask exactly one major question about one missing issue only
- Do not combine multiple missing issues into one question
- Do not repeat the same question in different wording
- If some minor detail is missing, convert it into an explicit assumption and continue with kind="complete"
- roles must contain between 3 and ${MAX_ROLE_COUNT} items
- Choose roles to maximize decision quality for the topic, not just operational coverage
- Include executive or sponsor roles such as CxO, business owner, or department head when they are relevant to the topic
- If the user explicitly requests certain roles, titles, seniority levels, or stakeholder groups, reflect them in the generated roles unless they directly conflict with the topic
- Do not exclude a role only because it is senior, strategic, or not a day-to-day operator
- discussionPoints must contain at least 2 items
- discussionPoints must represent decisions or tradeoffs that could change the final strategy, not generic workstreams
- Each discussion point must identify exactly one decisionOwnerRoleId from the generated roles
- roles must represent contrasting viewpoints that can disagree in the discussion, not a flat department checklist
- systemPromptSeed must state the role's argumentative stance in one sentence
- successCriteria, constraints, assumptions, responsibilities, and concerns must never be empty arrays`;

export const buildRequirementAgentInstruction = (
  shouldForceComplete: boolean,
) =>
  shouldForceComplete
    ? 'This is the final confirmation. Do not ask follow-up questions and always return kind="complete". Missing minor details must be converted into explicit assumptions.'
    : 'Return kind="ask" only if one blocking gap prevents a discussion-ready definition. Ask about one issue only.';

const REQUIREMENT_AGENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["ask", "complete"],
    },
    message: {
      type: "string",
    },
    result: {
      type: "object",
      additionalProperties: false,
      properties: {
        requirements: {
          type: "object",
          additionalProperties: false,
          properties: {
            theme: { type: "string", minLength: 1 },
            objective: { type: "string", minLength: 1 },
            successCriteria: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            constraints: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            assumptions: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
          required: [
            "theme",
            "objective",
            "successCriteria",
            "constraints",
            "assumptions",
          ],
        },
        discussionPoints: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              title: { type: "string", minLength: 1 },
              description: { type: "string", minLength: 1 },
              decisionOwnerRoleId: { type: "string", minLength: 1 },
            },
            required: ["id", "title", "description", "decisionOwnerRoleId"],
          },
        },
        roles: {
          type: "array",
          minItems: 3,
          maxItems: MAX_ROLE_COUNT,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
              perspective: { type: "string", minLength: 1 },
              responsibilities: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
              },
              concerns: {
                type: "array",
                minItems: 1,
                items: { type: "string" },
              },
              systemPromptSeed: { type: "string", minLength: 1 },
            },
            required: [
              "id",
              "name",
              "perspective",
              "responsibilities",
              "concerns",
              "systemPromptSeed",
            ],
          },
        },
      },
      required: ["requirements", "discussionPoints", "roles"],
    },
  },
  required: ["kind", "message"],
} as const;

type RequirementAgentResponse = {
  kind?: unknown;
  message?: unknown;
  result?: unknown;
};

export interface RequirementAgent {
  decide(input: {
    topic: string;
    messages: RequirementMessage[];
    userReplyCount: number;
    maxUserReplyCount: number;
  }): Promise<RequirementAgentDecision>;
}

export class OpenAiRequirementAgent implements RequirementAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async decide(input: {
    topic: string;
    messages: RequirementMessage[];
    userReplyCount: number;
    maxUserReplyCount: number;
  }) {
    const outputLanguage = getOutputLanguageFromEnv();
    const forcedCompletionInstruction = buildRequirementAgentInstruction(
      input.userReplyCount >= input.maxUserReplyCount,
    );

    const content = await this.client.createJsonChatCompletion(
      [
        {
          role: "system",
          content: buildRequirementAgentSystemPrompt(outputLanguage),
        },
        {
          role: "user",
          content: buildRequirementAgentUserMessage({
            topic: input.topic,
            messages: input.messages,
            userReplyCount: input.userReplyCount,
            maxUserReplyCount: input.maxUserReplyCount,
            instruction: forcedCompletionInstruction,
          }),
        },
      ],
      {
        type: "json_schema",
        json_schema: {
          name: "requirement_agent_response",
          schema: REQUIREMENT_AGENT_RESPONSE_SCHEMA,
        },
      },
    );

    return parseRequirementAgentDecision(content);
  }
}

export const createRequirementAgentFromEnv = () => {
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

  logger.info("LLM requirement agent configured", {
    baseUrl,
    model,
  });

  return new OpenAiRequirementAgent(
    new OpenAiCompatibleClient(baseUrl, apiKey, model),
  );
};

export const parseRequirementAgentDecision = (content: string) => {
  let parsed: RequirementAgentResponse;

  try {
    parsed = JSON.parse(content) as RequirementAgentResponse;
  } catch {
    throw new Error("Failed to parse requirement agent JSON.");
  }

  if (parsed.kind === "ask" && typeof parsed.message === "string") {
    return {
      kind: "ask",
      message: parsed.message,
    } satisfies RequirementAgentDecision;
  }

  if (parsed.kind === "complete" && typeof parsed.message === "string") {
    const validationError = validatePhase1Result(parsed.result);

    if (!validationError) {
      const result = parsed.result as Phase1Result;
      return {
        kind: "complete",
        message: parsed.message,
        result,
      } satisfies RequirementAgentDecision;
    }

    logger.error("Requirement agent returned incomplete complete payload", {
      validationError,
      message: parsed.message,
    });

    throw new Error("Requirement agent returned invalid complete payload.");
  }

  throw new Error("Requirement agent JSON format is invalid.");
};

const isNonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === "string" && item.length > 0);

const validatePhase1Result = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return "result must be an object";
  }

  const result = value as Record<string, unknown>;
  const requirements = result.requirements as
    | Record<string, unknown>
    | undefined;
  const discussionPoints = result.discussionPoints;
  const roles = result.roles;

  if (
    !requirements ||
    typeof requirements.theme !== "string" ||
    requirements.theme.length === 0 ||
    typeof requirements.objective !== "string" ||
    requirements.objective.length === 0 ||
    !isNonEmptyStringArray(requirements.successCriteria) ||
    !isNonEmptyStringArray(requirements.constraints) ||
    !isNonEmptyStringArray(requirements.assumptions)
  ) {
    return "requirements is incomplete";
  }

  if (
    !Array.isArray(discussionPoints) ||
    discussionPoints.length < 2 ||
    !discussionPoints.every((point) => {
      if (!point || typeof point !== "object") {
        return false;
      }
      const candidate = point as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        typeof candidate.title === "string" &&
        candidate.title.length > 0 &&
        typeof candidate.description === "string" &&
        candidate.description.length > 0 &&
        typeof candidate.decisionOwnerRoleId === "string" &&
        candidate.decisionOwnerRoleId.length > 0
      );
    })
  ) {
    return "discussionPoints is incomplete";
  }

  if (
    !Array.isArray(roles) ||
    roles.length < 3 ||
    roles.length > MAX_ROLE_COUNT ||
    !roles.every((role) => {
      if (!role || typeof role !== "object") {
        return false;
      }
      const candidate = role as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        candidate.id.length > 0 &&
        typeof candidate.name === "string" &&
        candidate.name.length > 0 &&
        typeof candidate.perspective === "string" &&
        candidate.perspective.length > 0 &&
        typeof candidate.systemPromptSeed === "string" &&
        candidate.systemPromptSeed.length > 0 &&
        isNonEmptyStringArray(candidate.responsibilities) &&
        isNonEmptyStringArray(candidate.concerns)
      );
    })
  ) {
    return "roles is incomplete";
  }

  const roleIds = new Set(
    roles.map((role) => (role as Record<string, unknown>).id as string),
  );

  if (
    discussionPoints.some((point) => {
      const candidate = point as Record<string, unknown>;
      return !roleIds.has(candidate.decisionOwnerRoleId as string);
    })
  ) {
    return "discussionPoints decision owner is invalid";
  }

  return null;
};

const buildRequirementAgentUserMessage = (input: {
  topic: string;
  messages: RequirementMessage[];
  userReplyCount: number;
  maxUserReplyCount: number;
  instruction: string;
}) => {
  const conversation = input.messages
    .map(
      (message, index) => `${index + 1}. ${message.role}: ${message.content}`,
    )
    .join("\n");

  return `Requirement intake
- topic: ${input.topic}
- userReplyCount: ${input.userReplyCount}
- maxUserReplyCount: ${input.maxUserReplyCount}
- rule: ${input.instruction}

Decision policy
1. Extract known facts about objective, success criteria, constraints, and stakeholders.
2. Identify any blocking gap.
3. If there is no blocking gap, return kind="complete" and absorb minor uncertainty into assumptions.
4. If there is a blocking gap, return kind="ask" with exactly one question about exactly one issue.

Conversation
${conversation}`;
};
