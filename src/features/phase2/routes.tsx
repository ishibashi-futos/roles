import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { jsxRenderer } from "hono/jsx-renderer";
import { BrandMark, PageShell } from "../../shared/branding";
import { logger } from "../../shared/logger";
import type { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { Phase2Service } from "./service";

type RegisterPhase2RoutesOptions = {
  repository: WorkflowSessionRepository;
  service: Phase2Service;
};

const ArenaPage = ({ sessionId }: { sessionId: string }) => (
  <main class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.26),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_28%),radial-gradient(circle_at_bottom,_rgba(139,92,246,0.18),_transparent_34%),linear-gradient(180deg,#081120_0%,#0b1730_55%,#081120_100%)] px-4 py-8">
    <div class="mx-auto max-w-7xl">
      <div class="mb-6 flex items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <BrandMark
            label="roles"
            accentClassName="text-cyan-200"
            textClassName="text-slate-400"
          />
          <div>
            <h1 class="text-3xl font-semibold">Arena</h1>
          </div>
        </div>
        <a
          href="/"
          class="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
        >
          ホームに戻る
        </a>
      </div>

      <div class="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <section class="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm uppercase tracking-[0.24em] text-slate-400">
                Session
              </p>
              <p
                id="session-id"
                data-session-id={sessionId}
                class="mt-2 text-sm text-slate-200"
              >
                {sessionId}
              </p>
            </div>
            <p id="status-text" class="text-sm text-cyan-200" />
          </div>

          <div
            id="banner"
            class="mt-6 hidden rounded-2xl border border-white/10 px-4 py-3 text-sm"
          />

          <div id="messages" class="mt-6 space-y-3" />
        </section>

        <aside class="space-y-4">
          <section class="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Dashboard
            </p>
            <div class="mt-4 space-y-4 text-sm text-slate-200">
              <div>
                <p class="text-slate-400">現在の論点</p>
                <p id="current-point" class="mt-1" />
              </div>
              <div>
                <p class="text-slate-400">現在論点ターン数</p>
                <p id="current-turn-count" class="mt-1" />
              </div>
              <div>
                <p class="text-slate-400">総ターン数</p>
                <p id="total-turn-count" class="mt-1" />
              </div>
              <div>
                <p class="text-slate-400">直近 Judge 判定</p>
                <p id="judge-result" class="mt-1 whitespace-pre-wrap" />
              </div>
            </div>
          </section>

          <section class="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Discussion Points
            </p>
            <div id="point-statuses" class="mt-4 space-y-3" />
          </section>

          <button
            id="resume-button"
            type="button"
            class="hidden w-full rounded-full border border-amber-300/40 bg-amber-300/10 px-5 py-3 text-sm font-semibold text-amber-100"
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

          <a
            id="report-link"
            href={`/report/${sessionId}`}
            class="hidden w-full rounded-full border border-cyan-300/40 bg-cyan-300/10 px-5 py-3 text-center text-sm font-semibold text-cyan-100"
          >
            レポートを見る
          </a>

          <section class="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              方向修正
            </p>
            <p class="mt-3 text-sm leading-6 text-slate-300">
              ここで送った内容は新しいセッションに引き継ぎ、要件定義を最初からやり直します。
            </p>
            <form id="fork-form" class="mt-4 space-y-3">
              <textarea
                id="fork-message"
                rows={4}
                class="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-300"
                placeholder="例: 現場運用より、まず経営判断に必要な論点へ方向転換したい"
              />
              <button
                id="fork-submit"
                type="submit"
                class="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950"
              >
                新しいセッションで方向修正
              </button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  </main>
);

