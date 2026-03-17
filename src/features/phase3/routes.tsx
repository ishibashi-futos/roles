import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { jsxRenderer } from "hono/jsx-renderer";
import { BrandMark, PageShell } from "../../shared/branding";
import { logger } from "../../shared/logger";
import type { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import { renderReportHtml } from "./report-markdown";
import type { Phase3Service } from "./service";

type RegisterPhase3RoutesOptions = {
  repository: WorkflowSessionRepository;
  service: Phase3Service;
};

const ReportPage = ({ sessionId }: { sessionId: string }) => (
  <main class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.18),_transparent_24%),linear-gradient(180deg,#fffdf6_0%,#f8fafc_48%,#eef2ff_100%)] px-4 py-8 text-slate-900">
    <div class="mx-auto max-w-6xl">
      <div class="mb-6 flex items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <BrandMark
            label="roles"
            accentClassName="text-sky-600"
            textClassName="text-slate-500"
          />
          <div>
            <h1 class="text-3xl font-semibold">Report</h1>
          </div>
        </div>
        <div class="flex gap-3">
          <a
            href={`/arena/${sessionId}`}
            class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
          >
            Arena に戻る
          </a>
          <a
            href="/"
            class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
          >
            ホームに戻る
          </a>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-[0.32fr_0.68fr]">
        <aside class="space-y-4">
          <section class="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-xl shadow-slate-950/5 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Session
            </p>
            <p
              id="session-id"
              data-session-id={sessionId}
              class="mt-3 text-sm text-slate-700"
            >
              {sessionId}
            </p>
            <p id="status-text" class="mt-4 text-sm text-sky-700" />
          </section>

          <section class="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-xl shadow-slate-950/5 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Meta
            </p>
            <div class="mt-4 space-y-4 text-sm text-slate-700">
              <div>
                <p class="text-slate-400">セッションタイトル</p>
                <p id="title-text" class="mt-1 whitespace-pre-wrap" />
              </div>
              <div>
                <p class="text-slate-400">初期入力</p>
                <p id="topic-text" class="mt-1 whitespace-pre-wrap" />
              </div>
              <div>
                <p class="text-slate-400">Phase 2 完了理由</p>
                <p id="completion-reason" class="mt-1" />
              </div>
              <div>
                <p class="text-slate-400">未解決論点</p>
                <p id="unresolved-points" class="mt-1" />
              </div>
            </div>
          </section>

          <section class="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-xl shadow-slate-950/5 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Export
            </p>
            <button
              id="copy-report-button"
              type="button"
              class="mt-4 hidden w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
            >
              Meta を含めてコピー
            </button>
            <p id="copy-status" class="mt-3 text-sm text-slate-500" />
          </section>

          <button
            id="resume-button"
            type="button"
            class="hidden w-full rounded-full border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900"
          >
            議論を再開
          </button>

          <button
            id="retry-button"
            type="button"
            class="hidden w-full rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950"
          >
            再試行
          </button>

          <section class="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-xl shadow-slate-950/5 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              方向修正
            </p>
            <p class="mt-3 text-sm leading-6 text-slate-700">
              ここで送った内容は新しいセッションに引き継ぎ、要件定義をやり直します。
            </p>
            <form id="fork-form" class="mt-4 space-y-3">
              <textarea
                id="fork-message"
                rows={4}
                class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-400"
                placeholder="例: 重視する論点や前提条件を変えたい"
              />
              <button
                id="fork-submit"
                type="submit"
                class="w-full rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-white"
              >
                新しいセッションで方向修正
              </button>
            </form>
          </section>
        </aside>

        <section class="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-2xl shadow-slate-950/8 backdrop-blur">
          <div
            id="banner"
            class="hidden rounded-2xl border px-4 py-3 text-sm"
          />
          <div id="loading" class="py-16 text-center text-sm text-slate-500">
            レポートを生成しています
          </div>
          <article
            id="report-content"
            class="prose prose-slate max-w-none hidden"
          />
        </section>
      </div>
    </div>
  </main>
);

