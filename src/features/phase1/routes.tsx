import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Child } from "hono/jsx";
import { jsxRenderer } from "hono/jsx-renderer";
import { logger } from "../../shared/logger";
import type { RequirementAgent } from "./requirement-agent";
import { createRequirementAgentFromEnv } from "./requirement-agent";
import { Phase1SessionStore } from "./session-store";
import { Phase1Service } from "./service";
import type {
  Phase1Result,
  RequirementMessage,
  RequirementSession,
} from "./types";

type CreatePhase1AppOptions = {
  requirementAgent?: RequirementAgent;
  maxUserReplyCount?: number;
};

const renderMessages = (messages: RequirementMessage[]) =>
  [...messages].reverse().map((message, index) => (
    <article
      id={`message-${index}`}
      class={`rounded-2xl border px-4 py-3 ${
        message.role === "assistant"
          ? "border-slate-300 bg-white"
          : "border-emerald-300 bg-emerald-50"
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

const renderResult = (result: Phase1Result | null): Child => {
  if (!result) {
    return (
      <section class="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-6">
        <p class="text-sm text-slate-500">
          ここに要件定義、論点、ロール定義が表示されます。
        </p>
      </section>
    );
  }

  return (
    <section class="space-y-6">
      <article class="rounded-3xl bg-slate-950 p-6 text-white">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">
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

      <article class="rounded-3xl border border-slate-200 bg-white p-6">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
          Discussion Points
        </p>
        <div class="mt-4 grid gap-4">
          {result.discussionPoints.map((point) => (
            <section class="rounded-2xl bg-slate-50 p-4">
              <h3 class="font-semibold text-slate-900">{point.title}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-600">
                {point.description}
              </p>
            </section>
          ))}
        </div>
      </article>

      <article class="rounded-3xl border border-slate-200 bg-white p-6">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
          Roles
        </p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          {result.roles.map((role) => (
            <section class="rounded-2xl border border-slate-200 p-4">
              <p class="text-xs uppercase tracking-[0.24em] text-amber-600">
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
      </article>
    </section>
  );
};

const KeyValueList = ({ title, items }: { title: string; items: string[] }) => (
  <section>
    <p class="text-sm font-semibold text-slate-900">{title}</p>
    <ul class="mt-2 space-y-2 text-sm leading-6 text-slate-600">
      {items.map((item) => (
        <li class="rounded-xl bg-white/80 px-3 py-2">{item}</li>
      ))}
    </ul>
  </section>
);

const RootPage = ({ session }: { session: RequirementSession | null }) => (
  <main class="min-h-screen bg-[radial-gradient(circle_at_top,_#fef3c7,_#f8fafc_45%,_#e2e8f0)] px-4 py-10 text-slate-900">
    <div class="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <section class="rounded-[32px] bg-slate-950 p-8 text-white shadow-2xl shadow-slate-950/20">
        <p class="text-sm uppercase tracking-[0.28em] text-amber-300">roles</p>
        <h1 class="mt-4 text-4xl font-semibold leading-tight">
          要件定義から
          <br />
          ロール定義までを固める
        </h1>
        <p class="mt-5 max-w-2xl text-sm leading-7 text-slate-300">
          初期テーマを入力すると、要件定義役が不足情報を対話で回収し、議論に必要な論点とロールを構造化します。
        </p>

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
            class="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-amber-300"
            placeholder="例: SIer 営業の行動データ化を進めるための要件を整理したい"
          />
          <button
            id="message-submit"
            class="rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
            type="submit"
          >
            要件定義を開始
          </button>
        </form>

        <p id="status-text" class="mt-4 text-sm text-amber-200" />

        <section class="mt-8">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">対話ログ</h2>
            <span
              id="session-badge"
              data-session-id={session?.id ?? ""}
              class="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300"
            >
              {session ? `Session: ${session.id}` : "Session: 未開始"}
            </span>
          </div>
          <div id="messages" class="mt-4 space-y-3">
            {session ? renderMessages(session.messages) : null}
          </div>
        </section>
      </section>

      <section>
        <div id="result-panel">{renderResult(session?.result ?? null)}</div>
      </section>
    </div>
  </main>
);

const PageShell = ({ children }: { children: Child }) => (
  <html lang="ja">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>roles</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>{`
        body { font-family: "Hiragino Sans", "Noto Sans JP", sans-serif; }
      `}</style>
    </head>
    <body class="bg-slate-100">{children}</body>
  </html>
);

const clientScript = `
const state = {
  sessionId: document.getElementById("session-badge")?.dataset.sessionId || "",
  eventSource: null,
  completed: false,
  seenEventIds: new Set(),
  awaitingResponse: false,
};

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messageInputLabel = document.getElementById("message-input-label");
const messageSubmit = document.getElementById("message-submit");
const messages = document.getElementById("messages");
const statusText = document.getElementById("status-text");
const resultPanel = document.getElementById("result-panel");
const sessionBadge = document.getElementById("session-badge");

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const renderMessage = (roleLabel, content, isAssistant) => {
  const article = document.createElement("article");
  article.className = isAssistant
    ? "rounded-2xl border border-slate-300 bg-white px-4 py-3"
    : "rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3";
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
      \${items.map((item) => \`<li class="rounded-xl bg-white/80 px-3 py-2">\${escapeHtml(item)}</li>\`).join("")}
    </ul>
  </section>
\`;

const renderResult = (result) => {
  resultPanel.innerHTML = \`
    <section class="space-y-6">
      <article class="rounded-3xl bg-slate-950 p-6 text-white">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300">Requirement Definition</p>
        <h2 class="mt-3 text-2xl font-semibold">\${escapeHtml(result.requirements.theme)}</h2>
        <p class="mt-4 text-sm leading-6 text-slate-200">\${escapeHtml(result.requirements.objective)}</p>
        <div class="mt-5 grid gap-4 md:grid-cols-3">
          \${renderList("成功条件", result.requirements.successCriteria)}
          \${renderList("制約", result.requirements.constraints)}
          \${renderList("前提", result.requirements.assumptions)}
        </div>
      </article>
      <article class="rounded-3xl border border-slate-200 bg-white p-6">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Discussion Points</p>
        <div class="mt-4 grid gap-4">
          \${result.discussionPoints.map((point) => \`
            <section class="rounded-2xl bg-slate-50 p-4">
              <h3 class="font-semibold text-slate-900">\${escapeHtml(point.title)}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-600">\${escapeHtml(point.description)}</p>
            </section>
          \`).join("")}
        </div>
      </article>
      <article class="rounded-3xl border border-slate-200 bg-white p-6">
        <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Roles</p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          \${result.roles.map((role) => \`
            <section class="rounded-2xl border border-slate-200 p-4">
              <p class="text-xs uppercase tracking-[0.24em] text-amber-600">\${escapeHtml(role.perspective)}</p>
              <h3 class="mt-2 text-lg font-semibold text-slate-900">\${escapeHtml(role.name)}</h3>
              <p class="mt-3 text-sm leading-6 text-slate-600">\${escapeHtml(role.systemPromptSeed)}</p>
              <div class="mt-4 grid gap-4">
                \${renderList("責務", role.responsibilities)}
                \${renderList("懸念", role.concerns)}
              </div>
            </section>
          \`).join("")}
        </div>
      </article>
    </section>
  \`;
};

const updateInputMode = () => {
  if (state.completed) {
    messageInputLabel.textContent = "完了";
    messageInput.placeholder = "要件定義は完了しました。";
    messageSubmit.textContent = "完了";
    messageInput.disabled = true;
    messageSubmit.disabled = true;
    return;
  }

  if (!state.sessionId) {
    messageInputLabel.textContent = "テーマ";
    messageInput.placeholder = "例: SIer 営業の行動データ化を進めるための要件を整理したい";
    messageSubmit.textContent = "要件定義を開始";
    messageInput.disabled = state.awaitingResponse;
    messageSubmit.disabled = state.awaitingResponse;
    return;
  }

  messageInputLabel.textContent = "追加回答";
  messageInput.placeholder = "要件定義役から質問が返ってきたら、ここに回答を入力";
  messageSubmit.textContent = "回答を送信";
  messageInput.disabled = state.awaitingResponse;
  messageSubmit.disabled = state.awaitingResponse;
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
    return;
  }

  const isNewSession = !state.sessionId;
  renderMessage("あなた", message, false);
  messageInput.value = "";
  state.awaitingResponse = true;
  updateInputMode();

  if (isNewSession) {
    messages.innerHTML = "";
    resultPanel.innerHTML = '<section class="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-6"><p class="text-sm text-slate-500">ここに要件定義、論点、ロール定義が表示されます。</p></section>';
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
    sessionBadge.textContent = \`Session: \${payload.sessionId}\`;
    connectEvents();
    statusText.textContent =
      "要件定義役がテーマを読み込み、確認ポイントを整理しています。";
    updateInputMode();
    return;
  }

  statusText.textContent =
    "要件定義役が回答内容を読み込み、要件と不足情報を整理しています。";

  const response = await fetch(\`/api/phase1/sessions/\${state.sessionId}/messages\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    state.awaitingResponse = false;
    updateInputMode();
    statusText.textContent = "回答の送信に失敗しました。";
  }
});

updateInputMode();
`;

const createFallbackAgent = (): RequirementAgent => ({
  async decide() {
    throw new Error(
      "OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL を設定してください。",
    );
  },
});

export const createPhase1App = (options: CreatePhase1AppOptions = {}) => {
  const app = new Hono();
  const requirementAgent =
    options.requirementAgent ?? safelyCreateRequirementAgentFromEnv();
  const store = new Phase1SessionStore();
  const service = new Phase1Service(store, requirementAgent, {
    maxUserReplyCount: options.maxUserReplyCount,
  });

  app.use(
    "*",
    jsxRenderer(({ children }) => <PageShell>{children}</PageShell>),
  );

  app.get("/", (c) => {
    return c.render(
      <>
        <RootPage session={null} />
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
      return c.json({ message: "topic は必須です。" }, 400);
    }

    const session = service.createSession(topic);
    logger.info("Phase1 session creation response sent", {
      sessionId: session.id,
    });
    return c.json({ sessionId: session.id }, 201);
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
      return c.json({ message: "message は必須です。" }, 400);
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
        return c.json({ message: "session が見つかりません。" }, 404);
      }
      if (messageText === "session_not_collecting") {
        return c.json(
          { message: "この session は回答を受け付けていません。" },
          409,
        );
      }
      if (messageText === "session_processing") {
        return c.json(
          { message: "処理中のため、しばらく待ってください。" },
          409,
        );
      }
      return c.json({ message: "回答の処理に失敗しました。" }, 500);
    }
  });

  app.get("/api/phase1/sessions/:sessionId/events", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = service.getSession(sessionId);

    if (!session) {
      logger.error("Phase1 SSE connection rejected", {
        sessionId,
        reason: "session_not_found",
      });
      return c.json({ message: "session が見つかりません。" }, 404);
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

      for (const event of store.getEventHistory(sessionId)) {
        await send(event.event, event.data, event.id);
      }

      const latestSession = service.getSession(sessionId);
      if (
        !latestSession ||
        latestSession.status !== "collecting_requirements"
      ) {
        return;
      }

      let resolveClosed: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const unsubscribe = service.subscribe(sessionId, (event) => {
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

  return app;
};

const safelyCreateRequirementAgentFromEnv = () => {
  try {
    return createRequirementAgentFromEnv();
  } catch {
    return createFallbackAgent();
  }
};
