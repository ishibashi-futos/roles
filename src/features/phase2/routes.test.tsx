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
import type { SessionTitleAgent } from "../phase1/session-title-agent";
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
  async generateTitle() {
    return "営業行動の整理";
  },
};

const createTestApp = (options: Parameters<typeof createApp>[0] = {}) =>
  createApp({
    sessionTitleAgent,
    ...options,
  });

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
    const prompt = buildFacilitatorSystemPrompt("en");

    expect(prompt).toContain("structured discussion in English");
    expect(prompt).toContain("real-time exchange happening right now");
    expect(prompt).toContain("Do not assign deadlines");
    expect(prompt).toContain("one concise question or clarification");
  });

  test("ロールを en に切り替えられる", () => {
    const prompt = buildRoleSystemPrompt("en");

    expect(prompt).toContain("speak in English");
    expect(prompt).toContain("Use the role definition from the user message");
    expect(prompt).toContain(
      "State your concerns, objections, conditions, or risks directly",
    );
    expect(prompt).toContain("Do not make unsolicited suggestions");
    expect(prompt).toContain('Do not ask "may I", "should we"');
    expect(prompt).toContain("Do not agree too quickly");
    expect(prompt).toContain("Actively challenge weak assumptions");
    expect(prompt).not.toContain("Role name:");
  });

  test("judge を en に切り替えられる", () => {
    expect(buildJudgeSystemPrompt("en")).toContain("reason must be in English");
  });
});

