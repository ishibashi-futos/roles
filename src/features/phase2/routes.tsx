import type { Hono } from "hono";
import { jsxRenderer } from "hono/jsx-renderer";
import { streamSSE } from "hono/streaming";
import { BrandMark, PageShell } from "../../shared/branding";
import { logger } from "../../shared/logger";
import type { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { Phase2Service } from "./service";

type RegisterPhase2RoutesOptions = {
  repository: WorkflowSessionRepository;
  service: Phase2Service;
};

const buildPhase2StateResponse = (
  session: NonNullable<ReturnType<Phase2Service["getSession"]>>,
  service: Phase2Service,
) => {
  const effectivePointTurnLimits = service
    .getEffectivePointTurnLimits(session)
    .map((point) => ({
      ...point,
      decisionOwnerName:
        session.phase1.result?.roles.find(
          (role) => role.id === point.decisionOwnerRoleId,
        )?.name ?? point.decisionOwnerRoleId,
    }));

  return {
    ...session,
    phase2: {
      ...session.phase2,
      effectiveMaxTurnsPerPoint: service.getEffectiveMaxTurnsPerPoint(session),
      effectiveCurrentPointMaxTurns:
        service.getEffectiveMaxTurnsPerPoint(session),
      effectiveMaxTotalTurns: service.getEffectiveMaxTotalTurns(session),
      effectivePointTurnLimits,
    },
  };
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
                <div class="mt-2 flex items-center justify-between gap-3">
                  <p id="total-turn-count" class="text-slate-200" />
                  <button
                    id="add-total-turns-button"
                    type="button"
                    class="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100"
                  >
                    +5ターン
                  </button>
                </div>
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

          <section class="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">
              Export
            </p>
            <button
              id="copy-discussion-button"
              type="button"
              class="mt-4 hidden w-full rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100"
            >
              Meta を含めてコピー
            </button>
            <p id="copy-status" class="mt-3 text-sm text-slate-400" />
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
            class="hidden block w-full rounded-full border border-cyan-300/40 bg-cyan-300/10 px-5 py-3 text-center text-sm font-semibold text-cyan-100"
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
  adjustingPointIds: new Set(),
  isAdjustingTotalTurns: false,
};

const messages = document.getElementById("messages");
const statusText = document.getElementById("status-text");
const banner = document.getElementById("banner");
const currentPoint = document.getElementById("current-point");
const currentTurnCount = document.getElementById("current-turn-count");
const totalTurnCount = document.getElementById("total-turn-count");
const addTotalTurnsButton = document.getElementById("add-total-turns-button");
const judgeResult = document.getElementById("judge-result");
const pointStatuses = document.getElementById("point-statuses");
const copyDiscussionButton = document.getElementById("copy-discussion-button");
const copyStatus = document.getElementById("copy-status");
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
  state.session.phase2.pointStatuses.some(
    (pointStatus) => pointStatus.status !== "resolved",
  );

const canAdjustTurns = () => state.session.phase2.status === "running";

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

const formatTurnCount = (current, max) => String(current) + " / " + String(max);

const getCurrentPointLimit = () =>
  state.session.phase2.effectivePointTurnLimits.find((point) => point.isCurrent) || null;

const buildDiscussionCopyText = () => {
  if (!state.session) {
    return "";
  }

  const messagesText = state.session.phase2.messages.map((message) => {
    return [
      \`## Turn \${message.turnNumber}\`,
      \`- speakerType: \${message.speakerType}\`,
      \`- speakerName: \${message.speakerName}\`,
      "",
      message.content,
    ].join("\\n");
  }).join("\\n\\n");
  const pointStatusesText = state.session.phase2.effectivePointTurnLimits.map((point) => {
    const base = \`- \${point.title}: \${point.status} / 上限 \${point.effectiveMaxTurns}\`;
    return point.addedTurns > 0 ? base + \` (追加 \${point.addedTurns})\` : base;
  }).join("\\n");
  const currentPointLimit = getCurrentPointLimit();

  return [
    "# Meta",
    "",
    "- セッションタイトル",
    state.session.title,
    "",
    "- 初期入力",
    state.session.topic,
    "",
    "- Phase 2 状態",
    state.session.phase2.status,
    "",
    "- Phase 2 完了理由",
    completionReasonLabel(state.session.phase2.completionReason),
    "",
    "- 現在の論点",
    currentPointLimit?.title || "完了",
    "",
    "- 現在論点ターン数",
    formatTurnCount(
      state.session.phase2.currentTurnCount,
      currentPointLimit?.effectiveMaxTurns ?? state.session.phase2.effectiveCurrentPointMaxTurns,
    ),
    "",
    "- 総ターン数",
    formatTurnCount(
      state.session.phase2.totalTurnCount,
      state.session.phase2.effectiveMaxTotalTurns,
    ),
    "",
    "# Discussion Points",
    "",
    pointStatusesText || "- なし",
    "",
    "# Discussion",
    "",
    messagesText || "メッセージはまだありません。",
  ].join("\\n");
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
  pointStatuses.innerHTML = state.session.phase2.effectivePointTurnLimits.map((point) => {
    const isDisabled =
      !canAdjustTurns() ||
      point.status === "resolved" ||
      state.adjustingPointIds.has(point.discussionPointId);
    return \`
      <article class="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-100">\${escapeHtml(point.title)}</p>
            <p class="mt-1 text-xs text-slate-300">意思決定者: \${escapeHtml(point.decisionOwnerName)}</p>
          </div>
          <button
            type="button"
            data-point-turn-button="true"
            data-discussion-point-id="\${escapeHtml(point.discussionPointId)}"
            class="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
            \${isDisabled ? "disabled" : ""}
          >
            +5ターン
          </button>
        </div>
        <div class="mt-3 flex items-center justify-between gap-3 text-xs">
          <p class="text-slate-300">上限: \${escapeHtml(String(point.effectiveMaxTurns))}</p>
          <p class="text-slate-400">\${point.addedTurns > 0 ? escapeHtml(\`追加済み: +\${point.addedTurns}\`) : "追加なし"}</p>
        </div>
        <p class="mt-1 text-xs uppercase tracking-[0.24em] text-slate-400">\${escapeHtml(point.status)}</p>
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
  const current = getCurrentPointLimit();
  currentPoint.textContent = current ? current.title : "完了";
  currentTurnCount.textContent = formatTurnCount(
    state.session.phase2.currentTurnCount,
    state.session.phase2.effectiveCurrentPointMaxTurns,
  );
  totalTurnCount.textContent = formatTurnCount(
    state.session.phase2.totalTurnCount,
    state.session.phase2.effectiveMaxTotalTurns,
  );
  addTotalTurnsButton.disabled = !canAdjustTurns() || state.isAdjustingTotalTurns;
  judgeResult.textContent = state.session.phase2.lastJudgeDecision
    ? \`\${state.session.phase2.lastJudgeDecision.isResolved ? "resolved" : "pending"}\\n\${state.session.phase2.lastJudgeDecision.reason}\`
    : "まだ判定はありません。";
  copyDiscussionButton.classList.toggle("hidden", false);
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
    const pointStatus = state.session.phase2.pointStatuses.find(
      (item) => item.discussionPointId === payload.result.discussionPointId,
    );
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
  state.phase2EventSource.addEventListener("phase2_turn_budget_updated", async (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    await hydrate();
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

const addTurnsToDiscussionPoint = async (discussionPointId) => {
  state.adjustingPointIds.add(discussionPointId);
  render();
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/points/\${discussionPointId}/add-turns\`, {
    method: "POST",
  });
  state.adjustingPointIds.delete(discussionPointId);
  await hydrate();
  if (!response.ok) {
    statusText.textContent = "論点ターン数の追加に失敗しました。";
  }
};

const addTurnsToTotal = async () => {
  state.isAdjustingTotalTurns = true;
  render();
  const response = await fetch(\`/api/sessions/\${state.sessionId}/phase2/add-total-turns\`, {
    method: "POST",
  });
  state.isAdjustingTotalTurns = false;
  await hydrate();
  if (!response.ok) {
    statusText.textContent = "総ターン数の追加に失敗しました。";
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

copyDiscussionButton.addEventListener("click", async () => {
  const text = buildDiscussionCopyText();
  if (!text) {
    copyStatus.textContent = "コピーできるディスカッションがありません。";
    return;
  }

  copyDiscussionButton.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    copyStatus.textContent = "Meta を含むディスカッションをコピーしました。";
  } catch {
    copyStatus.textContent = "クリップボードへのコピーに失敗しました。";
  } finally {
    copyDiscussionButton.disabled = false;
  }
});

addTotalTurnsButton.addEventListener("click", async () => {
  await addTurnsToTotal();
});

pointStatuses.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest("[data-point-turn-button='true']");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const discussionPointId = button.dataset.discussionPointId;
  if (!discussionPointId || button.disabled) {
    return;
  }
  await addTurnsToDiscussionPoint(discussionPointId);
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

    return c.json(buildPhase2StateResponse(session, service));
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

  app.post(
    "/api/sessions/:sessionId/phase2/points/:discussionPointId/add-turns",
    (c) => {
      const sessionId = c.req.param("sessionId");
      const discussionPointId = c.req.param("discussionPointId");

      try {
        service.addTurnsToDiscussionPoint(sessionId, discussionPointId);
        return c.body(null, 204);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unexpected_error";
        logger.error("Phase2 point turns update failed", {
          sessionId,
          discussionPointId,
          message,
        });
        if (message === "session_not_found") {
          return c.json({ message: "session not found." }, 404);
        }
        if (message === "discussion_point_not_found") {
          return c.json({ message: "discussion point not found." }, 404);
        }
        if (
          message === "session_phase1_not_completed" ||
          message === "phase2_not_running" ||
          message === "discussion_point_not_adjustable"
        ) {
          return c.json(
            { message: "this discussion point cannot be adjusted." },
            409,
          );
        }
        return c.json({ message: "failed to update point turns." }, 500);
      }
    },
  );

  app.post("/api/sessions/:sessionId/phase2/add-total-turns", (c) => {
    const sessionId = c.req.param("sessionId");

    try {
      service.addTurnsToTotal(sessionId);
      return c.body(null, 204);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase2 total turns update failed", {
        sessionId,
        message,
      });
      if (message === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (
        message === "session_phase1_not_completed" ||
        message === "phase2_not_running"
      ) {
        return c.json({ message: "this session cannot be adjusted." }, 409);
      }
      return c.json({ message: "failed to update total turns." }, 500);
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
          event.event !== "phase2_turn_budget_updated" &&
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
