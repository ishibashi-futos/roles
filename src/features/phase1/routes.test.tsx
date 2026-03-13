import { describe, expect, test } from "bun:test";
import { createPhase1App } from "./routes";
import type { RequirementAgent } from "./requirement-agent";
import { parseRequirementAgentDecision } from "./requirement-agent";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";

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
    },
    {
      id: "point-2",
      title: "定着方法",
      description: "入力負荷を抑えながら運用する方法",
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

const createTestRepository = () =>
  new WorkflowSessionRepository(
    `/tmp/roles-phase1-${crypto.randomUUID()}.sqlite`,
  );

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
      "要件定義役の JSON を解釈できませんでした。",
    );
  });
});

describe("phase1 routes", () => {
  test("トップページで favicon と UI ロゴを参照する", async () => {
    const app = createPhase1App({
      repository: createTestRepository(),
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/icon.svg"');
    expect(html).toContain('alt="roles ロゴ"');
  });

  test("icon.svg を静的配信できる", async () => {
    const app = createPhase1App({
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

    const app = createPhase1App({
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

    const app = createPhase1App({
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

  test("エージェント失敗時は error イベントを返す", async () => {
    const agent: RequirementAgent = {
      async decide() {
        throw new Error("LLM 接続に失敗しました。");
      },
    };

    const app = createPhase1App({
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
    expect(text).toContain("LLM 接続に失敗しました。");
  });
});
