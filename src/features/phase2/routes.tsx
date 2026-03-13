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
          Lobby に戻る
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
            id="retry-button"
            type="button"
            class="hidden w-full rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950"
          >
            再試行
          </button>

          <p class="text-sm text-slate-400">
            レポート生成は次フェーズで実装予定です。
          </p>
        </aside>
      </div>
    </div>
  </main>
);

const arenaScript = `
const state = {
  sessionId: document.getElementById("session-id").dataset.sessionId,
  session: null,
  eventSource: null,
  seenEventIds: new Set(),
};

const messages = document.getElementById("messages");
const statusText = document.getElementById("status-text");
const banner = document.getElementById("banner");
const currentPoint = document.getElementById("current-point");
const currentTurnCount = document.getElementById("current-turn-count");
const totalTurnCount = document.getElementById("total-turn-count");
const judgeResult = document.getElementById("judge-result");
const pointStatuses = document.getElementById("point-statuses");
const retryButton = document.getElementById("retry-button");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const speakerClassByType = {
  facilitator: "border-sky-400/40 bg-sky-400/10",
  role: "border-emerald-400/40 bg-emerald-400/10",
  judge: "border-violet-400/40 bg-violet-400/10",
};

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
    return \`
      <article class="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
        <p class="text-sm font-semibold text-slate-100">\${escapeHtml(title)}</p>
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
    if (state.session.phase2.completionReason === "circuit_breaker") {
      banner.classList.add("border-violet-300/40", "bg-violet-300/10", "text-violet-100");
      banner.textContent = "最大ターン数に達したため未解決論点を残して終了しました。";
      return;
    }
    banner.classList.add("border-emerald-400/40", "bg-emerald-400/10", "text-emerald-100");
    banner.textContent = "全論点の議論が完了しました。";
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
  retryButton.classList.toggle("hidden", state.session.phase2.status !== "failed");
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
  statusText.textContent = "議論は終了しました。";
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

const connectEvents = () => {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = new EventSource(\`/api/sessions/\${state.sessionId}/phase2/events\`);
  state.eventSource.addEventListener("arena_message", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.messages.push(payload.message);
    render();
  });
  state.eventSource.addEventListener("judge_result", (event) => {
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
  state.eventSource.addEventListener("phase2_completed", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.session.phase2.status = "completed";
    state.session.phase2.completionReason = payload.reason;
    render();
    await hydrate();
  });
  state.eventSource.addEventListener("error", async (event) => {
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
      return c.json({ message: "session が見つかりません。" }, 404);
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
        return c.json({ message: "session が見つかりません。" }, 404);
      }
      if (message === "session_phase1_not_completed") {
        return c.json(
          { message: "Phase 1 が完了した session のみ開始できます。" },
          409,
        );
      }
      if (
        message === "phase2_not_idle" ||
        message === "phase2_already_running"
      ) {
        return c.json({ message: "この session は開始できません。" }, 409);
      }
      return c.json({ message: "Phase 2 の開始に失敗しました。" }, 500);
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
        return c.json({ message: "session が見つかりません。" }, 404);
      }
      if (
        message === "phase2_not_failed" ||
        message === "phase2_already_running"
      ) {
        return c.json({ message: "この session は再試行できません。" }, 409);
      }
      return c.json({ message: "再試行の開始に失敗しました。" }, 500);
    }
  });

  app.get("/api/sessions/:sessionId/phase2/events", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      return c.json({ message: "session が見つかりません。" }, 404);
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
