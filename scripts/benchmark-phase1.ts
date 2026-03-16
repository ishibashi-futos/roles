import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCli } from "../src/cli";
import { createRuntime } from "../src/runtime";
import { WorkflowSessionRepository } from "../src/shared/workflow-session-repository";

type Scenario = {
  id: string;
  name: string;
  topic: string;
  replies: string[];
};

type CommandCapture = {
  command: string[];
  durationMs: number;
  exitCode: number;
  stdout: string[];
  stderr: string[];
};

type ScenarioResult = {
  scenarioId: string;
  name: string;
  sessionId: string | null;
  initialResponseReached: boolean;
  initialResponseTimeMs: number | null;
  additionalQuestionCount: number;
  completeReached: boolean;
  askedAfterMaxReplies: boolean;
  phase2Startable: boolean;
  finalStatus: string | null;
  finalError: string | null;
  commands: CommandCapture[];
};

const MAX_USER_REPLY_COUNT = 3;
const OUTPUT_DIR = ".data/benchmarks";

const scenarios: Scenario[] = [
  {
    id: "A",
    name: "Sales behavior digitization",
    topic:
      "We want to capture top-performing enterprise sales behaviors and make them reusable for junior reps. Objective: improve opportunity creation rate by 20% within 6 months. Constraints: no extra CRM typing and Salesforce remains the system of record. Include perspectives from sales director, frontline manager, top seller, IT admin, and revops.",
    replies: [],
  },
  {
    id: "B",
    name: "Estimation process redesign",
    topic:
      "We need a better estimation process for a 50-person software consultancy. Goal: cut gross-margin variance by half in 3 months. Constraint: do not add more timesheet work. Include viewpoints from head of sales, project manager, engineering lead, and CFO.",
    replies: [
      "Most projects are fixed-price custom delivery projects with recurring estimation misses.",
      "Success means reducing quote-vs-actual gross-margin variance without adding daily reporting work.",
      "We can change review gates, approval flow, and estimation roles, but not add mandatory timesheet detail.",
    ],
  },
  {
    id: "C",
    name: "SIer sales digitization",
    topic:
      "Digitize SIer top sales habits with zero manual CRM input. Need a strategy to overcome resistance from old-school middle managers.",
    replies: [
      "Include perspectives from sales director, frontline manager, top seller, IT admin, and revops.",
    ],
  },
  {
    id: "D",
    name: "Enterprise onboarding redesign",
    topic:
      "We need to redesign enterprise customer onboarding for a B2B SaaS product. Goal: reduce time-to-first-value from 45 days to 21 days within two quarters. Constraint: no new headcount and no extra mandatory data entry for customer-facing teams. Include viewpoints from VP of Customer Success, implementation manager, solutions architect, product manager, and finance.",
    replies: [],
  },
  {
    id: "E",
    name: "Hiring quality improvement",
    topic:
      "Improve hiring quality for a 120-person startup without slowing down hiring speed. Include viewpoints from CEO, hiring manager, recruiter, engineering lead, and HR.",
    replies: [
      "Success means improving six-month new-hire performance and reducing regrettable hires.",
      "Do not increase the total number of interview stages or require extra manual scorecard writing.",
    ],
  },
];

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

const runCommand = async (
  runtime: ReturnType<typeof createRuntime>,
  command: string[],
) => {
  const startedAt = Date.now();
  const capture = createIo();
  const exitCode = await runCli(command, {
    io: capture.io,
    createRuntime: () => runtime,
  });

  return {
    command,
    durationMs: Date.now() - startedAt,
    exitCode,
    stdout: capture.stdout,
    stderr: capture.stderr,
  } satisfies CommandCapture;
};

