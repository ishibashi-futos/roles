import { OpenAiCompatibleClient } from "../../shared/llm/openai-compatible-client";
import { logger } from "../../shared/logger";
import {
  describeOutputLanguage,
  getOutputLanguageFromEnv,
} from "../../shared/output-language";

const MAX_SESSION_TITLE_LENGTH = 32;

type SessionTitleResponse = {
  title?: unknown;
};

export type SessionTitleContext = {
  topic: string;
  userMessages: string[];
  requirementTheme?: string | null;
  requirementObjective?: string | null;
  forkMessage?: string | null;
};

export interface SessionTitleAgent {
  generateTitle(input: SessionTitleContext): Promise<string>;
}

const buildSessionTitleSystemPrompt = () => {
  const outputLanguage = getOutputLanguageFromEnv();

  return `You generate short session titles for roles.
Return a JSON object only.

Output language:
- ${describeOutputLanguage(outputLanguage)}

Rules:
- Summarize the user's intent into one short session title
- Prefer a noun phrase over a sentence
- Reflect the latest direction if a fork message is present
- Do not mention that this is a session, fork, summary, or draft
- Do not include quotes, brackets, emojis, or trailing punctuation
- The title must be a single line
- The title must be at most ${MAX_SESSION_TITLE_LENGTH} characters
- Return exactly this shape:
{
  "title": "Short title"
}`;
};

const SESSION_TITLE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: MAX_SESSION_TITLE_LENGTH,
    },
  },
  required: ["title"],
} as const;

const buildSessionTitleUserMessage = (input: SessionTitleContext) => {
  const messageLines = input.userMessages.map(
    (message, index) => `${index + 1}. ${message}`,
  );

  return [
    "Create a short session title from this intent context.",
    `- original topic: ${input.topic}`,
    `- user messages: ${messageLines.length > 0 ? messageLines.join(" / ") : "(none)"}`,
    `- requirement theme: ${input.requirementTheme ?? "(none)"}`,
    `- requirement objective: ${input.requirementObjective ?? "(none)"}`,
    `- fork message: ${input.forkMessage ?? "(none)"}`,
  ].join("\n");
};

export class OpenAiSessionTitleAgent implements SessionTitleAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async generateTitle(input: SessionTitleContext) {
    const content = await this.client.createJsonChatCompletion(
      [
        {
          role: "system",
          content: buildSessionTitleSystemPrompt(),
        },
        {
          role: "user",
          content: buildSessionTitleUserMessage(input),
        },
      ],
      {
        type: "json_schema",
        json_schema: {
          name: "session_title_response",
          schema: SESSION_TITLE_RESPONSE_SCHEMA,
        },
      },
    );

    return parseSessionTitle(content);
  }
}

export const parseSessionTitle = (content: string) => {
  let parsed: SessionTitleResponse;

  try {
    parsed = JSON.parse(content) as SessionTitleResponse;
  } catch {
    throw new Error("Failed to parse session title JSON.");
  }

  if (typeof parsed.title !== "string") {
    throw new Error("Session title JSON format is invalid.");
  }

  const title = parsed.title.trim();
  if (title.length === 0) {
    throw new Error("Session title is empty.");
  }

  if (title.includes("\n")) {
    throw new Error("Session title must be single-line.");
  }

  if (title.length > MAX_SESSION_TITLE_LENGTH) {
    throw new Error("Session title is too long.");
  }

  return title;
};

const getTitleLlmConfigFromEnv = (env: NodeJS.ProcessEnv = process.env) => ({
  baseUrl: env.ROLES_TITLE_OPENAI_BASE_URL ?? env.OPENAI_BASE_URL,
  apiKey: env.ROLES_TITLE_OPENAI_API_KEY ?? env.OPENAI_API_KEY,
  model: env.ROLES_TITLE_OPENAI_MODEL ?? env.OPENAI_MODEL,
});

export const createSessionTitleAgentFromEnv = () => {
  const { baseUrl, apiKey, model } = getTitleLlmConfigFromEnv();

  if (!baseUrl || !apiKey || !model) {
    logger.error("Session title LLM environment variables are missing", {
      hasBaseUrl: Boolean(baseUrl),
      hasApiKey: Boolean(apiKey),
      hasModel: Boolean(model),
    });
    throw new Error(
      "Set ROLES_TITLE_OPENAI_BASE_URL, ROLES_TITLE_OPENAI_API_KEY, and ROLES_TITLE_OPENAI_MODEL or fall back to OPENAI_*.",
    );
  }

  logger.info("Session title agent configured", {
    baseUrl,
    model,
  });

  return new OpenAiSessionTitleAgent(
    new OpenAiCompatibleClient(baseUrl, apiKey, model),
  );
};

export { MAX_SESSION_TITLE_LENGTH };