const arenaScript = `
const state = {
  sessionId: document.getElementById("session-id").dataset.sessionId,
  session: null,
  phase2EventSource: null,
  phase3EventSource: null,
  seenEventIds: new Set(),
  shouldAutoNavigateToReport: false,
};

const messages = document.getElementById("messages");
const statusText = document.getElementById("status-text");
const banner = document.getElementById("banner");
const currentPoint = document.getElementById("current-point");
const currentTurnCount = document.getElementById("current-turn-count");
const totalTurnCount = document.getElementById("total-turn-count");
const judgeResult = document.getElementById("judge-result");
const pointStatuses = document.getElementById("point-statuses");
const resumeButton = document.getElementById("resume-button");
const retryButton = document.getElementById("retry-button");
const reportLink = document.getElementById("report-link");
const forkForm = document.getElementById("fork-form");
const forkMessage = document.getElementById("fork-message");
const forkSubmit = document.getElementById("fork-submit");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const speakerClassByType = {
  facilitator: "border-sky-400/40 bg-sky-400/10",
  role: "border-emerald-400/40 bg-emerald-400/10",
  judge: "border-violet-400/40 bg-violet-400/10",
};

const canResumeDiscussion = () =>
  state.session.phase2.status === "completed" &&
  state.session.phase2.completionReason === "circuit_breaker";

const renderMessages = () => {
  messages.innerHTML = [...state.session.phase2.messages].reverse().map((message) => \`
    <article class="rounded-2xl border px-4 py-3 \${speakerClassByType[message.speakerType] || "border-white/10 bg-white/5"}">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm font-semibold text-white">\${escapeHtml(message.speakerName)}</p>
        <p class="text-xs uppercase tracking-[0.24em] text-slate-400">Turn \${escapeHtml(message.turnNumber)}</p>
      </div>
      <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">\${escapeHtml(message.content)}</p>
    </article>
  \`).join("");
};

const renderPointStatuses = () => {
  const discussionPoints = state.session.phase1.result?.discussionPoints || [];
  pointStatuses.innerHTML = state.session.phase2.pointStatuses.map((pointStatus) => {
    const point = discussionPoints.find((candidate) => candidate.id === pointStatus.discussionPointId);
    const title = point ? point.title : pointStatus.discussionPointId;
    const decisionOwnerName = point
      ? (state.session.phase1.result?.roles || []).find((role) => role.id === point.decisionOwnerRoleId)?.name || point.decisionOwnerRoleId
      : "-";
    return \`
      <article class="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
        <p class="text-sm font-semibold text-slate-100">\${escapeHtml(title)}</p>
        <p class="mt-1 text-xs text-slate-300">意思決定者: \${escapeHtml(decisionOwnerName)}</p>
        <p class="mt-1 text-xs uppercase tracking-[0.24em] text-slate-400">\${escapeHtml(pointStatus.status)}</p>
      </article>
    \`;
  }).join("");
};

const renderBanner = () => {
  banner.className = "mt-6 rounded-2xl border px-4 py-3 text-sm";
  banner.textContent = "";

  if (state.session.phase2.status === "completed") {
    banner.classList.remove("hidden");
    if (state.session.phase3.status === "running" || state.session.phase3.status === "idle") {
      banner.classList.add("border-cyan-300/40", "bg-cyan-300/10", "text-cyan-100");
      banner.textContent = state.session.phase2.completionReason === "circuit_breaker"
        ? "議論は終了しました。レポートを生成中です。未解決論点も整理します。"
        : "議論は終了しました。レポートを生成中です。";
      return;
    }
    if (state.session.phase3.status === "failed") {
      banner.classList.add("border-rose-400/40", "bg-rose-400/10", "text-rose-100");
      banner.textContent = state.session.phase3.errorMessage || "レポート生成に失敗しました。";
      return;
    }
    if (state.session.phase2.completionReason === "circuit_breaker") {
      banner.classList.add("border-violet-300/40", "bg-violet-300/10", "text-violet-100");
      banner.textContent = "最大ターン数に達したため未解決論点を残して終了しました。レポートを確認できます。";
      return;
    }
    banner.classList.add("border-emerald-400/40", "bg-emerald-400/10", "text-emerald-100");
    banner.textContent = "全論点の議論が完了しました。レポートを確認できます。";
    return;
  }

  if (state.session.phase2.status === "failed") {
    banner.classList.remove("hidden");
    banner.classList.add("border-rose-400/40", "bg-rose-400/10", "text-rose-100");
    banner.textContent = state.session.phase2.error?.message || "議論処理に失敗しました。";
    return;
  }

  banner.classList.add("hidden");
};

const renderDashboard = () => {
  const discussionPoints = state.session.phase1.result?.discussionPoints || [];
  const current = discussionPoints[state.session.phase2.currentDiscussionPointIndex];
  currentPoint.textContent = current ? current.title : "完了";
  currentTurnCount.textContent = String(state.session.phase2.currentTurnCount);
  totalTurnCount.textContent = String(state.session.phase2.totalTurnCount);
  judgeResult.textContent = state.session.phase2.lastJudgeDecision
    ? \`\${state.session.phase2.lastJudgeDecision.isResolved ? "resolved" : "pending"}\\n\${state.session.phase2.lastJudgeDecision.reason}\`
    : "まだ判定はありません。";
  resumeButton.classList.toggle("hidden", !canResumeDiscussion());
  retryButton.classList.toggle("hidden", state.session.phase2.status !== "failed");
  reportLink.classList.toggle(
    "hidden",
    !(state.session.phase2.status === "completed" && state.session.phase3.status === "completed"),
  );
};

const renderStatusText = () => {
  if (state.session.phase2.status === "idle") {
    statusText.textContent = "ファシリテーターが最初の論点と発言者を決めています。";
    return;
  }
  if (state.session.phase2.status === "running") {
    statusText.textContent = "議論を進行中です。";
    return;
  }
  if (state.session.phase2.status === "failed") {
    statusText.textContent = "失敗した論点を再試行できます。";
    return;
  }
  if (canResumeDiscussion()) {
    statusText.textContent = "議論を再開すると、新しいセッションで続きから議論します。";
    return;
  }
  if (state.session.phase3.status === "running" || state.session.phase3.status === "idle") {
    statusText.textContent = "議論は終了しました。議事録役がレポートを生成しています。";
    return;
  }
  if (state.session.phase3.status === "failed") {
    statusText.textContent = "議論は終了しました。レポート生成に失敗しています。";
    return;
  }
  statusText.textContent = "議論は終了しました。レポートを確認できます。";
};

const render = () => {
  renderMessages();
  renderPointStatuses();
  renderDashboard();
  renderBanner();
  renderStatusText();
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

const connectPhase2Events = () => {
  if (state.phase2EventSource) {
    state.phase2EventSource.close();
  }
  state.phase2EventSource = new EventSource(\`/api/sessions/\${state.sessionId}/phase2/events\`);
  state.phase2EventSource.addEventListener("arena_message", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.messages.push(payload.message);
    render();
  });
  state.phase2EventSource.addEventListener("judge_result", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.lastJudgeDecision = payload.result;
    const pointStatuses = state.session.phase2.pointStatuses;
    const pointStatus = pointStatuses.find((item) => item.discussionPointId === payload.result.discussionPointId);
    if (pointStatus && payload.result.isResolved) {
      pointStatus.status = "resolved";
      state.session.phase2.currentDiscussionPointIndex += 1;
      state.session.phase2.currentTurnCount = 0;
    } else {
      state.session.phase2.currentTurnCount += 1;
    }
    state.session.phase2.totalTurnCount += 1;
    render();
  });
  state.phase2EventSource.addEventListener("phase2_completed", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.status = "completed";
    state.session.phase2.completionReason = payload.reason;
    render();
    await hydrate();
    await ensureReportTracking(true);
  });
  state.phase2EventSource.addEventListener("error", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.status = "failed";
    state.session.phase2.error = {
      step: "judge",
      message: payload.message,
      retryCount: 3,
    };
    render();
    await hydrate();
  });
};

const connectPhase3Events = () => {
  if (state.phase3EventSource || state.session.phase3.status === "completed" || state.session.phase3.status === "failed") {
    return;
  }
  state.phase3EventSource = new EventSource(\`/api/sessions/\${state.sessionId}/phase3/events\`);
  state.phase3EventSource.addEventListener("phase3_started", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    state.session.phase3.status = "running";
    state.session.phase3.errorMessage = null;
    render();
  });
  state.phase3EventSource.addEventListener("phase3_completed", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const shouldNavigate = state.shouldAutoNavigateToReport;
    state.shouldAutoNavigateToReport = false;
    await hydrate();
    if (state.phase3EventSource) {
      state.phase3EventSource.close();
      state.phase3EventSource = null;
    }
    if (shouldNavigate) {
      window.location.href = \`/report/\${state.sessionId}\`;
    }
  });
  state.phase3EventSource.addEventListener("error", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase3.status = "failed";
    state.session.phase3.errorMessage = payload.message;
    render();
    await hydrate();
    if (state.phase3EventSource) {
      state.phase3EventSource.close();
      state.phase3EventSource = null;
    }
  });
};

const hydrate = async () => {
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/state\`);
  if (!response.ok) {
    statusText.textContent = "状態の取得に失敗しました。";
    return false;
  }
  state.session = await response.json();
  render();
  return true;
};

const startIfNeeded = async () => {
  if (state.session.phase2.status !== "idle") {
    return;
  }
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/start\`, {
    method: "POST",
  });
  if (!response.ok) {
    await hydrate();
  }
};

const startReportIfNeeded = async () => {
  if (state.session.phase2.status !== "completed") {
    return;
  }
  if (state.session.phase3.status !== "idle") {
    return;
  }
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase3/start\`, {
    method: "POST",
  });
  if (!response.ok) {
    await hydrate();
  }
};

const ensureReportTracking = async (shouldAutoNavigate) => {
  if (state.session.phase2.status !== "completed") {
    state.shouldAutoNavigateToReport = false;
    return;
  }
  state.shouldAutoNavigateToReport =
    shouldAutoNavigate && state.session.phase3.status !== "completed";
  connectPhase3Events();
  await startReportIfNeeded();
};

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/retry\`, {
    method: "POST",
  });
  await hydrate();
  retryButton.disabled = false;
  if (!response.ok) {
    statusText.textContent = "再試行の開始に失敗しました。";
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
  connectPhase2Events();
  await startIfNeeded();
  await hydrate();
  await ensureReportTracking(state.session.phase3.status !== "completed");
};

boot();
`;

