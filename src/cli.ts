import type {
  ArenaMessage,
  JudgeDecisionRecord,
  WorkflowSession,
} from "./shared/workflow-types";
import { type CreateRuntimeOptions, createRuntime } from "./runtime";

type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

type RunCliOptions = {
  io?: CliIo;
  createRuntime?: (
    options?: CreateRuntimeOptions,
  ) => ReturnType<typeof createRuntime>;
};

type ParsedArguments = {
  values: Record<string, string>;
  wait: boolean;
};

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const CLI_USAGE = `Usage:
  roles serve
  roles cli start --topic "<topic>" [--wait]
  roles cli reply --session <sessionId> --message "<message>" [--wait]
  roles cli list
  roles cli show --session <sessionId>
  roles cli start-discussion --session <sessionId> [--wait]
  roles cli retry-discussion --session <sessionId> [--wait]
  roles cli report --session <sessionId> [--wait]
  roles cli retry-report --session <sessionId> [--wait]`;

const formatTimestamp = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const createUsageError = (message: string) => new Error(`usage:${message}`);

const requireArgument = (value: string | undefined, message: string) => {
  if (!value) {
    throw createUsageError(message);
  }
  return value;
};

const requireValue = (
  values: Record<string, string>,
  key: string,
  flag: string,
) => {
  const value = values[key];
  if (!value) {
    throw createUsageError(`missing required flag: ${flag}`);
  }
  return value;
};