const reportScript = `
const state = {
  sessionId: document.getElementById("session-id").dataset.sessionId,
  phaseState: null,
  eventSource: null,
  seenEventIds: new Set(),
};

const statusText = document.getElementById("status-text");
const titleText = document.getElementById("title-text");
const topicText = document.getElementById("topic-text");
const completionReason = document.getElementById("completion-reason");
const unresolvedPoints = document.getElementById("unresolved-points");
const banner = document.getElementById("banner");
const loading = document.getElementById("loading");
const reportContent = document.getElementById("report-content");
const copyReportButton = document.getElementById("copy-report-button");
const copyStatus = document.getElementById("copy-status");
const resumeButton = document.getElementById("resume-button");
const retryButton = document.getElementById("retry-button");
const forkForm = document.getElementById("fork-form");
const forkMessage = document.getElementById("fork-message");
const forkSubmit = document.getElementById("fork-submit");

const completionReasonLabel = (reason) => {
  if (reason === "resolved") {
    return "resolved";
  }
  if (reason === "circuit_breaker") {
    return "circuit_breaker";
  }
  if (reason === "failed") {
    return "failed";
  }
  return "未確定";
};

const canResumeDiscussion = () =>
  state.phaseState.phase2.status === "completed" &&
  state.phaseState.phase2.completionReason === "circuit_breaker";

const renderStatusText = () => {
  if (state.phaseState.phase2.status !== "completed") {
    statusText.textContent = "Phase 2 完了後に利用できます。";
    return;
  }
  if (canResumeDiscussion()) {
    statusText.textContent = "議論を再開すると、新しいセッションで続きから議論します。";
    return;
  }
  if (state.phaseState.phase3.status === "completed") {
    statusText.textContent = "保存済みレポートを表示しています。";
    return;
  }
  if (state.phaseState.phase3.status === "failed") {
    statusText.textContent = "レポート生成に失敗しました。";
    return;
  }
  statusText.textContent = "議事録役がレポートを生成しています。";
};

const renderMeta = () => {
  titleText.textContent = state.phaseState.title;
  topicText.textContent = state.phaseState.topic;
  completionReason.textContent = completionReasonLabel(state.phaseState.phase2.completionReason);
  unresolvedPoints.textContent = state.phaseState.phase2.hasUnresolvedPoints ? "あり" : "なし";
};

const buildCopyText = () => {
  const reportMarkdown = state.phaseState.phase3.reportMarkdown;
  if (!reportMarkdown) {
    return "";
  }

  return [
    "# Meta",
    "",
    "- セッションタイトル",
    state.phaseState.title,
    "",
    "- 初期入力",
    state.phaseState.topic,
    "",
    "- Phase 2 完了理由",
    completionReasonLabel(state.phaseState.phase2.completionReason),
    "",
    "- 未解決論点",
    state.phaseState.phase2.hasUnresolvedPoints ? "あり" : "なし",
    "",
    "# Report",
    "",
    reportMarkdown,
  ].join("\\n");
};

const clearCopyStatus = () => {
  copyStatus.textContent = "";
};

const renderBanner = () => {
  banner.className = "rounded-2xl border px-4 py-3 text-sm";
  banner.textContent = "";

  if (state.phaseState.phase2.status !== "completed") {
    banner.classList.remove("hidden");
    banner.classList.add("border-amber-300", "bg-amber-50", "text-amber-900");
    banner.textContent = "このセッションはまだ Report を生成できません。";
    return;
  }

  if (state.phaseState.phase3.status === "failed") {
    banner.classList.remove("hidden");
    banner.classList.add("border-rose-300", "bg-rose-50", "text-rose-900");
    banner.textContent = state.phaseState.phase3.errorMessage || "レポート生成に失敗しました。";
    return;
  }

  if (
    state.phaseState.phase2.completionReason === "circuit_breaker" &&
    state.phaseState.phase3.status === "completed"
  ) {
    banner.classList.remove("hidden");
    banner.classList.add("border-amber-300", "bg-amber-50", "text-amber-900");
    banner.textContent = "最大ターン数到達で終了したため、残課題を含むレポートです。";
    return;
  }

  banner.classList.add("hidden");
};

const renderReport = () => {
  const isCompleted = state.phaseState.phase3.status === "completed" && state.phaseState.reportHtml;
  loading.classList.toggle("hidden", Boolean(isCompleted) || state.phaseState.phase3.status === "failed" || state.phaseState.phase2.status !== "completed");
  reportContent.classList.toggle("hidden", !isCompleted);
  copyReportButton.classList.toggle("hidden", !isCompleted);
  retryButton.classList.toggle(
    "hidden",
    state.phaseState.phase3.status !== "failed" || state.phaseState.phase2.status !== "completed",
  );
  resumeButton.classList.toggle("hidden", !canResumeDiscussion());

  if (isCompleted) {
    reportContent.innerHTML = state.phaseState.reportHtml;
    return;
  }

  reportContent.innerHTML = "";
  clearCopyStatus();

  if (state.phaseState.phase2.status !== "completed") {
    loading.textContent = "Phase 2 完了後にレポートを生成できます。";
    return;
  }

  if (state.phaseState.phase3.status === "failed") {
    loading.textContent = "";
    return;
  }

  loading.textContent = "レポートを生成しています";
};

const render = () => {
  renderStatusText();
  renderMeta();
  renderBanner();
  renderReport();
};

const shouldHandleEvent = (event) => {
  const eventId = event.lastEventId || "";
  if (!eventId) {
    return true;
  }
  if (state.seenEventIds.has(eventId)) {
    return false;
  }
  state.seenEventIds.add(eventId);
  return true;
};

const hydrate = async () => {
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase3/state\`);
  if (!response.ok) {
    statusText.textContent = "状態の取得に失敗しました。";
    return false;
  }
  state.phaseState = await response.json();
  render();
  return true;
};

const connectEvents = () => {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(\`/api/sessions/\${state.sessionId}/phase3/events\`);
  state.eventSource.addEventListener("phase3_started", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    state.phaseState.phase3.status = "running";
    state.phaseState.phase3.errorMessage = null;
    render();
  });
  state.eventSource.addEventListener("phase3_completed", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    await hydrate();
  });
  state.eventSource.addEventListener("error", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.phaseState.phase3.status = "failed";
    state.phaseState.phase3.errorMessage = payload.message;
    render();
    await hydrate();
  });
};

const startIfNeeded = async () => {
  if (state.phaseState.phase2.status !== "completed") {
    return;
  }
  if (state.phaseState.phase3.status !== "idle") {
    return;
  }
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase3/start\`, {
    method: "POST",
  });
  if (!response.ok) {
    await hydrate();
  }
};

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase3/retry\`, {
    method: "POST",
  });
  await hydrate();
  retryButton.disabled = false;
  if (!response.ok) {
    statusText.textContent = "再試行の開始に失敗しました。";
  }
});

copyReportButton.addEventListener("click", async () => {
  const text = buildCopyText();
  if (!text) {
    copyStatus.textContent = "コピーできるレポートがありません。";
    return;
  }

  copyReportButton.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = "Meta を含むレポートをコピーしました。";
  } catch {
    copyStatus.textContent = "クリップボードへのコピーに失敗しました。";
  } finally {
    copyReportButton.disabled = false;
  }
});

resumeButton.addEventListener("click", async () => {
  resumeButton.disabled = true;
  statusText.textContent = "再開用の新しいセッションを作成しています。";
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/resume\`, {
    method: "POST",
  });

  if (!response.ok) {
    resumeButton.disabled = false;
    await hydrate();
    statusText.textContent = "議論再開用セッションの作成に失敗しました。";
    return;
  }

  const payload = await response.json();
  window.location.href = \`/arena/\${payload.sessionId}\`;
});

forkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = forkMessage.value.trim();
  if (!message) {
    statusText.textContent = "方向修正したい内容を入力してください。";
    return;
  }

  forkSubmit.disabled = true;
  statusText.textContent = "新しいセッションを作成しています。";

  const response = await fetch(\`/api/sessions/\${state.sessionId}/fork\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });

  forkSubmit.disabled = false;

  if (!response.ok) {
    statusText.textContent = "新しいセッションの作成に失敗しました。";
    return;
  }

  const payload = await response.json();
  window.location.href = \`/sessions/\${payload.sessionId}\`;
});

const boot = async () => {
  const hydrated = await hydrate();
  if (!hydrated) {
    return;
  }
  connectEvents();
  await startIfNeeded();
};

boot();
`;

