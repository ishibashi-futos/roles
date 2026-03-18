import "../../test/silence-runtime";
import { describe, expect, test } from "bun:test";
import { createPhase1App } from "./routes";
import type { RequirementAgent } from "./requirement-agent";
import type { SessionTitleAgent } from "./session-title-agent";
import {
  buildRequirementAgentInstruction,
  buildRequirementAgentSystemPrompt,
  parseRequirementAgentDecision,
} from "./requirement-agent";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import { getOutputLanguageFromEnv } from "../../shared/output-language";

const completedResult = {
  requirements: {
    theme: "営業行動の可視化",
    objective: "営業活動をデータで管理する",
    successCriteria: ["活動履歴の収集", "案件進捗の可視化"],
    constraints: ["現場負荷を増やさない"],
    assumptions: ["既存 CRM を継続利用する"],
  },
  discussionPoints: [
    {
      id: "point-1",
      title: "取得対象データ",
      description: "何を営業活動データとして扱うか",
      decisionOwnerRoleId: "role-1",
    },
    {
      id: "point-2",
      title: "定着方法",
      description: "入力負荷を抑えながら運用する方法",
      decisionOwnerRoleId: "role-1",
    },
  ],
  openQuestions: [
    {
      id: "open-question-1",
      title: "現場マネージャー評価をどう設計するか",
      description: "ミドルマネージャーの抵抗をどう扱うかが未確定",
      whyItMatters: "定着施策と評価設計によって導入戦略が変わるため",
      suggestedOwnerRoleId: "role-1",
    },
  ],
  roles: [
    {
      id: "role-1",
      name: "営業責任者",
      perspective: "売上責任",
      responsibilities: ["施策優先順位の判断"],
      concerns: ["売上への悪影響"],
      systemPromptSeed: "売上責任の観点で発言する",
    },
    {
      id: "role-2",
      name: "現場営業",
      perspective: "入力実務",
      responsibilities: ["日々の活動入力"],
      concerns: ["入力負荷の増大"],
      systemPromptSeed: "現場負荷の観点で発言する",
    },
    {
      id: "role-3",
      name: "情シス",
      perspective: "運用保守",
      responsibilities: ["システム連携の整備"],
      concerns: ["保守コストの増大"],
      systemPromptSeed: "システム運用の観点で発言する",
    },
  ],
};

const createTestRepository = () => new WorkflowSessionRepository(":memory:");

const sessionTitleAgent: SessionTitleAgent = {
  async generateTitle(input) {
    return input.forkMessage ? "経営判断を優先する営業設計" : "営業行動の整理";
  },
};

const createTestApp = (options: Parameters<typeof createPhase1App>[0] = {}) =>
  createPhase1App({
    sessionTitleAgent,
    ...options,
  });

describe("parseRequirementAgentDecision", () => {
  test("complete の JSON を解釈できる", () => {
    const result = parseRequirementAgentDecision(
      JSON.stringify({
        kind: "complete",
        message: "定義がまとまりました。",
        result: completedResult,
      }),
    );

    expect(result.kind).toBe("complete");
  });

  test("不正な JSON は失敗する", () => {
    expect(() => parseRequirementAgentDecision("{invalid")).toThrow(
      "Failed to parse requirement agent JSON.",
    );
  });

  test("不完全な complete は失敗する", () => {
    expect(() =>
      parseRequirementAgentDecision(
        JSON.stringify({
          kind: "complete",
          message: "定義がまとまりました。",
          result: {
            requirements: completedResult.requirements,
            discussionPoints: completedResult.discussionPoints,
          },
        }),
      ),
    ).toThrow("Requirement agent returned invalid complete payload.");
  });

  test("存在しない意思決定者を持つ discussion point は失敗する", () => {
    expect(() =>
      parseRequirementAgentDecision(
        JSON.stringify({
          kind: "complete",
          message: "定義がまとまりました。",
          result: {
            ...completedResult,
            discussionPoints: [
              {
                ...completedResult.discussionPoints[0],
                decisionOwnerRoleId: "role-missing",
              },
              completedResult.discussionPoints[1],
            ],
          },
        }),
      ),
    ).toThrow("Requirement agent returned invalid complete payload.");
  });
});