const parseArguments = (
  args: string[],
  requiredFlags: string[],
  allowWait: boolean,
): ParsedArguments => {
  const values: Record<string, string> = {};
  let wait = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = requireArgument(
      args[index],
      "unexpected empty argument sequence.",
    );
    if (token === "--wait") {
      if (!allowWait) {
        throw createUsageError("--wait cannot be used with this command.");
      }
      wait = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw createUsageError(`unexpected argument: ${token}`);
    }
    if (!requiredFlags.includes(token)) {
      throw createUsageError(`unknown flag: ${token}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw createUsageError(`missing value for ${token}`);
    }
    values[token.slice(2)] = value;
    index += 1;
  }

  for (const flag of requiredFlags) {
    const key = flag.slice(2);
    if (!values[key]) {
      throw createUsageError(`missing required flag: ${flag}`);
    }
  }

  return {
    values,
    wait,
  };
};

const isPhase1Stable = (
  session: WorkflowSession,
  initialMessageCount: number,
) =>
  session.phase1.status === "completed" ||
  session.phase1.status === "failed" ||
  session.phase1.messages.length > initialMessageCount;

const printPhase1Outcome = (
  io: CliIo,
  session: WorkflowSession,
  initialMessageCount: number,
) => {
  const newMessages = session.phase1.messages.slice(initialMessageCount);
  const assistantMessages = newMessages.filter(
    (message) => message.role === "assistant",
  );

  for (const message of assistantMessages) {
    io.stdout(`要件定義役: ${message.content}`);
  }

  if (session.phase1.status === "completed" && session.phase1.result) {
    io.stdout(
      `要件定義が完了しました。論点: ${session.phase1.result.discussionPoints.length}件 / ロール: ${session.phase1.result.roles.length}件`,
    );
    io.stdout(`テーマ: ${session.phase1.result.requirements.theme}`);
  }

  if (session.phase1.status === "failed" && session.phase1.errorMessage) {
    io.stderr(`要件定義に失敗しました: ${session.phase1.errorMessage}`);
  }
};

const printArenaMessage = (io: CliIo, message: ArenaMessage) => {
  io.stdout(`[${message.speakerName}] ${message.content}`);
};

const printJudgeResult = (io: CliIo, result: JudgeDecisionRecord) => {
  io.stdout(
    `[Judge] ${result.isResolved ? "resolved" : "pending"}: ${result.reason}`,
  );
};

const getSessionStatusLabel = (session: WorkflowSession) => {
  if (session.phase3.status === "completed") {
    return "レポート完了";
  }
  if (session.phase3.status === "running") {
    return "レポート生成中";
  }
  if (session.phase3.status === "failed") {
    return "レポート失敗";
  }
  if (session.phase2.status === "completed") {
    return "議論完了";
  }
  if (session.phase2.status === "running") {
    return "議論中";
  }
  if (session.phase2.status === "failed") {
    return "議論失敗";
  }
  if (session.phase1.status === "completed") {
    return "議論開始待ち";
  }
  if (session.phase1.status === "failed") {
    return "要件定義失敗";
  }
  return "要件定義中";
};

const formatErrorMessage = (message: string) => {
  switch (message) {
    case "session_not_found":
      return "対象のセッションが存在しません。";
    case "session_not_collecting":
      return "このセッションは追加の入力を受け付けていません。";
    case "session_processing":
      return "このセッションは処理中です。";
    case "session_phase1_not_completed":
      return "Phase1 が完了していません。";
    case "phase2_not_idle":
      return "Phase2 を開始できる状態ではありません。";
    case "phase2_not_failed":
      return "Phase2 は再試行できる状態ではありません。";
    case "phase2_already_running":
      return "Phase2 は既に実行中です。";
    case "phase2_not_completed":
      return "Phase2 が完了していません。";
    case "phase3_not_idle":
      return "Phase3 を開始できる状態ではありません。";
    case "phase3_not_failed":
      return "Phase3 は再試行できる状態ではありません。";
    case "phase3_already_running":
      return "Phase3 は既に実行中です。";
    default:
      return message;
  }
};

const printSessionDetail = (io: CliIo, session: WorkflowSession) => {
  const discussionPoint =
    session.phase1.result?.discussionPoints[
      session.phase2.currentDiscussionPointIndex
    ];
  const lines = [
    `sessionId: ${session.id}`,
    `topic: ${session.topic}`,
    `updatedAt: ${formatTimestamp(session.updatedAt)}`,
    `status: ${getSessionStatusLabel(session)}`,
    "",
    `Phase1: ${session.phase1.status}`,
    `  messages: ${session.phase1.messages.length}`,
    `  userReplyCount: ${session.phase1.userReplyCount}`,
  ];

  if (session.phase1.errorMessage) {
    lines.push(`  error: ${session.phase1.errorMessage}`);
  }

  if (session.phase1.result) {
    lines.push(
      `  discussionPoints: ${session.phase1.result.discussionPoints.length}`,
    );
    lines.push(`  roles: ${session.phase1.result.roles.length}`);
  }

  lines.push("");
  lines.push(`Phase2: ${session.phase2.status}`);
  lines.push(`  currentPoint: ${discussionPoint?.title ?? "完了"}`);
  lines.push(`  currentTurnCount: ${session.phase2.currentTurnCount}`);
  lines.push(`  totalTurnCount: ${session.phase2.totalTurnCount}`);

  if (session.phase2.completionReason) {
    lines.push(`  completionReason: ${session.phase2.completionReason}`);
  }
  if (session.phase2.error) {
    lines.push(`  error: ${session.phase2.error.message}`);
  }

  lines.push("");
  lines.push(`Phase3: ${session.phase3.status}`);
  if (session.phase3.completionReason) {
    lines.push(`  completionReason: ${session.phase3.completionReason}`);
  }
  if (session.phase3.errorMessage) {
    lines.push(`  error: ${session.phase3.errorMessage}`);
  }
  lines.push(
    `  report: ${session.phase3.reportMarkdown ? "available" : "none"}`,
  );

  if (session.phase1.messages.length > 0) {
    lines.push("");
    lines.push("Phase1 messages:");
    for (const message of session.phase1.messages) {
      lines.push(
        `  [${message.role === "assistant" ? "要件定義役" : "あなた"}] ${message.content}`,
      );
    }
  }

  if (session.phase2.messages.length > 0) {
    lines.push("");
    lines.push("Phase2 messages:");
    for (const message of session.phase2.messages) {
      lines.push(`  [${message.speakerName}] ${message.content}`);
    }
  }

  io.stdout(lines.join("\n"));
};

const waitForPhase1 = async (
  runtime: ReturnType<typeof createRuntime>,
  sessionId: string,
  initialMessageCount: number,
) => {
  while (true) {
    const latest = runtime.phase1Service.getSession(sessionId);
    if (latest && isPhase1Stable(latest, initialMessageCount)) {
      return latest;
    }
    await Bun.sleep(500);
  }
};

const waitForPhase2 = async (
  runtime: ReturnType<typeof createRuntime>,
  sessionId: string,
  io: CliIo,
  initialMessageCount: number,
  initialJudgeDecisionCount: number,
) => {
  let printedMessageCount = initialMessageCount;
  let printedJudgeDecisionCount = initialJudgeDecisionCount;

  const flushDiff = (session: WorkflowSession) => {
    const newMessages = session.phase2.messages.slice(printedMessageCount);
    for (const message of newMessages) {
      printArenaMessage(io, message);
    }
    printedMessageCount = session.phase2.messages.length;

    const newJudgeDecisions = session.phase2.judgeDecisions.slice(
      printedJudgeDecisionCount,
    );
    for (const decision of newJudgeDecisions) {
      printJudgeResult(io, decision);
    }
    printedJudgeDecisionCount = session.phase2.judgeDecisions.length;
  };

  while (true) {
    const latest = runtime.phase2Service.getSession(sessionId);
    if (!latest) {
      await Bun.sleep(500);
      continue;
    }

    flushDiff(latest);
    if (
      latest.phase2.status === "completed" ||
      latest.phase2.status === "failed"
    ) {
      return latest;
    }

    await Bun.sleep(500);
  }
};

const waitForPhase3 = async (
  runtime: ReturnType<typeof createRuntime>,
  sessionId: string,
) => {
  while (true) {
    const latest = runtime.phase3Service.getSession(sessionId);
    if (
      latest &&
      (latest.phase3.status === "completed" || latest.phase3.status === "failed")
    ) {
      return latest;
    }
    await Bun.sleep(500);
  }
};

const printReport = (io: CliIo, session: WorkflowSession) => {
  if (!session.phase3.reportMarkdown) {
    io.stderr("レポートはまだ生成されていません。");
    return false;
  }

  io.stdout(session.phase3.reportMarkdown);
  return true;
};

const withRuntime = async (
  options: RunCliOptions,
  execute: (
    runtime: ReturnType<typeof createRuntime>,
    io: CliIo,
  ) => Promise<number>,
) => {
  const io = options.io ?? defaultIo;
  const runtimeFactory = options.createRuntime ?? createRuntime;
  const runtime = runtimeFactory();
  return await execute(runtime, io);
};

const handleUsageError = (io: CliIo, error: Error) => {
  const detail = error.message.replace(/^usage:/, "");
  io.stderr(detail);
  io.stderr("");
  io.stderr(CLI_USAGE);
  return 1;
};

export const runCli = async (args: string[], options: RunCliOptions = {}) => {
  const io = options.io ?? defaultIo;
  const command = args[0];

  if (!command) {
    io.stderr(CLI_USAGE);
    return 1;
  }

  try {
    switch (command) {
      case "start": {
        const parsed = parseArguments(args.slice(1), ["--topic"], true);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const topic = requireValue(parsed.values, "topic", "--topic");
          const session = runtime.phase1Service.createSession(topic);
          runtimeIo.stdout(`sessionId: ${session.id}`);
          runtimeIo.stdout(`topic: ${session.topic}`);
          runtimeIo.stdout("状態: 要件定義を開始しました。");

          if (!parsed.wait) {
            return 0;
          }

          const settled = await waitForPhase1(
            runtime,
            session.id,
            session.phase1.messages.length,
          );
          printPhase1Outcome(
            runtimeIo,
            settled,
            session.phase1.messages.length,
          );
          return settled.phase1.status === "failed" ? 1 : 0;
        });
      }
      case "reply": {
        const parsed = parseArguments(
          args.slice(1),
          ["--session", "--message"],
          true,
        );
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          const message = requireValue(parsed.values, "message", "--message");
          const current = runtime.phase1Service.getSession(sessionId);
          if (!current) {
            runtimeIo.stderr("対象のセッションが存在しません。");
            return 1;
          }

          const initialMessageCount = current.phase1.messages.length;
          try {
            runtime.phase1Service.submitReply(sessionId, message);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "unexpected_error";
            runtimeIo.stderr(formatErrorMessage(message));
            return 1;
          }

          runtimeIo.stdout("入力を受け付けました。");
          if (!parsed.wait) {
            return 0;
          }

          const settled = await waitForPhase1(
            runtime,
            sessionId,
            initialMessageCount + 1,
          );
          printPhase1Outcome(runtimeIo, settled, initialMessageCount + 1);
          return settled.phase1.status === "failed" ? 1 : 0;
        });
      }
      case "list":
        if (args.length > 1) {
          if (args[1] === "--wait") {
            throw createUsageError("--wait cannot be used with this command.");
          }
          throw createUsageError(`unexpected argument: ${args[1]}`);
        }
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessions = runtime.repository.listSessions();
          if (sessions.length === 0) {
            runtimeIo.stdout("セッションはまだありません。");
            return 0;
          }

          for (const session of sessions) {
            runtimeIo.stdout(
              [
                `sessionId: ${session.id}`,
                `topic: ${session.topic}`,
                `status: ${getSessionStatusLabel(session)}`,
                `updatedAt: ${formatTimestamp(session.updatedAt)}`,
                "",
              ].join("\n"),
            );
          }
          return 0;
        });
      case "show": {
        const parsed = parseArguments(args.slice(1), ["--session"], false);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          const session = runtime.repository.getSession(sessionId);
          if (!session) {
            runtimeIo.stderr("対象のセッションが存在しません。");
            return 1;
          }
          printSessionDetail(runtimeIo, session);
          return 0;
        });
      }
      case "start-discussion": {
        const parsed = parseArguments(args.slice(1), ["--session"], true);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          const current = runtime.phase2Service.getSession(sessionId);
          const initialMessageCount = current?.phase2.messages.length ?? 0;
          const initialJudgeDecisionCount =
            current?.phase2.judgeDecisions.length ?? 0;

          try {
            runtime.phase2Service.start(sessionId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "unexpected_error";
            runtimeIo.stderr(formatErrorMessage(message));
            return 1;
          }

          runtimeIo.stdout("議論を開始しました。");
          if (!parsed.wait) {
            return 0;
          }

          const settled = await waitForPhase2(
            runtime,
            sessionId,
            runtimeIo,
            initialMessageCount,
            initialJudgeDecisionCount,
          );
          if (settled.phase2.status === "failed") {
            runtimeIo.stderr(
              `議論に失敗しました: ${settled.phase2.error?.message ?? "unknown_error"}`,
            );
            return 1;
          }
          runtimeIo.stdout(
            `議論が完了しました。理由: ${settled.phase2.completionReason ?? "resolved"}`,
          );
          return 0;
        });
      }
      case "retry-discussion": {
        const parsed = parseArguments(args.slice(1), ["--session"], true);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          const current = runtime.phase2Service.getSession(sessionId);
          const initialMessageCount = current?.phase2.messages.length ?? 0;
          const initialJudgeDecisionCount =
            current?.phase2.judgeDecisions.length ?? 0;

          try {
            runtime.phase2Service.retry(sessionId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "unexpected_error";
            runtimeIo.stderr(formatErrorMessage(message));
            return 1;
          }

          runtimeIo.stdout("議論の再試行を開始しました。");
          if (!parsed.wait) {
            return 0;
          }

          const settled = await waitForPhase2(
            runtime,
            sessionId,
            runtimeIo,
            initialMessageCount,
            initialJudgeDecisionCount,
          );
          if (settled.phase2.status === "failed") {
            runtimeIo.stderr(
              `議論に失敗しました: ${settled.phase2.error?.message ?? "unknown_error"}`,
            );
            return 1;
          }
          runtimeIo.stdout(
            `議論が完了しました。理由: ${settled.phase2.completionReason ?? "resolved"}`,
          );
          return 0;
        });
      }
      case "report": {
        const parsed = parseArguments(args.slice(1), ["--session"], true);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          const current = runtime.phase3Service.getSession(sessionId);
          if (!current) {
            runtimeIo.stderr("対象のセッションが存在しません。");
            return 1;
          }
          if (current.phase2.status !== "completed") {
            runtimeIo.stderr("Phase2 が完了していません。");
            return 1;
          }
          if (current.phase3.status === "completed") {
            return printReport(runtimeIo, current) ? 0 : 1;
          }
          if (!parsed.wait) {
            runtimeIo.stderr(
              "レポートはまだ利用できません。--wait を使うと完了まで待機できます。",
            );
            return 1;
          }
          if (current.phase3.status === "failed") {
            runtimeIo.stderr(
              `レポート生成に失敗しています: ${current.phase3.errorMessage ?? "unknown_error"}`,
            );
            return 1;
          }
          if (current.phase3.status === "idle") {
            try {
              runtime.phase3Service.start(sessionId);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "unexpected_error";
              if (
                message !== "phase3_not_idle" &&
                message !== "phase3_already_running"
              ) {
                runtimeIo.stderr(formatErrorMessage(message));
                return 1;
              }
            }
          }

          const settled = await waitForPhase3(runtime, sessionId);
          if (settled.phase3.status === "failed") {
            runtimeIo.stderr(
              `レポート生成に失敗しました: ${settled.phase3.errorMessage ?? "unknown_error"}`,
            );
            return 1;
          }
          return printReport(runtimeIo, settled) ? 0 : 1;
        });
      }
      case "retry-report": {
        const parsed = parseArguments(args.slice(1), ["--session"], true);
        return await withRuntime(options, async (runtime, runtimeIo) => {
          const sessionId = requireValue(parsed.values, "session", "--session");
          try {
            runtime.phase3Service.retry(sessionId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "unexpected_error";
            runtimeIo.stderr(formatErrorMessage(message));
            return 1;
          }

          runtimeIo.stdout("レポート生成の再試行を開始しました。");
          if (!parsed.wait) {
            return 0;
          }

          const settled = await waitForPhase3(runtime, sessionId);
          if (settled.phase3.status === "failed") {
            runtimeIo.stderr(
              `レポート生成に失敗しました: ${settled.phase3.errorMessage ?? "unknown_error"}`,
            );
            return 1;
          }
          return printReport(runtimeIo, settled) ? 0 : 1;
        });
      }
      default:
        throw createUsageError(`unknown command: ${command}`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      typeof error.message === "string" &&
      error.message.startsWith("usage:")
    ) {
      return handleUsageError(io, error);
    }

    io.stderr(
      `CLI 実行中に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
};

export const CLI_HELP = CLI_USAGE;