export const registerPhase2Routes = (
  app: Hono,
  options: RegisterPhase2RoutesOptions,
) => {
  const { service, repository } = options;

  app.use(
    "/arena/*",
    jsxRenderer(({ children }) => (
      <PageShell title="roles Arena">{children}</PageShell>
    )),
  );

  app.get("/arena/:sessionId", (c) => {
    return c.render(
      <>
        <ArenaPage sessionId={c.req.param("sessionId")} />
        <script dangerouslySetInnerHTML={{ __html: arenaScript }} />
      </>,
    );
  });

  app.get("/api/sessions/:sessionId/phase2/state", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      return c.json({ message: "session not found." }, 404);
    }

    return c.json(session);
  });

  app.post("/api/sessions/:sessionId/phase2/start", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      service.start(sessionId);
      return c.body(null, 202);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase2 start failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (message === "session_phase1_not_completed") {
        return c.json(
          { message: "only sessions with completed phase 1 can start." },
          409,
        );
      }
      if (
        message === "phase2_not_idle" ||
        message === "phase2_already_running"
      ) {
        return c.json({ message: "this session cannot be started." }, 409);
      }
      return c.json({ message: "failed to start phase 2." }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/phase2/retry", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      service.retry(sessionId);
      return c.body(null, 202);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase2 retry failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (
        message === "phase2_not_failed" ||
        message === "phase2_already_running"
      ) {
        return c.json({ message: "this session cannot be retried." }, 409);
      }
      return c.json({ message: "failed to start retry." }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/phase2/resume", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      const session = service.createResumeSession(sessionId);
      return c.json({ sessionId: session.id }, 201);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase2 resume failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (
        message === "session_phase1_not_completed" ||
        message === "phase2_not_resumable"
      ) {
        return c.json({ message: "this session cannot be resumed." }, 409);
      }
      return c.json({ message: "failed to create resumed session." }, 500);
    }
  });

  app.get("/api/sessions/:sessionId/phase2/events", async (c) => {
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
          event.event !== "phase2_started" &&
          event.event !== "arena_message" &&
          event.event !== "judge_result" &&
          event.event !== "phase2_completed" &&
          !(event.event === "error" && session.phase2.status === "failed")
        ) {
          continue;
        }
        await send(event.event, event.data, event.id);
      }

      const latestSession = service.getSession(sessionId);
      if (
        !latestSession ||
        latestSession.phase2.status === "completed" ||
        latestSession.phase2.status === "failed"
      ) {
        return;
      }

      let resolveClosed: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const unsubscribe = service.subscribe(sessionId, (event) => {
        if (
          event.event !== "phase2_started" &&
          event.event !== "arena_message" &&
          event.event !== "judge_result" &&
          event.event !== "phase2_completed" &&
          event.event !== "error"
        ) {
          return;
        }
        void (async () => {
          await send(event.event, event.data, event.id);
          if (event.event === "phase2_completed" || event.event === "error") {
            unsubscribe();
            resolveClosed?.();
          }
        })();
      });

      c.req.raw.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          logger.info("Phase2 SSE connection aborted", {
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
