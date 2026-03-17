import "../../test/silence-runtime";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createSessionTitleAgentFromEnv,
  parseSessionTitle,
} from "./session-title-agent";

const ORIGINAL_ENV = { ...process.env };

describe("parseSessionTitle", () => {
  test("正常な JSON からタイトルを取り出せる", () => {
    expect(parseSessionTitle(`{"title":"営業行動の整理"}`)).toBe(
      "営業行動の整理",
    );
  });

  test("複数行タイトルは失敗する", () => {
    expect(() => parseSessionTitle(`{"title":"営業\\n行動"}`)).toThrow(
      "Session title must be single-line.",
    );
  });

  test("長すぎるタイトルは失敗する", () => {
    expect(() =>
      parseSessionTitle(`{"title":"123456789012345678901234567890123"}`),
    ).toThrow("Session title is too long.");
  });
});

describe("createSessionTitleAgentFromEnv", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test("ROLES_TITLE_OPENAI_* があればそれを優先する", () => {
    process.env.OPENAI_BASE_URL = "http://default.example/v1";
    process.env.OPENAI_API_KEY = "default-key";
    process.env.OPENAI_MODEL = "default-model";
    process.env.ROLES_TITLE_OPENAI_BASE_URL = "http://title.example/v1";
    process.env.ROLES_TITLE_OPENAI_API_KEY = "title-key";
    process.env.ROLES_TITLE_OPENAI_MODEL = "title-model";

    const agent = createSessionTitleAgentFromEnv() as unknown as {
      client: { baseUrl: string; apiKey: string; model: string };
    };

    expect(agent.client.baseUrl).toBe("http://title.example/v1");
    expect(agent.client.apiKey).toBe("title-key");
    expect(agent.client.model).toBe("title-model");
  });

  test("ROLES_TITLE_OPENAI_* がなければ OPENAI_* にフォールバックする", () => {
    delete process.env.ROLES_TITLE_OPENAI_BASE_URL;
    delete process.env.ROLES_TITLE_OPENAI_API_KEY;
    delete process.env.ROLES_TITLE_OPENAI_MODEL;
    process.env.OPENAI_BASE_URL = "http://default.example/v1";
    process.env.OPENAI_API_KEY = "default-key";
    process.env.OPENAI_MODEL = "default-model";

    const agent = createSessionTitleAgentFromEnv() as unknown as {
      client: { baseUrl: string; apiKey: string; model: string };
    };

    expect(agent.client.baseUrl).toBe("http://default.example/v1");
    expect(agent.client.apiKey).toBe("default-key");
    expect(agent.client.model).toBe("default-model");
  });

  test("どちらの設定もない場合は失敗する", () => {
    delete process.env.ROLES_TITLE_OPENAI_BASE_URL;
    delete process.env.ROLES_TITLE_OPENAI_API_KEY;
    delete process.env.ROLES_TITLE_OPENAI_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;

    expect(() => createSessionTitleAgentFromEnv()).toThrow(
      "Set ROLES_TITLE_OPENAI_BASE_URL, ROLES_TITLE_OPENAI_API_KEY, and ROLES_TITLE_OPENAI_MODEL or fall back to OPENAI_*.",
    );
  });
});
