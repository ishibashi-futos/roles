import { OpenAiCompatibleClient } from "../../shared/llm/openai-compatible-client";
import { logger } from "../../shared/logger";
import {
  describeOutputLanguage,
  getOutputLanguageFromEnv,
  type OutputLanguage,
} from "../../shared/output-language";

export interface ReportAgent {
  generate(input: {
    topic: string;
    phase1Result: {
      requirements: unknown;
      discussionPoints: unknown;
      openQuestions: unknown;
      roles: unknown;
    };
    phase2: {
      completionReason: string | null;
      messages: unknown;
      judgeDecisions: unknown;
      pointStatuses: unknown;
    };
    unresolvedDiscussionPoints: string[];
  }): Promise<string>;
}

export const buildReportSystemPrompt = (
  outputLanguage: OutputLanguage,
  isCircuitBreaker: boolean,
) => `You are the report agent for roles.
You must write all report prose in ${describeOutputLanguage(outputLanguage)}.
Only the required Markdown headings may stay in Japanese.
Return Markdown only.
The Markdown must contain these exact level-1 headings in Japanese:
# 決定事項
# 対立意見
# 残課題
Do not omit any of the three sections.
Do not output JSON.
${
  isCircuitBreaker
    ? "The 残課題 section must explicitly mention forced_stop and every unresolved discussion point."
    : "Summarize only the final discussion outcomes and unresolved open questions from phase1 and phase2."
}`;

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

export class OpenAiReportAgent implements ReportAgent {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async generate(input: Parameters<ReportAgent["generate"]>[0]) {
    const outputLanguage = getOutputLanguageFromEnv();
    const markdown = await this.client.createTextChatCompletion([
      {
        role: "system",
        content: buildReportSystemPrompt(
          outputLanguage,
          input.phase2.completionReason === "circuit_breaker",
        ),
      },
      {
        role: "user",
        content: JSON.stringify(input, null, 2),
      },
    ]);

    const trimmed = markdown.trim();
    if (trimmed.length === 0) {
      throw new Error("report_markdown_is_empty");
    }

    return trimmed;
  }
}

export const createPhase3AgentFromEnv = () =>
  new OpenAiReportAgent(createClientFromEnv());

export const createFallbackPhase3Agent = () =>
  ({
    async generate() {
      throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY, and OPENAI_MODEL.");
    },
  }) satisfies ReportAgent;