describe("phase2 routes", () => {
  test("Arena ページで favicon と UI ロゴを参照する", async () => {
    const app = createTestApp({
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
    expect(html).toContain("/report/");
    expect(html).toContain("Meta を含めてコピー");
    expect(html).toContain("議論を再開");
    expect(html).toContain("+5ターン");
    expect(html).toContain("新しいセッションで方向修正");
  });

  test("createApp でも icon.svg を静的配信できる", async () => {
    const app = createTestApp({
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

    const app = createTestApp({
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
    expect(session.phase2.messages.length).toBe(6);

    const eventsResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/events`,
    );
    const eventsText = await eventsResponse.text();
    expect(eventsText).toContain("phase2_completed");
  });

  test("Phase2 state に現在セッションの実効ターン上限を含める", async () => {
    const app = createTestApp({
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
      maxTurnsPerPoint: 7,
      maxTotalTurns: 19,
    });
    const sessionId = await createSession(app);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const session = (await response.json()) as {
      phase2: {
        effectiveMaxTurnsPerPoint: number;
        effectiveMaxTotalTurns: number;
      };
    };

    expect(session.phase2.effectiveMaxTurnsPerPoint).toBe(7);
    expect(session.phase2.effectiveMaxTotalTurns).toBe(19);
  });

  test("Phase2 state に既定の実効ターン上限を含める", async () => {
    const app = createTestApp({
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
    const sessionId = await createSession(app);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const session = (await response.json()) as {
      phase2: {
        effectiveMaxTurnsPerPoint: number;
        effectiveMaxTotalTurns: number;
      };
    };

    expect(session.phase2.effectiveMaxTurnsPerPoint).toBe(18);
    expect(session.phase2.effectiveMaxTotalTurns).toBe(60);
  });

  test("実行中に論点ターン数と総ターン数を追加できる", async () => {
    const repository = createTestRepository();
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
        await Bun.sleep(50);
        return `${input.role.name}として回答します。`;
      },
    };
    const judgeAgent: JudgeAgent = {
      async decide() {
        return {
          isResolved: false,
          reason: "まだ追加議論が必要です。",
        };
      },
    };

    const app = createTestApp({
      repository,
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

    const addPointResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/points/point-1/add-turns`,
      {
        method: "POST",
      },
    );
    expect(addPointResponse.status).toBe(204);

    const addTotalResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/add-total-turns`,
      {
        method: "POST",
      },
    );
    expect(addTotalResponse.status).toBe(204);

    const stateResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const state = (await stateResponse.json()) as {
      phase2: {
        status: string;
        totalTurnAdjustment: number;
        pointTurnAdjustments: Array<{
          discussionPointId: string;
          addedTurns: number;
        }>;
        effectiveCurrentPointMaxTurns: number;
        effectiveMaxTotalTurns: number;
        effectivePointTurnLimits: Array<{
          discussionPointId: string;
          effectiveMaxTurns: number;
          addedTurns: number;
        }>;
      };
    };

    expect(state.phase2.status).toBe("running");
    expect(state.phase2.totalTurnAdjustment).toBe(5);
    expect(state.phase2.effectiveCurrentPointMaxTurns).toBe(23);
    expect(state.phase2.effectiveMaxTotalTurns).toBe(65);
    expect(state.phase2.pointTurnAdjustments).toContainEqual({
      discussionPointId: "point-1",
      addedTurns: 5,
    });
    expect(
      state.phase2.effectivePointTurnLimits.some(
        (point) =>
          point.discussionPointId === "point-1" &&
          point.effectiveMaxTurns === 23 &&
          point.addedTurns === 5,
      ),
    ).toBe(true);

    const events = repository.getEventHistory(sessionId);
    expect(
      events.filter((event) => event.event === "phase2_turn_budget_updated"),
    ).toHaveLength(2);
  });

  test("実行中以外はターン数を追加できない", async () => {
    const app = createTestApp({
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
    const sessionId = await createSession(app);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/add-total-turns`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
  });

  test("Phase1 未完了では開始できない", async () => {
    const app = createTestApp({
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

    const app = createTestApp({
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
    expect(retriedSession.phase2.messages.length).toBe(6);
    expect(
      retriedSession.phase2.messages.filter(
        (message) => message.discussionPointId === "point-1",
      ).length,
    ).toBe(2);
  });

  test("circuit_breaker 完了後に別セッションへ fork して議論を再開できる", async () => {
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
        return {
          isResolved: judgeCallCount >= 2,
          reason:
            judgeCallCount >= 2
              ? "論点が整理されました。"
              : "まだ追加議論が必要です。",
        };
      },
    };

    const app = createTestApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      reportAgent: {
        async generate() {
          return `# 決定事項

- 再開前のレポート

# 対立意見

- 追加議論が必要

# 残課題

- 次の打ち手を詰める`;
        },
      },
      maxTurnsPerPoint: 1,
    });
    const sessionId = await createSession(app);

    const startResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/start`,
      {
        method: "POST",
      },
    );

    expect(startResponse.status).toBe(202);
    await Bun.sleep(60);

    const sourceStateResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const sourceState = (await sourceStateResponse.json()) as {
      phase2: {
        status: string;
        completionReason: string | null;
        currentDiscussionPointIndex: number;
        currentTurnCount: number;
        totalTurnCount: number;
        pointStatuses: Array<{ status: string }>;
        messages: Array<{ turnNumber: number }>;
      };
      phase3: {
        reportMarkdown: string | null;
      };
    };

    expect(sourceState.phase2.status).toBe("completed");
    expect(sourceState.phase2.completionReason).toBe("circuit_breaker");
    expect(sourceState.phase2.pointStatuses[0]?.status).toBe("forced_stop");
    expect(sourceState.phase3.reportMarkdown).toContain("再開前のレポート");

    const resumeResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/resume`,
      {
        method: "POST",
      },
    );

    expect(resumeResponse.status).toBe(201);
    const resumePayload = (await resumeResponse.json()) as {
      sessionId: string;
    };
    expect(resumePayload.sessionId).not.toBe(sessionId);

    const resumedBeforeStartResponse = await app.request(
      `/api/sessions/${resumePayload.sessionId}/phase2/state`,
    );
    const resumedBeforeStart = (await resumedBeforeStartResponse.json()) as {
      phase2: {
        status: string;
        completionReason: string | null;
        currentDiscussionPointIndex: number;
        currentTurnCount: number;
        totalTurnCount: number;
        effectiveMaxTurnsPerPoint: number;
        effectiveMaxTotalTurns: number;
        maxTurnsPerPointOverride: number | null;
        maxTotalTurnsOverride: number | null;
        pointStatuses: Array<{ status: string }>;
        messages: Array<{ turnNumber: number }>;
      };
      phase3: {
        reportMarkdown: string | null;
      };
    };

    expect(resumedBeforeStart.phase2.status).toBe("idle");
    expect(resumedBeforeStart.phase2.completionReason).toBeNull();
    expect(resumedBeforeStart.phase2.currentDiscussionPointIndex).toBe(0);
    expect(resumedBeforeStart.phase2.currentTurnCount).toBe(1);
    expect(resumedBeforeStart.phase2.totalTurnCount).toBe(1);
    expect(resumedBeforeStart.phase2.effectiveMaxTurnsPerPoint).toBe(36);
    expect(resumedBeforeStart.phase2.effectiveMaxTotalTurns).toBe(90);
    expect(resumedBeforeStart.phase2.maxTurnsPerPointOverride).toBe(36);
    expect(resumedBeforeStart.phase2.maxTotalTurnsOverride).toBe(90);
    expect(resumedBeforeStart.phase2.pointStatuses[0]?.status).toBe("pending");
    expect(resumedBeforeStart.phase2.messages).toHaveLength(2);
    expect(resumedBeforeStart.phase3.reportMarkdown).toBeNull();

    const resumedStartResponse = await app.request(
      `/api/sessions/${resumePayload.sessionId}/phase2/start`,
      {
        method: "POST",
      },
    );

    expect(resumedStartResponse.status).toBe(202);
    await Bun.sleep(80);

    const resumedAfterStartResponse = await app.request(
      `/api/sessions/${resumePayload.sessionId}/phase2/state`,
    );
    const resumedAfterStart = (await resumedAfterStartResponse.json()) as {
      phase2: {
        status: string;
        completionReason: string | null;
        messages: Array<{ turnNumber: number }>;
      };
    };

    expect(resumedAfterStart.phase2.status).toBe("completed");
    expect(resumedAfterStart.phase2.completionReason).toBe("resolved");
    expect(resumedAfterStart.phase2.messages[2]?.turnNumber).toBe(2);
    expect(resumedAfterStart.phase2.messages[4]?.turnNumber).toBe(3);

    const sourceAfterResumeResponse = await app.request(
      `/api/sessions/${sessionId}/phase2/state`,
    );
    const sourceAfterResume = (await sourceAfterResumeResponse.json()) as {
      phase2: {
        completionReason: string | null;
        pointStatuses: Array<{ status: string }>;
      };
      phase3: {
        reportMarkdown: string | null;
      };
    };

    expect(sourceAfterResume.phase2.completionReason).toBe("circuit_breaker");
    expect(sourceAfterResume.phase2.pointStatuses[0]?.status).toBe(
      "forced_stop",
    );
    expect(sourceAfterResume.phase3.reportMarkdown).toContain(
      "再開前のレポート",
    );
  });

  test("resolved 完了セッションは resume できない", async () => {
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

    const app = createTestApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
    });
    const sessionId = await createSession(app);

    await app.request(`/api/sessions/${sessionId}/phase2/start`, {
      method: "POST",
    });
    await Bun.sleep(30);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/resume`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
  });

  test("未解決論点があれば completionReason に関係なく resume できる", async () => {
    const repository = createTestRepository();
    const app = createTestApp({
      repository,
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
    const sessionId = await createSession(app);

    repository.markPhase2Started(sessionId);
    repository.setPointStatus(sessionId, "point-1", "resolved");
    repository.updatePhase2Counters(sessionId, {
      currentDiscussionPointIndex: 1,
      currentTurnCount: 2,
      totalTurnCount: 4,
    });
    repository.completePhase2(sessionId, "resolved");

    const response = await app.request(
      `/api/sessions/${sessionId}/phase2/resume`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { sessionId: string };
    expect(payload.sessionId).not.toBe(sessionId);

    const resumedSession = repository.getSession(payload.sessionId);
    expect(resumedSession).not.toBeNull();
    if (!resumedSession) {
      throw new Error("session_not_found");
    }

    expect(resumedSession.phase2.status).toBe("idle");
    expect(resumedSession.phase2.completionReason).toBeNull();
    expect(resumedSession.phase2.currentDiscussionPointIndex).toBe(1);
    expect(resumedSession.phase2.pointStatuses).toEqual([
      { discussionPointId: "point-1", status: "resolved" },
      { discussionPointId: "point-2", status: "pending" },
      {
        discussionPointId: "open-question-open-question-1",
        status: "pending",
      },
    ]);
  });
});
