import "../../test/silence-runtime";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type {
  FacilitatorDecision,
  Phase1Result,
} from "../../shared/workflow-types";
import type { FacilitatorAgent, JudgeAgent, RoleAgent } from "./agents";
import type { RequirementAgent } from "../phase1/requirement-agent";
import {
  buildFacilitatorSystemPrompt,
  buildJudgeSystemPrompt,
  buildRoleSystemPrompt,
  parseFacilitatorDecision,
  parseJudgeDecision,
} from "./agents";

const completedResult: Phase1Result = {
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

const createTestRepository = () => new WorkflowSessionRepository(":memory:");

const completeImmediatelyRequirementAgent: RequirementAgent = {
  async decide() {
    return {
      kind: "complete",
      message: "定義がまとまりました。",
      result: completedResult,
    };
  },
};

const createSession = async (app: ReturnType<typeof createApp>) => {
  const response = await app.request("/api/phase1/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      topic: "営業行動をデータ化したい",
    }),
  });
  const payload = (await response.json()) as { sessionId: string };
  await Bun.sleep(10);
  return payload.sessionId;
};

describe("phase2 parsers", () => {
  test("facilitator JSON を解釈できる", () => {
    const result = parseFacilitatorDecision(
      JSON.stringify({
        discussionPointId: "point-1",
        targetRoleId: "role-1",
        message: "営業責任者から意見を出してください。",
      }),
    );

    expect(result.targetRoleId).toBe("role-1");
  });

  test("judge JSON を解釈できる", () => {
    const result = parseJudgeDecision(
      JSON.stringify({
        isResolved: true,
        reason: "論点が整理されたためです。",
      }),
    );

    expect(result.isResolved).toBe(true);
  });
});

describe("phase2 output language prompts", () => {
  test("ファシリテーターを en に切り替えられる", () => {
    expect(buildFacilitatorSystemPrompt("en")).toContain(
      "structured discussion in English",
    );
  });

  test("ロールを en に切り替えられる", () => {
    const prompt = buildRoleSystemPrompt("en");

    expect(prompt).toContain("speak in English");
    expect(prompt).toContain("Use the role definition from the user message");
    expect(prompt).not.toContain("Role name:");
  });

  test("judge を en に切り替えられる", () => {
    expect(buildJudgeSystemPrompt("en")).toContain("reason must be in English");
  });
});

describe("phase2 routes", () => {
  test("Arena ページで favicon と UI ロゴを参照する", async () => {
    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
      roleAgent: {
        async speak() {
          throw new Error("unexpected");
        },
      },
      judgeAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
    });

    const response = await app.request("/arena/test-session");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/icon.svg"');
    expect(html).toContain('alt="roles ロゴ"');
  });

  test("createApp でも icon.svg を静的配信できる", async () => {
    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
      roleAgent: {
        async speak() {
          throw new Error("unexpected");
        },
      },
      judgeAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
    });

    const response = await app.request("/icon.svg");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  test("Phase1 完了後に Phase2 を開始できる", async () => {
    const facilitatorAgent: FacilitatorAgent = {
      async decide(input) {
        const targetRoleId =
          input.currentDiscussionPoint.id === "point-1" ? "role-1" : "role-2";
        return {
          discussionPointId: input.currentDiscussionPoint.id,
          targetRoleId,
          message: `${input.currentDiscussionPoint.title}について意見をお願いします。`,
        } satisfies FacilitatorDecision;
      },
    };
    const roleAgent: RoleAgent = {
      async speak(input) {
        return `${input.role.name}として回答します。`;
      },
    };
    const judgeAgent: JudgeAgent = {
      async decide() {
        return {
          isResolved: true,
          reason: "議論が十分に整理されました。",
        };
      },
    };

    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
    });
    const sessionId = await createSession(app);

    const startResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/start`,
      {
        method: "POST",
      },
    );

    expect(startResponse.status).toBe(202);

    await Bun.sleep(30);

    const stateResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const session = (await stateResponse.json()) as {
      phase2: {
        status: string;
        completionReason: string;
        messages: Array<unknown>;
      };
    };

    expect(session.phase2.status).toBe("completed");
    expect(session.phase2.completionReason).toBe("resolved");
    expect(session.phase2.messages.length).toBe(4);

    const eventsResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/events`,
    );
    const eventsText = await eventsResponse.text();
    expect(eventsText).toContain("phase2_completed");
  });

  test("Phase1 未完了では開始できない", async () => {
    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: {
        async decide() {
          return {
            kind: "ask",
            message: "対象部門を教えてください。",
          };
        },
      },
      facilitatorAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
      roleAgent: {
        async speak() {
          throw new Error("unexpected");
        },
      },
      judgeAgent: {
        async decide() {
          throw new Error("unexpected");
        },
      },
    });
    const sessionId = await createSession(app);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/start`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
  });

  test("failed 後に再試行すると現在論点を先頭から再実行する", async () => {
    let judgeCallCount = 0;
    const facilitatorAgent: FacilitatorAgent = {
      async decide(input) {
        return {
          discussionPointId: input.currentDiscussionPoint.id,
          targetRoleId: "role-1",
          message: `${input.currentDiscussionPoint.title}について意見をお願いします。`,
        };
      },
    };
    const roleAgent: RoleAgent = {
      async speak(input) {
        return `${input.currentDiscussionPoint.id} に対する ${input.role.name} の意見です。`;
      },
    };
    const judgeAgent: JudgeAgent = {
      async decide() {
        judgeCallCount += 1;
        if (judgeCallCount <= 3) {
          throw new Error("judge unavailable");
        }
        return {
          isResolved: true,
          reason: "論点が整理されました。",
        };
      },
    };

    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      maxRetryCount: 3,
    });
    const sessionId = await createSession(app);

    await app.request(`/api/sessions/${sessionId}/phase2/start`, {
      method: "POST",
    });
    await Bun.sleep(30);

    const failedStateResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const failedSession = (await failedStateResponse.json()) as {
      phase2: {
        status: string;
        messages: Array<{ discussionPointId: string }>;
      };
    };

    expect(failedSession.phase2.status).toBe("failed");
    expect(failedSession.phase2.messages.length).toBe(2);

    const retryResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/retry`,
      {
        method: "POST",
      },
    );

    expect(retryResponse.status).toBe(202);

    await Bun.sleep(30);

    const retriedStateResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const retriedSession = (await retriedStateResponse.json()) as {
      phase2: {
        status: string;
        messages: Array<{ discussionPointId: string }>;
      };
    };

    expect(retriedSession.phase2.status).toBe("completed");
    expect(retriedSession.phase2.messages.length).toBe(4);
    expect(
      retriedSession.phase2.messages.filter(
        (message) => message.discussionPointId === "point-1",
      ).length,
    ).toBe(2);
  });
});
