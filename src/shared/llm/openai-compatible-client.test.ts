import "../../test/silence-runtime";
import { afterEach, describe, expect, test } from "bun:test";
import { OpenAiCompatibleClient } from "./openai-compatible-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAiCompatibleClient", () => {
  test("タイムアウト時に明示的なエラーを返す", async () => {
    globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      })) as typeof fetch;

    const client = new OpenAiCompatibleClient(
      "http://localhost:1234/v1",
      "lmstudio",
      "qwen",
      10,
    );

    await expect(
      client.createTextChatCompletion([
        {
          role: "user",
          content: "hello",
        },
      ]),
    ).rejects.toThrow("LLM request timed out.");
  });
});