const runScenario = async (scenario: Scenario) => {
  const runtime = createRuntime({
    repository: new WorkflowSessionRepository(":memory:"),
  });
  const commands: CommandCapture[] = [];
  let askedAfterMaxReplies = false;

  const startResult = await runCommand(runtime, [
    "start",
    "--topic",
    scenario.topic,
    "--wait",
  ]);
  commands.push(startResult);

  const session = runtime.repository.listSessions()[0] ?? null;
  const sessionId = session?.id ?? null;
  if (!sessionId) {
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      sessionId: null,
      initialResponseReached: false,
      initialResponseTimeMs: null,
      additionalQuestionCount: 0,
      completeReached: false,
      askedAfterMaxReplies: false,
      phase2Startable: false,
      finalStatus: null,
      finalError: "session_not_created",
      commands,
    } satisfies ScenarioResult;
  }

  for (const reply of scenario.replies) {
    const latest = runtime.repository.getSession(sessionId);
    if (!latest || latest.phase1.status !== "collecting_requirements") {
      break;
    }

    const replyResult = await runCommand(runtime, [
      "reply",
      "--session",
      sessionId,
      "--message",
      reply,
      "--wait",
    ]);
    commands.push(replyResult);

    const afterReply = runtime.repository.getSession(sessionId);
    if (
      afterReply &&
      afterReply.phase1.userReplyCount >= MAX_USER_REPLY_COUNT &&
      afterReply.phase1.status === "collecting_requirements"
    ) {
      askedAfterMaxReplies = true;
    }
  }

  const latest = runtime.repository.getSession(sessionId);
  const initialResponseReached = Boolean(
    latest &&
      (latest.phase1.messages.length > 1 ||
        latest.phase1.status !== "collecting_requirements"),
  );
  const assistantMessageCount =
    latest?.phase1.messages.filter((message) => message.role === "assistant")
      .length ?? 0;
  const additionalQuestionCount =
    latest?.phase1.status === "completed"
      ? Math.max(assistantMessageCount - 1, 0)
      : assistantMessageCount;

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    sessionId,
    initialResponseReached,
    initialResponseTimeMs: initialResponseReached
      ? startResult.durationMs
      : null,
    additionalQuestionCount,
    completeReached: latest?.phase1.status === "completed",
    askedAfterMaxReplies,
    phase2Startable: latest?.phase1.status === "completed",
    finalStatus: latest?.phase1.status ?? null,
    finalError: latest?.phase1.errorMessage ?? null,
    commands,
  } satisfies ScenarioResult;
};

const renderMarkdown = (results: ScenarioResult[]) => {
  const lines = [
    "# Phase1 Benchmark Result",
    "",
    `- executedAt: ${new Date().toISOString()}`,
    `- outputLanguage: ${process.env.ROLES_OUTPUT_LANGUAGE ?? "en"}`,
    `- model: ${process.env.OPENAI_MODEL ?? "unknown"}`,
    `- baseUrl: ${process.env.OPENAI_BASE_URL ?? "unknown"}`,
    "",
    "| Scenario | Initial | Time(ms) | Questions | Complete | After max replies ask | Phase2 startable | Final status |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- |",
  ];

  for (const result of results) {
    lines.push(
      `| ${result.scenarioId} | ${result.initialResponseReached ? "yes" : "no"} | ${result.initialResponseTimeMs ?? "-"} | ${result.additionalQuestionCount} | ${result.completeReached ? "yes" : "no"} | ${result.askedAfterMaxReplies ? "yes" : "no"} | ${result.phase2Startable ? "yes" : "no"} | ${result.finalStatus ?? "-"} |`,
    );
  }

  return lines.join("\n");
};

const main = async () => {
  process.env.ROLES_OUTPUT_LANGUAGE ??= "en";
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const jsonPath = join(OUTPUT_DIR, `phase1-benchmark-${timestamp}.json`);
  const markdownPath = join(OUTPUT_DIR, `phase1-benchmark-${timestamp}.md`);
  const payload = JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      scenarios: results,
    },
    null,
    2,
  );
  const markdown = renderMarkdown(results);

  mkdirSync(dirname(jsonPath), { recursive: true });
  await Bun.write(jsonPath, payload);
  await Bun.write(markdownPath, markdown);

  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);
  console.log("");
  console.log(markdown);
};

await main();
