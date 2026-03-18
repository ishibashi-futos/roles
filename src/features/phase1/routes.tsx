import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { streamSSE } from "hono/streaming";
import { BrandMark, PageShell } from "../../shared/branding";
import { registerDevReloadRoutes } from "../../shared/dev-reload";
import { logger } from "../../shared/logger";
import { registerStaticAssetRoutes } from "../../shared/static-assets";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { WorkflowSession } from "../../shared/workflow-types";
import type { RequirementAgent } from "./requirement-agent";
import { createRequirementAgentFromEnv } from "./requirement-agent";
import { Phase1Service } from "./service";
import {
  createSessionTitleAgentFromEnv,
  type SessionTitleAgent,
} from "./session-title-agent";
import type { Phase1Result, RequirementMessage } from "./types";

type CreatePhase1AppOptions = {
  requirementAgent?: RequirementAgent;
  sessionTitleAgent?: SessionTitleAgent;
  repository?: WorkflowSessionRepository;
  maxUserReplyCount?: number;
};

type RegisterPhase1RoutesOptions = {
  service: Phase1Service;
  repository: WorkflowSessionRepository;
};

const renderMessages = (messages: RequirementMessage[]) =>
  [...messages].reverse().map((message, index) => (
    <article
      id={`message-${index}`}
      class={`rounded-2xl border px-4 py-3 ${
        message.role === "assistant"
          ? "border-sky-200/80 bg-white/95 shadow-sm shadow-sky-950/5"
          : "border-emerald-300/80 bg-emerald-50/95 shadow-sm shadow-emerald-950/5"
      }`}
    >
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
        {message.role === "assistant" ? "要件定義役" : "あなた"}
      </p>
      <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {message.content}
      </p>
    </article>
  ));

const KeyValueList = ({ title, items }: { title: string; items: string[] }) => (
  <section>
    <p class="text-sm font-semibold text-slate-900">{title}</p>
    <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-600">
      {items.map((item) => (
        <li class="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-sm shadow-slate-950/5">
          {item}
        </li>
      ))}
    </ul>
  </section>
);

const renderDiscussionStartButton = (sessionId: string) => (
  <div class="mt-6 flex justify-end">
    <a
      href={`/arena/${sessionId}`}
      class="rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
    >
      議論を開始
    </a>
  </div>
);