const buildPhase3StateResponse = (
  session: NonNullable<ReturnType<Phase3Service["getSession"]>>,
) => ({
  sessionId: session.id,
  title: session.title,
  topic: session.topic,
  phase2: {
    status: session.phase2.status,
    completionReason: session.phase2.completionReason,
    hasUnresolvedPoints: session.phase2.pointStatuses.some(
      (status) => status.status !== "resolved",
    ),
  },
  phase3: session.phase3,
  reportHtml: session.phase3.reportMarkdown
    ? renderReportHtml(session.phase3.reportMarkdown)
    : null,
});

export const registerPhase3Routes = (
  app: Hono,
  options: RegisterPhase3RoutesOptions,
) => {
  const { repository, service } = options;

  app.use(
    "/report/*",
    jsxRenderer(({ children }) => (
      <PageShell title="roles Report">{children}</PageShell>
    )),
  );

  app.get("/report/:sessionId", (c) =>
    c.render(
      <>
        <ReportPage sessionId={c.req.param("sessionId")} />
        <script dangerouslySetInnerHTML={{ __html: reportScript }} />
      </>,
    ),
  );

  app.get("/api/sessions/:sessionId/phase3/state", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      return c.json({ message: "session not found." }, 404);
    }

    return c.json(buildPhase3StateResponse(session));
  });

  app.post("/api/sessions/:sessionId/phase3/start", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      service.start(sessionId);
      return c.body(null, 202);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase3 start failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (message === "phase2_not_completed") {
        return c.json(
          { message: "only sessions with completed phase 2 can start." },
          409,
        );
      }
      if (
        message === "phase3_not_idle" ||
        message === "phase3_already_running"
      ) {
        return c.json({ message: "this session cannot be started." }, 409);
      }
      return c.json({ message: "failed to start phase 3." }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/phase3/retry", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      service.retry(sessionId);
      return c.body(null, 202);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase3 retry failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (message === "phase2_not_completed") {
        return c.json(
          { message: "only sessions with completed phase 2 can retry." },
          409,
        );
      }
      if (
        message === "phase3_not_failed" ||
        message === "phase3_already_running"
      ) {
        return c.json({ message: "this session cannot be retried." }, 409);
      }
      return c.json({ message: "failed to start phase 3 retry." }, 500);
    }
  });

  app.get("/api/sessions/:sessionId/phase3/events", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      return c.json({ message: "session not found." }, 404);
    }

    return streamSSE(c, async (stream) => {
      const send = async (
        eventName: string,
        data: unknown,
        eventId?: number,
      ) => {
        await stream.writeSSE({
          id: eventId ? String(eventId) : undefined,
          event: eventName,
          data: JSON.stringify(data),
        });
      };

      await send("ready", { sessionId });

      for (const event of repository.getEventHistory(sessionId)) {
        if (
          event.event !== "phase3_started" &&
          event.event !== "phase3_completed" &&
          !(event.event === "error" && session.phase3.status === "failed")
        ) {
          continue;
        }
        await send(event.event, event.data, event.id);
      }

      const latestSession = service.getSession(sessionId);
      if (
        !latestSession ||
        latestSession.phase3.status === "completed" ||
        latestSession.phase3.status === "failed"
      ) {
        return;
      }

      let resolveClosed: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const unsubscribe = service.subscribe(sessionId, (event) => {
        if (
          event.event !== "phase3_started" &&
          event.event !== "phase3_completed" &&
          event.event !== "error"
        ) {
          return;
        }
        void (async () => {
          await send(event.event, event.data, event.id);
          if (event.event === "phase3_completed" || event.event === "error") {
            unsubscribe();
            resolveClosed?.();
          }
        })();
      });

      c.req.raw.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          logger.info("Phase3 SSE connection aborted", {
            sessionId,
          });
          resolveClosed?.();
        },
        { once: true },
      );

      await closed;
    });
  });
};
