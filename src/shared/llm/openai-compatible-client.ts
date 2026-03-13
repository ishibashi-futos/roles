import { logger } from "../logger";

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAiResponseFormat =
  | {
      type: "text";
    }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        schema: Record<string, unknown>;
      };
    };

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: string | { message?: string };
};

export class OpenAiCompatibleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async createJsonChatCompletion(
    messages: OpenAiChatMessage[],
    responseFormat: OpenAiResponseFormat,
  ) {
    const url = `${this.baseUrl}/chat/completions`;
    const body = {
      model: this.model,
      messages,
      response_format: responseFormat,
    };

    logger.info("LLM request started", {
      url,
      model: this.model,
      messageCount: messages.length,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      logger.error("LLM request failed before response", {
        url,
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const responseText = await response.text();
    logger.info("LLM response received", {
      url,
      model: this.model,
      status: response.status,
      ok: response.ok,
      bodyPreview: responseText.slice(0, 500),
    });

    let payload: OpenAiChatCompletionResponse;
    try {
      payload = JSON.parse(responseText) as OpenAiChatCompletionResponse;
    } catch (error) {
      logger.error("LLM response JSON parse failed", {
        url,
        model: this.model,
        status: response.status,
        bodyPreview: responseText.slice(0, 500),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("LLM のレスポンス JSON を解釈できませんでした。");
    }

    if (!response.ok) {
      const message = extractErrorMessage(payload.error);
      logger.error("LLM returned error response", {
        url,
        model: this.model,
        status: response.status,
        message,
      });
      throw new Error(message);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      logger.error("LLM response content was empty", {
        url,
        model: this.model,
        status: response.status,
      });
      throw new Error("LLM の応答本文が空です。");
    }

    logger.info("LLM request completed", {
      url,
      model: this.model,
      contentPreview: content.slice(0, 300),
    });

    return content;
  }
}

const extractErrorMessage = (error: OpenAiChatCompletionResponse["error"]) => {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.length > 0
  ) {
    return error.message;
  }

  return "LLM 呼び出しに失敗しました。";
};
