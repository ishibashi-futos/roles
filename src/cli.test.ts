import "./test/silence-runtime";
import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "./cli";
import type { RequirementAgent } from "./features/phase1/requirement-agent";
import type {
  FacilitatorAgent,
  JudgeAgent,
  RoleAgent,
} from "./features/phase2/agents";
import type { ReportAgent } from "./features/phase3/agent";
import { createRuntime } from "./runtime";
import { WorkflowSessionRepository } from "./shared/workflow-session-repository";
import type { Phase1Result } from "./shared/workflow-types";

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

const createIo = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
    stdout,
    stderr,
  };
};

const createTestRuntime = (
  overrides: {
    requirementAgent?: RequirementAgent;
    facilitatorAgent?: FacilitatorAgent;
    roleAgent?: RoleAgent;
    judgeAgent?: JudgeAgent;
    reportAgent?: ReportAgent;
  } = {},
) => {
  const repository = new WorkflowSessionRepository(":memory:");

  return createRuntime({
    repository,
    requirementAgent:
      overrides.requirementAgent ??
      ({
        async decide(input) {
          if (input.userReplyCount === 0) {
            return {
              kind: "ask",
              message: "利用部門と成功条件を教えてください。",
            };
          }

          return {
            kind: "complete",
            message: "定義がまとまりました。",
            result: completedResult,
          };
        },
      } satisfies RequirementAgent),
    facilitatorAgent:
      overrides.facilitatorAgent ??
      ({
        async decide(input) {
          return {
            discussionPointId: input.currentDiscussionPoint.id,
            targetRoleId: "role-1",
            message: `${input.currentDiscussionPoint.title}について意見をお願いします。`,
          };
        },
      } satisfies FacilitatorAgent),
    roleAgent:
      overrides.roleAgent ??
      ({
        async speak(input) {
          return `${input.role.name}として回答します。`;
        },
      } satisfies RoleAgent),
    judgeAgent:
      overrides.judgeAgent ??
      ({
        async decide() {
          return {
            isResolved: true,
            reason: "議論が十分に整理されました。",
          };
        },
      } satisfies JudgeAgent),
    reportAgent:
      overrides.reportAgent ??
      ({
        async generate() {
          return `# 決定事項

- CRM 入力を標準化する

# 対立意見

- 入力負荷への懸念がある

# 残課題

- 運用ルールの詳細化`;
        },
      } satisfies ReportAgent),
  });
};

const originalCliWaitTimeout = process.env.ROLES_CLI_WAIT_TIMEOUT_MS;

afterEach(() => {
  if (originalCliWaitTimeout === undefined) {
    delete process.env.ROLES_CLI_WAIT_TIMEOUT_MS;
    return;
  }

  process.env.ROLES_CLI_WAIT_TIMEOUT_MS = originalCliWaitTimeout;
});

describe("cli", () => {
  test("start --wait で追加質問を表示できる", async () => {
    const runtime = createTestRuntime();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["start", "--topic", "営業行動を整理したい", "--wait"],
      {
        io,
        createRuntime: () => runtime,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("sessionId:");
    expect(stdout.join("\n")).toContain("利用部門と成功条件を教えてください。");
  });

  test("reply --wait で要件定義完了まで進められる", async () => {
    const runtime = createTestRuntime();
    const createResult = createIo();

    await runCli(["start", "--topic", "営業行動を整理したい", "--wait"], {
      io: createResult.io,
      createRuntime: () => runtime,
    });
    const sessionId = runtime.repository.listSessions()[0]?.id;
    expect(sessionId).toBeDefined();

    const replyResult = createIo();
    const exitCode = await runCli(
      [
        "reply",
        "--session",
        sessionId as string,
        "--message",
        "営業本部向けで、CRM定着を成功条件にしたいです。",
        "--wait",
      ],
      {
        io: replyResult.io,
        createRuntime: () => runtime,
      },
    );

    expect(exitCode).toBe(0);
    expect(replyResult.stdout.join("\n")).toContain("要件定義が完了しました。");
    expect(replyResult.stdout.join("\n")).toContain("営業行動の可視化");
  });

  test("list と show で保存済みセッションを確認できる", async () => {
    const runtime = createTestRuntime();
    const session = runtime.repository.createSession("在庫最適化");

    const listResult = createIo();
    const listExitCode = await runCli(["list"], {
      io: listResult.io,
      createRuntime: () => runtime,
    });

    expect(listExitCode).toBe(0);
    expect(listResult.stdout.join("\n")).toContain(session.id);
    expect(listResult.stdout.join("\n")).toContain("在庫最適化");

    const showResult = createIo();
    const showExitCode = await runCli(["show", "--session", session.id], {
      io: showResult.io,
      createRuntime: () => runtime,
    });

    expect(showExitCode).toBe(0);
    expect(showResult.stdout.join("\n")).toContain(`sessionId: ${session.id}`);
    expect(showResult.stdout.join("\n")).toContain(
      "Phase1: collecting_requirements",
    );
  });

  test("start-discussion --wait で議論イベントを表示できる", async () => {
    const runtime = createTestRuntime();
    const session = runtime.repository.createSession("営業行動を整理したい");
    runtime.repository.completePhase1(
      session.id,
      "定義がまとまりました。",
      completedResult,
    );

    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(
      ["start-discussion", "--session", session.id, "--wait"],
      {
        io,
        createRuntime: () => runtime,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("[ファシリテーター]");
    expect(stdout.join("\n")).toContain("[Judge] resolved:");
    expect(stdout.join("\n")).toContain("議論が完了しました。");
  });

  test("report --wait で idle の Phase3 を開始して Markdown を表示できる", async () => {
    const runtime = createTestRuntime();
    const session = runtime.repository.createSession("営業行動を整理したい");
    runtime.repository.completePhase1(
      session.id,
      "定義がまとまりました。",
      completedResult,
    );
    runtime.repository.completePhase2(session.id, "resolved");

    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(
      ["report", "--session", session.id, "--wait"],
      {
        io,
        createRuntime: () => runtime,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("# 決定事項");
    expect(stdout.join("\n")).toContain("CRM 入力を標準化する");
  });

  test("list で --wait は使えない", async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(["list", "--wait"], {
      io,
      createRuntime: () => createTestRuntime(),
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain(
      "--wait cannot be used with this command.",
    );
  });

  test("show で Phase1 の processing 状態を表示できる", async () => {
    const runtime = createTestRuntime();
    const session = runtime.repository.createSession("営業行動を整理したい");
    runtime.repository.setPhase1Processing(session.id, true);

    const { io, stdout } = createIo();
    const exitCode = await runCli(["show", "--session", session.id], {
      io,
      createRuntime: () => runtime,
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain("isProcessing: yes");
  });

  test("start --wait は Phase1 待機タイムアウトで終了できる", async () => {
    process.env.ROLES_CLI_WAIT_TIMEOUT_MS = "10";
    const runtime = createTestRuntime({
      requirementAgent: {
        async decide() {
          return await new Promise(() => {});
        },
      },
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["start", "--topic", "営業行動を整理したい", "--wait"],
      {
        io,
        createRuntime: () => runtime,
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("\n")).toContain("sessionId:");
    expect(stderr.join("\n")).toContain(
      "Phase1 の待機がタイムアウトしました。",
    );
    expect(stderr.join("\n")).toContain("isProcessing: yes");
  });
});