describe("output language", () => {
  test("未設定時は ja を使う", () => {
    expect(getOutputLanguageFromEnv({})).toBe("ja");
  });

  test("要件定義役プロンプトを en に切り替えられる", () => {
    const prompt = buildRequirementAgentSystemPrompt("en");

    expect(prompt).toContain("Interact with the user in English");
  });

  test("要件定義役プロンプトは上位職種と指定ロールを許容する", () => {
    const prompt = buildRequirementAgentSystemPrompt("ja");

    expect(prompt).toContain(
      "Include executive or sponsor roles such as CxO, business owner, or department head when they are relevant to the topic",
    );
    expect(prompt).toContain(
      "If the user explicitly requests certain roles, titles, seniority levels, or stakeholder groups, reflect them in the generated roles unless they directly conflict with the topic",
    );
    expect(prompt).toContain(
      "Do not exclude a role only because it is senior, strategic, or not a day-to-day operator",
    );
    expect(prompt).toContain(
      "When you ask, ask exactly one major question about one missing issue only",
    );
    expect(prompt).toContain(
      'If some detail is missing but the discussion can still start, convert it into an explicit assumption or an open question and continue with kind="complete"',
    );
    expect(prompt).toContain(
      "The ask message must contain one open question first, then 2-3 example options",
    );
    expect(prompt).toContain(
      "The complete message must explain in one short paragraph why the current information is sufficient",
    );
  });

  test("要件定義役の補助指示は常に英語を使う", () => {
    expect(buildRequirementAgentInstruction(true)).toContain(
      'always return kind="complete"',
    );
    expect(buildRequirementAgentInstruction(true)).toContain(
      "recorded in openQuestions",
    );
    expect(buildRequirementAgentInstruction(false)).toContain(
      'Return kind="ask" only',
    );
    expect(buildRequirementAgentInstruction(false)).toContain(
      "include 2-3 example options",
    );
  });
});

describe("development reload", () => {
  test("トップページに開発用リロードスクリプトを含む", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/");
    const html = await response.text();

    expect(html).toContain('script src="/dev-reload.js"');
  });

  test("開発用サーバ状態 API を返す", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/api/dev/server-state");
    const payload = (await response.json()) as { bootId: string };

    expect(response.status).toBe(200);
    expect(payload.bootId).toBeString();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("開発用リロードスクリプトを静的配信する", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/dev-reload.js");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(body).toContain("/api/dev/server-state");
    expect(body).toContain('window.location.replace("/")');
  });
});