const renderResult = (
  result: Phase1Result | null,
  sessionId: string | null,
  canStartDiscussion: boolean,
): Child => {
  if (!result) {
    return (
      <section class="rounded-[28px] border border-dashed border-slate-300/80 bg-white/75 p-6 shadow-lg shadow-slate-950/5 backdrop-blur">
        <p class="text-sm text-slate-500">
          ここに要件定義、論点、ロール定義が表示されます。
        </p>
      </section>
    );
  }

  const getDecisionOwnerName = (decisionOwnerRoleId: string) =>
    result.roles.find((role) => role.id === decisionOwnerRoleId)?.name ??
    decisionOwnerRoleId;

  return (
    <section class="space-y-6">
      <article class="rounded-[28px] border border-white/10 bg-[linear-gradient(160deg,#081120_0%,#10213f_55%,#102c38_100%)] p-6 text-white shadow-2xl shadow-sky-950/20">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
          Requirement Definition
        </p>
        <h2 class="mt-3 text-2xl font-semibold">{result.requirements.theme}</h2>
        <p class="mt-4 text-sm leading-6 text-slate-200">
          {result.requirements.objective}
        </p>
        <div class="mt-5 grid gap-4 md:grid-cols-3">
          <KeyValueList
            title="成功条件"
            items={result.requirements.successCriteria}
          />
          <KeyValueList title="制約" items={result.requirements.constraints} />
          <KeyValueList title="前提" items={result.requirements.assumptions} />
        </div>
      </article>

      <article class="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-xl shadow-sky-950/5 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">
          Discussion Points
        </p>
        <div class="mt-4 grid gap-4">
          {result.discussionPoints.map((point) => (
            <section class="rounded-2xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)] p-4">
              <h3 class="font-semibold text-slate-900">{point.title}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-600">
                {point.description}
              </p>
              <p class="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                意思決定者: {getDecisionOwnerName(point.decisionOwnerRoleId)}
              </p>
            </section>
          ))}
        </div>
      </article>

      <article class="rounded-[28px] border border-violet-100 bg-white/90 p-6 shadow-xl shadow-violet-950/5 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-700">
          Roles
        </p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          {result.roles.map((role) => (
            <section class="rounded-2xl border border-violet-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8f5ff_100%)] p-4">
              <p class="text-xs uppercase tracking-[0.24em] text-violet-600">
                {role.perspective}
              </p>
              <h3 class="mt-2 text-lg font-semibold text-slate-900">
                {role.name}
              </h3>
              <p class="mt-3 text-sm leading-6 text-slate-600">
                {role.systemPromptSeed}
              </p>
              <div class="mt-4 grid gap-4">
                <KeyValueList title="責務" items={role.responsibilities} />
                <KeyValueList title="懸念" items={role.concerns} />
              </div>
            </section>
          ))}
        </div>
        {sessionId && canStartDiscussion
          ? renderDiscussionStartButton(sessionId)
          : null}
      </article>

      {result.openQuestions.length > 0 ? (
        <article class="rounded-[28px] border border-amber-100 bg-white/90 p-6 shadow-xl shadow-amber-950/5 backdrop-blur">
          <p class="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            Open Questions
          </p>
          <div class="mt-4 grid gap-4">
            {result.openQuestions.map((question) => (
              <section class="rounded-2xl border border-amber-100 bg-[linear-gradient(180deg,#fffdf5_0%,#fffbeb_100%)] p-4">
                <h3 class="font-semibold text-slate-900">{question.title}</h3>
                <p class="mt-2 text-sm leading-6 text-slate-600">
                  {question.description}
                </p>
                <p class="mt-3 text-sm leading-6 text-slate-600">
                  なぜ重要か: {question.whyItMatters}
                </p>
                <p class="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                  想定オーナー:{" "}
                  {getDecisionOwnerName(question.suggestedOwnerRoleId)}
                </p>
              </section>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
};

const formatTimestamp = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

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

const getSessionPrimaryLink = (session: WorkflowSession) => {
  if (
    session.phase3.status === "completed" ||
    session.phase3.status === "failed"
  ) {
    return `/report/${session.id}`;
  }
  if (
    session.phase2.status === "running" ||
    session.phase2.status === "completed" ||
    session.phase2.status === "failed"
  ) {
    return `/arena/${session.id}`;
  }
  return `/sessions/${session.id}`;
};

const getSessionDatasetStatus = (session: WorkflowSession) => {
  if (session.phase3.status === "completed") {
    return "phase3_completed";
  }
  if (session.phase3.status === "running") {
    return "phase3_running";
  }
  if (session.phase2.status === "running") {
    return "phase2_running";
  }
  return session.phase1.status;
};

const homeClientScript = `
const summaryTotal = document.getElementById("summary-total");
const summaryInProgress = document.getElementById("summary-in-progress");
const summaryCompleted = document.getElementById("summary-completed");

const updateSummary = () => {
  const cards = [...document.querySelectorAll("[data-session-card]")];
  const total = cards.length;
  const inProgress = cards.filter((card) => {
    const status = card.dataset.sessionStatus;
    return (
      status === "collecting_requirements" ||
      status === "phase2_running" ||
      status === "phase3_running"
    );
  }).length;
  const completed = cards.filter(
    (card) => card.dataset.sessionStatus === "phase3_completed",
  ).length;

  summaryTotal.textContent = String(total);
  summaryInProgress.textContent = String(inProgress);
  summaryCompleted.textContent = String(completed);

  const emptyState = document.getElementById("sessions-empty");
  const list = document.getElementById("sessions-list");
  emptyState?.classList.toggle("hidden", total !== 0);
  list?.classList.toggle("hidden", total === 0);
};

document.querySelectorAll("[data-delete-session-button]").forEach((button) => {
  button.addEventListener("click", async (event) => {
    event.preventDefault();

    const sessionId = button.dataset.sessionId;
    if (!sessionId) {
      return;
    }

    const confirmed = window.confirm("このセッションを削除します。元に戻せません。");
    if (!confirmed) {
      return;
    }

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = "削除中...";

    const response = await fetch("/api/sessions/" + sessionId, {
      method: "DELETE",
    });

    if (!response.ok) {
      button.disabled = false;
      button.textContent = originalLabel;
      window.alert("セッションの削除に失敗しました。");
      return;
    }

    document.querySelector('[data-session-card="' + sessionId + '"]')?.remove();
    updateSummary();
  });
});

updateSummary();
`;

const HomePage = ({ sessions }: { sessions: WorkflowSession[] }) => (
  <main class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_28%),linear-gradient(180deg,#f7fbff_0%,#eef4ff_52%,#f8fafc_100%)] px-4 py-10 text-slate-900">
    <div class="mx-auto max-w-7xl space-y-6">
      <section class="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <article class="rounded-[32px] border border-white/70 bg-[linear-gradient(160deg,#081120_0%,#10213f_58%,#0f2f36_100%)] p-8 text-white shadow-2xl shadow-sky-950/15">
          <BrandMark
            label="roles"
            accentClassName="text-cyan-200"
            textClassName="text-slate-300"
          />
          <h1 class="mt-4 text-4xl font-semibold leading-tight">
            セッションを選んで
            <br />
            議論を前に進める
          </h1>
          <p class="mt-5 max-w-xl text-sm leading-7 text-slate-300">
            新しいテーマの要件定義を始めるか、既存セッションの要件定義・議論・レポートを再開します。
          </p>
          <div class="mt-8">
            <a
              href="/sessions/new"
              class="inline-flex rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-6 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90"
            >
              新規セッションを開始
            </a>
          </div>
        </article>

        <article class="rounded-[32px] border border-white/80 bg-white/85 p-8 shadow-xl shadow-slate-950/5 backdrop-blur">
          <p class="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">
            Summary
          </p>
          <div class="mt-5 grid gap-4 sm:grid-cols-3">
            <section class="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-5">
              <p class="text-sm text-slate-500">総セッション数</p>
              <p
                id="summary-total"
                class="mt-2 text-3xl font-semibold text-slate-900"
              >
                {sessions.length}
              </p>
            </section>
            <section class="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-5">
              <p class="text-sm text-slate-500">進行中</p>
              <p
                id="summary-in-progress"
                class="mt-2 text-3xl font-semibold text-slate-900"
              >
                {
                  sessions.filter(
                    (session) =>
                      session.phase1.status === "collecting_requirements" ||
                      session.phase2.status === "running" ||
                      session.phase3.status === "running",
                  ).length
                }
              </p>
            </section>
            <section class="rounded-2xl border border-slate-200/80 bg-slate-50 px-4 py-5">
              <p class="text-sm text-slate-500">レポート完了</p>
              <p
                id="summary-completed"
                class="mt-2 text-3xl font-semibold text-slate-900"
              >
                {
                  sessions.filter(
                    (session) => session.phase3.status === "completed",
                  ).length
                }
              </p>
            </section>
          </div>
        </article>
      </section>

      <section class="rounded-[32px] border border-white/80 bg-white/90 p-8 shadow-2xl shadow-slate-950/5 backdrop-blur">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Sessions
            </p>
            <h2 class="mt-2 text-2xl font-semibold text-slate-900">
              過去セッション
            </h2>
          </div>
        </div>

        {sessions.length === 0 ? (
          <section
            id="sessions-empty"
            class="mt-6 rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"
          >
            <p class="text-base font-medium text-slate-700">
              まだセッションはありません。
            </p>
            <p class="mt-2 text-sm text-slate-500">
              「新規セッションを開始」から最初のテーマを作成してください。
            </p>
          </section>
        ) : (
          <div id="sessions-list" class="mt-6 grid gap-4">
            {sessions.map((session) => (
              <article
                data-session-card={session.id}
                data-session-status={getSessionDatasetStatus(session)}
                class="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <a
                  href={getSessionPrimaryLink(session)}
                  class="block cursor-pointer p-6"
                >
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-3">
                        <span class="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                          {getSessionStatusLabel(session)}
                        </span>
                        <span class="text-xs text-slate-400">{session.id}</span>
                      </div>
                      <h3 class="mt-3 text-lg font-semibold text-slate-900">
                        {session.title}
                      </h3>
                      <p class="mt-2 text-sm leading-6 text-slate-500">
                        {session.topic}
                      </p>
                    </div>
                    <div class="shrink-0 text-sm text-slate-500">
                      <p>更新: {formatTimestamp(session.updatedAt)}</p>
                      <p class="mt-1">
                        作成: {formatTimestamp(session.createdAt)}
                      </p>
                    </div>
                  </div>
                </a>
                <div class="flex justify-end px-6 pb-6">
                  <button
                    type="button"
                    data-delete-session-button="true"
                    data-session-id={session.id}
                    class="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                  >
                    削除
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  </main>
);

const SessionPage = ({ session }: { session: WorkflowSession | null }) => (
  <main class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.28),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.22),_transparent_32%),radial-gradient(circle_at_bottom,_rgba(139,92,246,0.2),_transparent_40%),linear-gradient(180deg,#eef4ff_0%,#f5f7fb_45%,#eef2ff_100%)] px-4 py-10 text-slate-900">
    <div class="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <section class="rounded-[32px] border border-white/10 bg-[linear-gradient(160deg,#081120_0%,#10213f_58%,#0f2f36_100%)] p-8 text-white shadow-2xl shadow-sky-950/20">
        <BrandMark
          label="roles"
          accentClassName="text-cyan-200"
          textClassName="text-slate-300"
        />
        <h1 class="mt-4 text-4xl font-semibold leading-tight">
          要件定義から
          <br />
          ロール定義までを固める
        </h1>
        <p class="mt-5 max-w-2xl text-sm leading-7 text-slate-300">
          初期テーマを入力すると、要件定義役が不足情報を対話で回収し、議論に必要な論点とロールを構造化します。
        </p>

        <div class="mt-6">
          <a
            href="/"
            class="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
          >
            ホームに戻る
          </a>
        </div>

        <form id="message-form" class="mt-8 space-y-4">
          <label
            id="message-input-label"
            class="block text-sm font-medium text-slate-200"
            for="message-input"
          >
            テーマ
          </label>
          <textarea
            id="message-input"
            name="message"
            rows={5}
            class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-cyan-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-900/40 disabled:text-slate-400 disabled:opacity-100"
            placeholder="例: SIer 営業の行動データ化を進めるための要件を整理したい"
          />
          <button
            id="message-submit"
            class="rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300 disabled:shadow-none disabled:hover:opacity-100"
            type="submit"
          >
            要件定義を開始
          </button>
        </form>

        <p id="message-state-hint" class="mt-3 text-xs text-slate-300">
          入力可能です。内容を送信すると、要件定義役の応答が返るまで一時的にロックします。
        </p>
        <p id="status-text" class="mt-4 text-sm text-cyan-200" />

        <section class="mt-8">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-lg font-semibold">対話ログ</h2>
              {session ? (
                <p class="mt-1 text-sm text-slate-300">{session.title}</p>
              ) : null}
            </div>
            <span
              id="session-badge"
              data-session-id={session?.id ?? ""}
              data-session-status={session?.phase1.status ?? ""}
              data-phase2-status={session?.phase2.status ?? ""}
              class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
            >
              {session ? `Session: ${session.id}` : "Session: 未開始"}
            </span>
          </div>
          <div id="messages" class="mt-4 space-y-3">
            {session ? renderMessages(session.phase1.messages) : null}
          </div>
        </section>
      </section>

      <section>
        <div id="result-panel">
          {renderResult(
            session?.phase1.result ?? null,
            session?.id ?? null,
            Boolean(
              session &&
                session.phase1.status === "completed" &&
                session.phase2.status === "idle",
            ),
          )}
        </div>
      </section>
    </div>
  </main>
);

const clientScript = `
const sessionBadge = document.getElementById("session-badge");
const state = {
  sessionId: sessionBadge?.dataset.sessionId || "",
  eventSource: null,
  completed: sessionBadge?.dataset.sessionStatus === "completed",
  phase2Status: sessionBadge?.dataset.phase2Status || "idle",
  seenEventIds: new Set(),
  awaitingResponse: false,
};

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageInputLabel = document.getElementById("message-input-label");
const messageSubmit = document.getElementById("message-submit");
const messageStateHint = document.getElementById("message-state-hint");
const messages = document.getElementById("messages");
const statusText = document.getElementById("status-text");
const resultPanel = document.getElementById("result-panel");
const inputEnabledClassName =
  "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-cyan-300";
const inputDisabledClassName =
  "w-full rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm leading-6 text-slate-400 outline-none opacity-100 transition cursor-not-allowed";
const buttonEnabledClassName =
  "rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:opacity-90";
const buttonDisabledClassName =
  "rounded-full bg-slate-600 px-5 py-3 text-sm font-semibold text-slate-300 shadow-none transition cursor-not-allowed";

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const renderMessage = (roleLabel, content, isAssistant) => {
  const article = document.createElement("article");
  article.className = isAssistant
    ? "rounded-2xl border border-sky-200/80 bg-white/95 px-4 py-3 shadow-sm shadow-sky-950/5"
    : "rounded-2xl border border-emerald-300/80 bg-emerald-50/95 px-4 py-3 shadow-sm shadow-emerald-950/5";
  article.innerHTML = \`
    <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">\${roleLabel}</p>
    <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">\${escapeHtml(content)}</p>
  \`;
  messages.prepend(article);
};

const renderList = (title, items) => \`
  <section>
    <p class="text-sm font-semibold text-slate-900">\${escapeHtml(title)}</p>
    <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-600">
      \${items.map((item) => \`<li class="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 shadow-sm shadow-slate-950/5">\${escapeHtml(item)}</li>\`).join("")}
    </ul>
  </section>
\`;

const renderResult = (result) => {
  const getDecisionOwnerName = (decisionOwnerRoleId) => {
    const owner = result.roles.find((role) => role.id === decisionOwnerRoleId);
    return owner ? owner.name : decisionOwnerRoleId;
  };
  const startButton = state.sessionId && state.phase2Status === "idle" && state.completed
    ? \`<div class="mt-6 flex justify-end"><a href="/arena/\${state.sessionId}" class="rounded-full bg-[linear-gradient(135deg,var(--color-blue),var(--color-green))] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:opacity-90">議論を開始</a></div>\`
    : "";
  resultPanel.innerHTML = \`
    <section class="space-y-6">
      <article class="rounded-[28px] border border-white/10 bg-[linear-gradient(160deg,#081120_0%,#10213f_55%,#102c38_100%)] p-6 text-white shadow-2xl shadow-sky-950/20">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">Requirement Definition</p>
        <h2 class="mt-3 text-2xl font-semibold">\${escapeHtml(result.requirements.theme)}</h2>
        <p class="mt-4 text-sm leading-6 text-slate-200">\${escapeHtml(result.requirements.objective)}</p>
        <div class="mt-5 grid gap-4 md:grid-cols-3">
          \${renderList("成功条件", result.requirements.successCriteria)}
          \${renderList("制約", result.requirements.constraints)}
          \${renderList("前提", result.requirements.assumptions)}
        </div>
      </article>
      <article class="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-xl shadow-sky-950/5 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-sky-700">Discussion Points</p>
        <div class="mt-4 grid gap-4">
          \${result.discussionPoints.map((point) => \`
            <section class="rounded-2xl border border-sky-100 bg-[linear-gradient(180deg,#ffffff_0%,#eff6ff_100%)] p-4">
              <h3 class="font-semibold text-slate-900">\${escapeHtml(point.title)}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-600">\${escapeHtml(point.description)}</p>
              <p class="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">意思決定者: \${escapeHtml(getDecisionOwnerName(point.decisionOwnerRoleId))}</p>
            </section>
          \`).join("")}
        </div>
      </article>
      <article class="rounded-[28px] border border-violet-100 bg-white/90 p-6 shadow-xl shadow-violet-950/5 backdrop-blur">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-violet-700">Roles</p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          \${result.roles.map((role) => \`
            <section class="rounded-2xl border border-violet-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8f5ff_100%)] p-4">
              <p class="text-xs uppercase tracking-[0.24em] text-violet-600">\${escapeHtml(role.perspective)}</p>
              <h3 class="mt-2 text-lg font-semibold text-slate-900">\${escapeHtml(role.name)}</h3>
              <p class="mt-3 text-sm leading-6 text-slate-600">\${escapeHtml(role.systemPromptSeed)}</p>
              <div class="mt-4 grid gap-4">
                \${renderList("責務", role.responsibilities)}
                \${renderList("懸念", role.concerns)}
              </div>
            </section>
          \`).join("")}
        </div>
        \${startButton}
      </article>
      \${result.openQuestions.length > 0 ? \`
        <article class="rounded-[28px] border border-amber-100 bg-white/90 p-6 shadow-xl shadow-amber-950/5 backdrop-blur">
          <p class="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">Open Questions</p>
          <div class="mt-4 grid gap-4">
            \${result.openQuestions.map((question) => \`
              <section class="rounded-2xl border border-amber-100 bg-[linear-gradient(180deg,#fffdf5_0%,#fffbeb_100%)] p-4">
                <h3 class="font-semibold text-slate-900">\${escapeHtml(question.title)}</h3>
                <p class="mt-2 text-sm leading-6 text-slate-600">\${escapeHtml(question.description)}</p>
                <p class="mt-3 text-sm leading-6 text-slate-600">なぜ重要か: \${escapeHtml(question.whyItMatters)}</p>
                <p class="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">想定オーナー: \${escapeHtml(getDecisionOwnerName(question.suggestedOwnerRoleId))}</p>
              </section>
            \`).join("")}
          </div>
        </article>
      \` : ""}
    </section>
  \`;
};

const updateInputMode = () => {
  const canReviseInPlace = state.completed && state.phase2Status === "idle";
  const setInputAvailability = (isDisabled, hintText) => {
    messageInput.disabled = isDisabled;
    messageSubmit.disabled = isDisabled;
    messageInput.className = isDisabled
      ? inputDisabledClassName
      : inputEnabledClassName;
    messageSubmit.className = isDisabled
      ? buttonDisabledClassName
      : buttonEnabledClassName;
    messageStateHint.textContent = hintText;
  };

  if (canReviseInPlace) {
    messageInputLabel.textContent = "方向修正";
    messageInput.placeholder = "例: 現場入力の運用より、先に経営判断の観点を優先したい";
    messageSubmit.textContent = "方向修正を反映";
    setInputAvailability(
      state.awaitingResponse,
      state.awaitingResponse
        ? "要件定義役が方向修正を反映しています。応答が返るまで入力と送信はできません。"
        : "入力可能です。方向修正を送ると、同じセッションで要件定義を更新します。",
    );
    return;
  }

  if (state.completed) {
    messageInputLabel.textContent = "完了";
    messageInput.placeholder = "要件定義は完了しました。";
    messageSubmit.textContent = "完了";
    setInputAvailability(
      true,
      "要件定義は完了済みです。内容を確認して次の画面に進んでください。",
    );
    return;
  }

  if (!state.sessionId) {
    messageInputLabel.textContent = "テーマ";
    messageInput.placeholder = "例: SIer 営業の行動データ化を進めるための要件を整理したい";
    messageSubmit.textContent = "要件定義を開始";
    setInputAvailability(
      state.awaitingResponse,
      state.awaitingResponse
        ? "要件定義役がテーマを整理中です。応答が返るまで入力と送信はできません。"
        : "入力可能です。内容を送信すると、要件定義役の応答が返るまで一時的にロックします。",
    );
    return;
  }

  messageInputLabel.textContent = "追加回答";
  messageInput.placeholder = "要件定義役から質問が返ってきたら、ここに回答を入力";
  messageSubmit.textContent = "回答を送信";
  setInputAvailability(
    state.awaitingResponse,
    state.awaitingResponse
      ? "要件定義役が回答を処理中です。応答が返るまで入力と送信はできません。"
      : "入力可能です。要件定義役からの質問に回答してください。",
  );
};

const closeEventSource = () => {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
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
  closeEventSource();
  state.eventSource = new EventSource(\`/api/phase1/sessions/\${state.sessionId}/events\`);
  state.eventSource.addEventListener("assistant_delta", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    renderMessage("要件定義役", payload.content, true);
    statusText.textContent =
      "要件定義役が内容を整理し、次に確認したいことをまとめました。";
    state.awaitingResponse = false;
    updateInputMode();
  });
  state.eventSource.addEventListener("requirements_completed", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    state.completed = true;
    state.phase2Status = "idle";
    state.awaitingResponse = false;
    renderResult(payload.result);
    updateInputMode();
    statusText.textContent =
      "整理が完了しました。要件・論点・ロール定義を確認できます。";
    closeEventSource();
  });
  state.eventSource.addEventListener("error", (event) => {
    if (!shouldHandleEvent(event)) {
      return;
    }
    const payload = JSON.parse(event.data);
    statusText.textContent = payload.message;
    state.awaitingResponse = false;
    updateInputMode();
    closeEventSource();
  });
};

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message) {
    statusText.textContent = state.sessionId
      ? "追加回答を入力してください。"
      : "テーマを入力してください。";
    return;
  }

  if (state.awaitingResponse || state.completed) {
    if (!(state.completed && state.phase2Status === "idle")) {
      return;
    }
  }

  const isNewSession = !state.sessionId;
  const wasCompleted = state.completed;
  renderMessage("あなた", message, false);
  messageInput.value = "";
  state.awaitingResponse = true;
  updateInputMode();

  if (isNewSession) {
    messages.innerHTML = "";
    resultPanel.innerHTML = '<section class="rounded-[28px] border border-dashed border-slate-300/80 bg-white/75 p-6 shadow-lg shadow-slate-950/5 backdrop-blur"><p class="text-sm text-slate-500">ここに要件定義、論点、ロール定義が表示されます。</p></section>';
    state.completed = false;
    state.seenEventIds = new Set();
    renderMessage("あなた", message, false);
    statusText.textContent =
      "要件定義役を立ち上げて、テーマの整理を始めています。";

    const response = await fetch("/api/phase1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: message }),
    });

    if (!response.ok) {
      state.awaitingResponse = false;
      updateInputMode();
      statusText.textContent = "セッションの作成に失敗しました。";
      return;
    }

    const payload = await response.json();
    state.sessionId = payload.sessionId;
    sessionBadge.dataset.sessionId = payload.sessionId;
    sessionBadge.dataset.sessionStatus = "collecting_requirements";
    sessionBadge.dataset.phase2Status = "idle";
    state.phase2Status = "idle";
    sessionBadge.textContent = \`Session: \${payload.sessionId}\`;
    connectEvents();
    statusText.textContent =
      "要件定義役がテーマを読み込み、確認ポイントを整理しています。";
    updateInputMode();
    return;
  }

  statusText.textContent = state.completed
    ? "要件定義役が方向修正を反映し、要件と論点を再整理しています。"
    : "要件定義役が回答内容を読み込み、要件と不足情報を整理しています。";

  if (state.completed) {
    state.completed = false;
    sessionBadge.dataset.sessionStatus = "collecting_requirements";
    const startLink = resultPanel.querySelector('a[href^="/arena/"]');
    if (startLink?.parentElement) {
      startLink.parentElement.remove();
    }
    connectEvents();
  }

  const response = await fetch(\`/api/phase1/sessions/\${state.sessionId}/messages\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    state.awaitingResponse = false;
    state.completed = wasCompleted;
    sessionBadge.dataset.sessionStatus = wasCompleted ? "completed" : "collecting_requirements";
    updateInputMode();
    statusText.textContent = "回答の送信に失敗しました。";
  }
});

updateInputMode();
if (state.sessionId && !state.completed) {
  connectEvents();
  statusText.textContent = "保存済みセッションを再開しました。";
}
if (state.completed) {
  statusText.textContent = state.phase2Status === "idle"
    ? "整理済みの要件・論点・ロール定義を表示しています。必要なら方向修正を送れます。"
    : "整理済みの要件・論点・ロール定義を表示しています。";
}
`;

const createFallbackAgent = (): RequirementAgent => ({
  async decide() {
    throw new Error(
      "OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL を設定してください。",
    );
  },
});

export const registerPhase1Routes = (
  app: Hono,
  options: RegisterPhase1RoutesOptions,
) => {
  const { service, repository } = options;

  app.use(
    "*",
    jsxRenderer(({ children }) => (
      <PageShell title="roles">{children}</PageShell>
    )),
  );

  app.get("/", (c) => {
    const sessions = repository.listSessions();
    return c.render(
      <>
        <HomePage sessions={sessions} />
        <script dangerouslySetInnerHTML={{ __html: homeClientScript }} />
      </>,
    );
  });

  app.get("/sessions/new", (c) => {
    return c.render(
      <>
        <SessionPage session={null} />
        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
      </>,
    );
  });

  app.get("/sessions/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      return c.notFound();
    }

    return c.render(
      <>
        <SessionPage session={session} />
        <script dangerouslySetInnerHTML={{ __html: clientScript }} />
      </>,
    );
  });

  app.post("/api/phase1/sessions", async (c) => {
    const body = (await c.req.json()) as { topic?: unknown };
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";

    if (!topic) {
      logger.error("Phase1 session creation rejected", {
        reason: "topic_missing",
      });
      return c.json({ message: "topic is required." }, 400);
    }

    try {
      const session = await service.createSession(topic);
      logger.info("Phase1 session creation response sent", {
        sessionId: session.id,
      });
      return c.json({ sessionId: session.id }, 201);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase1 session creation failed", {
        message: messageText,
      });
      return c.json({ message: messageText }, 500);
    }
  });

  app.post("/api/phase1/sessions/:sessionId/messages", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      logger.error("Phase1 reply rejected", {
        sessionId,
        reason: "message_missing",
      });
      return c.json({ message: "message is required." }, 400);
    }

    try {
      service.submitReply(sessionId, message);
      logger.info("Phase1 reply response sent", {
        sessionId,
      });
      return c.body(null, 202);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase1 reply handling failed", {
        sessionId,
        message: messageText,
      });
      if (messageText === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (messageText === "session_not_collecting") {
        return c.json(
          { message: "this session is not accepting replies." },
          409,
        );
      }
      if (messageText === "session_processing") {
        return c.json({ message: "session is processing. please wait." }, 409);
      }
      return c.json({ message: "failed to process reply." }, 500);
    }
  });

  app.post("/api/sessions/:sessionId/fork", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      logger.error("Phase1 follow-up session rejected", {
        sessionId,
        reason: "message_missing",
      });
      return c.json({ message: "message is required." }, 400);
    }

    try {
      const session = await service.createSessionFromExistingChat(
        sessionId,
        message,
      );
      logger.info("Phase1 follow-up session response sent", {
        sourceSessionId: sessionId,
        newSessionId: session.id,
      });
      return c.json({ sessionId: session.id }, 201);
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "unexpected_error";
      logger.error("Phase1 follow-up session failed", {
        sessionId,
        message: messageText,
      });
      if (messageText === "session_not_found") {
        return c.json({ message: "session not found." }, 404);
      }
      if (messageText === "session_phase1_not_completed") {
        return c.json(
          { message: "only sessions with completed phase 1 can fork." },
          409,
        );
      }
      return c.json({ message: "failed to create follow-up session." }, 500);
    }
  });

  app.delete("/api/sessions/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const deleted = repository.deleteSession(sessionId);

    if (!deleted) {
      logger.error("Session deletion failed", {
        sessionId,
        reason: "session_not_found",
      });
      return c.json({ message: "session not found." }, 404);
    }

    logger.info("Session deleted", {
      sessionId,
    });
    return c.body(null, 204);
  });

  app.get("/api/phase1/sessions/:sessionId/events", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      logger.error("Phase1 SSE connection rejected", {
        sessionId,
        reason: "session_not_found",
      });
      return c.json({ message: "session not found." }, 404);
    }

    logger.info("Phase1 SSE connection opened", {
      sessionId,
    });
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
          event.event === "phase2_started" ||
          event.event === "arena_message" ||
          event.event === "judge_result" ||
          event.event === "phase2_completed"
        ) {
          continue;
        }
        await send(event.event, event.data, event.id);
      }

      const latestSession = service.getSession(sessionId);
      if (
        !latestSession ||
        latestSession.phase1.status !== "collecting_requirements"
      ) {
        return;
      }

      let resolveClosed: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const unsubscribe = service.subscribe(sessionId, (event) => {
        if (
          event.event === "phase2_started" ||
          event.event === "arena_message" ||
          event.event === "judge_result" ||
          event.event === "phase2_completed"
        ) {
          return;
        }

        void (async () => {
          await send(event.event, event.data, event.id);
          if (
            event.event === "requirements_completed" ||
            event.event === "error"
          ) {
            unsubscribe();
            resolveClosed?.();
          }
        })();
      });

      c.req.raw.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          logger.info("Phase1 SSE connection aborted", {
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

export const createPhase1App = (options: CreatePhase1AppOptions = {}) => {
  const app = new Hono();
  registerStaticAssetRoutes(app);
  registerDevReloadRoutes(app);
  const requirementAgent =
    options.requirementAgent ?? safelyCreateRequirementAgentFromEnv();
  const sessionTitleAgent =
    options.sessionTitleAgent ?? safelyCreateSessionTitleAgentFromEnv();
  const repository = options.repository ?? new WorkflowSessionRepository();
  const service = new Phase1Service(
    repository,
    requirementAgent,
    sessionTitleAgent,
    {
      maxUserReplyCount: options.maxUserReplyCount,
    },
  );

  registerPhase1Routes(app, {
    service,
    repository,
  });

  return app;
};

const safelyCreateRequirementAgentFromEnv = () => {
  try {
    return createRequirementAgentFromEnv();
  } catch {
    return createFallbackAgent();
  }
};

const safelyCreateSessionTitleAgentFromEnv = () => {
  try {
    return createSessionTitleAgentFromEnv();
  } catch {
    return {
      async generateTitle() {
        throw new Error("failed to generate session title.");
      },
    } satisfies SessionTitleAgent;
  }
};
