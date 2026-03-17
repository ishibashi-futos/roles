import "../../test/silence-runtime";
import { describe, expect, test } from "bun:test";
import { createApp } from "../../app";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { Phase1Result } from "../../shared/workflow-types";
import type { RequirementAgent } from "../phase1/requirement-agent";
import type { FacilitatorAgent, JudgeAgent, RoleAgent } from "../phase2/agents";
import { buildReportSystemPrompt, type ReportAgent } from "./agent";
import { renderReportHtml, validateReportMarkdown } from "./report-markdown";

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

const completeImmediatelyRequirementAgent: RequirementAgent = {
  async decide() {
    return {
      kind: "complete",
      message: "定義がまとまりました。",
      result: completedResult,
    };
  },
};

const createTestRepository = () => new WorkflowSessionRepository(":memory:");

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

const createCompletedPhase2Session = async (
  app: ReturnType<typeof createApp>,
) => {
  const sessionId = await createSession(app);
  const response = await app.request(
    `/api/sessions/${sessionId}/phase2/start`,
    {
      method: "POST",
    },
  );

  expect(response.status).toBe(202);
  await Bun.sleep(30);
  return sessionId;
};

describe("phase3 prompt", () => {
  test("report を en に切り替えられる", () => {
    const prompt = buildReportSystemPrompt("en", false);

    expect(prompt).toContain("write all report prose in English");
    expect(prompt).toContain("# 決定事項");
  });
});

describe("phase3 markdown", () => {
  test("必須見出しを含む Markdown を検証できる", () => {
    expect(() =>
      validateReportMarkdown(`# 決定事項

- 結論

# 対立意見

**懸念** が残る

# 残課題

| 項目 | 内容 |
| --- | --- |
| 次回 | 確認 |`),
    ).not.toThrow();
  });

  test("必須見出し不足を失敗扱いにできる", () => {
    expect(() =>
      validateReportMarkdown(`# 決定事項

本文`),
    ).toThrow("report_markdown_missing_sections");
  });

  test("対応構文を安全な HTML に変換できる", () => {
    const html = renderReportHtml(`# 決定事項

- **重要** な合意

# 対立意見

段落です。

# 残課題

| 項目 | 内容 |
| --- | --- |
| 確認 | 継続 |`);

    expect(html).toContain("<strong>重要</strong>");
    expect(html).toContain("<table");
    expect(html).not.toContain("<script");
  });
});

describe("phase3 routes", () => {
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

  test("Report ページを返す", async () => {
    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      reportAgent: {
        async generate() {
          throw new Error("unexpected");
        },
      },
    });

    const response = await app.request("/report/test-session");

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Report");
    expect(html).toContain("Meta を含めてコピー");
    expect(html).toContain("議論を再開");
    expect(html).toContain("新しいセッションで方向修正");
  });

  test("Phase2 完了後に Phase3 が自動で開始される", async () => {
    let reportCallCount = 0;
    const reportAgent: ReportAgent = {
      async generate() {
        reportCallCount += 1;
        return `# 決定事項

- CRM 入力を標準化する

# 対立意見

- 入力負荷への懸念がある

# 残課題

- 運用ルールの詳細化`;
      },
    };

    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      reportAgent,
    });
    const sessionId = await createCompletedPhase2Session(app);
    await Bun.sleep(30);

    const stateResponse = await app.request(
      `/api/sessions/${sessionId}/phase3/state`,
    );
    const state = (await stateResponse.json()) as {
      phase2: {
        status: string;
      };
      phase3: {
        status: string;
        reportMarkdown: string | null;
      };
      reportHtml: string | null;
    };

    expect(state.phase2.status).toBe("completed");
    expect(state.phase3.status).toBe("completed");
    expect(state.phase3.reportMarkdown).toContain("# 決定事項");
    expect(state.reportHtml).toContain("<h1");
    expect(reportCallCount).toBe(1);

    const eventsResponse = await app.request(
      `/api/sessions/${sessionId}/phase3/events`,
    );
    const eventsText = await eventsResponse.text();
    expect(eventsText).toContain("phase3_completed");
  });

  test("Phase2 未完了では開始できない", async () => {
    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      reportAgent: {
        async generate() {
          throw new Error("unexpected");
        },
      },
    });
    const sessionId = await createSession(app);

    const response = await app.request(
      `/api/sessions/${sessionId}/phase3/start`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
  });

  test("3 回失敗後に failed になり retry で再生成できる", async () => {
    let callCount = 0;
    const reportAgent: ReportAgent = {
      async generate() {
        callCount += 1;
        if (callCount <= 3) {
          throw new Error("report unavailable");
        }
        return `# 決定事項

- 標準運用を継続する

# 対立意見

- 現場負荷の懸念が残る

# 残課題

- 定着施策を再確認する`;
      },
    };

    const app = createApp({
      repository: createTestRepository(),
      requirementAgent: completeImmediatelyRequirementAgent,
      facilitatorAgent,
      roleAgent,
      judgeAgent,
      reportAgent,
      maxRetryCount: 3,
    });
    const sessionId = await createCompletedPhase2Session(app);

    await app.request(`/api/sessions/${sessionId}/phase3/start`, {
      method: "POST",
    });
    await Bun.sleep(30);

    const failedStateResponse = await app.request(
      `/api/sessions/${sessionId}/phase3/state`,
    );
    const failedState = (await failedStateResponse.json()) as {
      phase3: {
        status: string;
        errorMessage: string | null;
      };
    };

    expect(failedState.phase3.status).toBe("failed");
    expect(failedState.phase3.errorMessage).toContain(
      "report generation failed 3 times",
    );

    const retryResponse = await app.request(
      `/api/sessions/${sessionId}/phase3/retry`,
      {
        method: "POST",
      },
    );

    expect(retryResponse.status).toBe(202);
    await Bun.sleep(30);

    const retriedStateResponse = await app.request(
      `/api/sessions/${sessionId}/phase3/state`,
    );
    const retriedState = (await retriedStateResponse.json()) as {
      phase3: {
        status: string;
        reportMarkdown: string | null;
      };
    };

    expect(retriedState.phase3.status).toBe("completed");
    expect(retriedState.phase3.reportMarkdown).toContain("# 残課題");
  });
});