describe("phase1 routes", () => {
  test("トップページで favicon とホーム画面を表示する", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/icon.svg"');
    expect(html).toContain('alt="roles ロゴ"');
    expect(html).toContain("新規セッションを開始");
    expect(html).toContain("過去セッション");
    expect(html).toContain("削除");
  });

  test("新規セッション画面を表示できる", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/sessions/new");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("要件定義を開始");
    expect(html).toContain("ホームに戻る");
    expect(html).toContain("message-state-hint");
    expect(html).toContain("inputDisabledClassName");
    expect(html).toContain("buttonDisabledClassName");
    expect(html).toContain(
      "要件定義役が回答を処理中です。応答が返るまで入力と送信はできません。",
    );
  });

  test("icon.svg を静的配信できる", async () => {
    const app = createTestApp({
      repository: createTestRepository(),
    });

    const response = await app.request("/icon.svg");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  test("テーマ送信でセッションを作成できる", async () => {
    const agent: RequirementAgent = {
      async decide() {
        return {
          kind: "ask",
          message: "対象ユーザーを教えてください。",
        };
      },
    };

    const app = createTestApp({
      requirementAgent: agent,
      repository: createTestRepository(),
    });
    const response = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { sessionId: string };
    expect(payload.sessionId).toBeString();
  });

  test("タイトル生成失敗時はセッションを作成しない", async () => {
    const repository = createTestRepository();
    const app = createTestApp({
      repository,
      sessionTitleAgent: {
        async generateTitle() {
          throw new Error("upstream failed");
        },
      },
    });

    const response = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "failed to generate session title.",
    });
    expect(repository.listSessions()).toHaveLength(0);
  });

  test("追加回答で完了状態にできる", async () => {
    let callCount = 0;
    const agent: RequirementAgent = {
      async decide() {
        callCount += 1;
        if (callCount === 1) {
          return {
            kind: "ask",
            message: "対象ユーザーを教えてください。",
          };
        }
        return {
          kind: "complete",
          message: "定義がまとまりました。",
          result: completedResult,
        };
      },
    };

    const app = createTestApp({
      requirementAgent: agent,
      repository: createTestRepository(),
    });
    const createResponse = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });

    const created = (await createResponse.json()) as { sessionId: string };

    await Bun.sleep(0);

    const replyResponse = await app.request(
      `/api/phase1/sessions/${created.sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "対象は法人営業部門です。",
        }),
      },
    );

    expect(replyResponse.status).toBe(202);

    const eventsResponse = await app.request(
      `/api/phase1/sessions/${created.sessionId}/events`,
    );

    expect(eventsResponse.status).toBe(200);
    const text = await eventsResponse.text();
    expect(text).toContain("requirements_completed");
    expect(text).toContain("定義がまとまりました。");
  });

  test("既存セッションを個別ページで再開できる", async () => {
    const app = createTestApp({
      requirementAgent: {
        async decide() {
          return {
            kind: "ask",
            message: "対象ユーザーを教えてください。",
          };
        },
      },
      repository: createTestRepository(),
    });

    const createResponse = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });
    const created = (await createResponse.json()) as { sessionId: string };

    await Bun.sleep(0);

    const response = await app.request(`/sessions/${created.sessionId}`);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(`Session: ${created.sessionId}`);
    expect(html).toContain("対象ユーザーを教えてください。");
  });

  test("Phase1 完了後でも同じセッションで方向修正を送信できる", async () => {
    let callCount = 0;
    const app = createTestApp({
      requirementAgent: {
        async decide() {
          callCount += 1;
          return {
            kind: "complete",
            message:
              callCount === 1
                ? "最初の定義がまとまりました。"
                : "方向修正を反映しました。",
            result: completedResult,
          };
        },
      },
      repository: createTestRepository(),
    });

    const createResponse = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });
    const created = (await createResponse.json()) as { sessionId: string };
    await Bun.sleep(0);

    const replyResponse = await app.request(
      `/api/phase1/sessions/${created.sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "現場運用より経営判断を優先したいです。",
        }),
      },
    );

    expect(replyResponse.status).toBe(202);

    const eventsResponse = await app.request(
      `/api/phase1/sessions/${created.sessionId}/events`,
    );
    const text = await eventsResponse.text();
    expect(text).toContain("方向修正を反映しました。");
  });

  test("Phase1 完了済みセッションから新しいセッションを作成できる", async () => {
    const repository = createTestRepository();
    const app = createTestApp({
      requirementAgent: {
        async decide() {
          return {
            kind: "complete",
            message: "定義がまとまりました。",
            result: completedResult,
          };
        },
      },
      repository,
    });

    const createResponse = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });
    const created = (await createResponse.json()) as { sessionId: string };
    await Bun.sleep(0);

    const forkResponse = await app.request(
      `/api/sessions/${created.sessionId}/fork`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "方向性を経営判断寄りに変えたいです。",
        }),
      },
    );

    expect(forkResponse.status).toBe(201);
    const payload = (await forkResponse.json()) as { sessionId: string };
    expect(payload.sessionId).not.toBe(created.sessionId);
    await Bun.sleep(0);

    const forked = repository.getSession(payload.sessionId);
    expect(
      forked?.phase1.messages.some(
        (message) => message.content === "方向性を経営判断寄りに変えたいです。",
      ),
    ).toBe(true);
    expect(forked?.phase2.messages).toEqual([]);
  });

  test("セッションを削除できる", async () => {
    const repository = createTestRepository();
    const app = createTestApp({
      repository,
    });

    const created = repository.createSession({
      title: "営業行動の整理",
      topic: "営業行動をデータ化したい",
    });

    const response = await app.request(`/api/sessions/${created.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(repository.getSession(created.id)).toBeNull();
    expect(repository.getEventHistory(created.id)).toEqual([]);
  });

  test("エージェント失敗時は error イベントを返す", async () => {
    const agent: RequirementAgent = {
      async decide() {
        throw new Error("LLM request failed.");
      },
    };

    const app = createTestApp({
      requirementAgent: agent,
      repository: createTestRepository(),
    });
    const createResponse = await app.request("/api/phase1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        topic: "営業行動をデータ化したい",
      }),
    });
    const created = (await createResponse.json()) as { sessionId: string };

    await Bun.sleep(0);

    const eventsResponse = await app.request(
      `/api/phase1/sessions/${created.sessionId}/events`,
    );
    const text = await eventsResponse.text();

    expect(text).toContain("error");
    expect(text).toContain("LLM request failed.");
  });
});
