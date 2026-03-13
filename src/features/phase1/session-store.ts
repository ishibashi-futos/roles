import type {
  Phase1Result,
  Phase1SseEvent,
  RequirementMessage,
  RequirementSession,
} from "./types";

type Phase1Subscriber = (event: Phase1SseEvent) => void;

const createSessionId = () => crypto.randomUUID();

export class Phase1SessionStore {
  private sessions = new Map<string, RequirementSession>();
  private subscribers = new Map<string, Set<Phase1Subscriber>>();
  private eventHistory = new Map<string, Phase1SseEvent[]>();
  private eventSequenceBySession = new Map<string, number>();

  create(topic: string) {
    const session: RequirementSession = {
      id: createSessionId(),
      topic,
      status: "collecting_requirements",
      messages: [{ role: "user", content: topic }],
      result: null,
      userReplyCount: 0,
      isProcessing: false,
      errorMessage: null,
    };

    this.sessions.set(session.id, session);
    this.pushEvent(session.id, {
      id: 0,
      event: "session_created",
      data: {
        sessionId: session.id,
        topic: session.topic,
      },
    });

    return session;
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  appendUserMessage(sessionId: string, content: string) {
    const session = this.requireSession(sessionId);
    session.messages.push({ role: "user", content });
    session.userReplyCount += 1;
    return session;
  }

  appendAssistantMessage(sessionId: string, content: string) {
    const session = this.requireSession(sessionId);
    session.messages.push({ role: "assistant", content });
    this.pushEvent(sessionId, {
      id: 0,
      event: "assistant_delta",
      data: {
        sessionId,
        content,
      },
    });
    this.pushEvent(sessionId, {
      id: 0,
      event: "assistant_done",
      data: {
        sessionId,
      },
    });
    return session;
  }

  complete(sessionId: string, message: string, result: Phase1Result) {
    const session = this.requireSession(sessionId);
    session.status = "completed";
    session.result = result;
    session.messages.push({ role: "assistant", content: message });
    this.pushEvent(sessionId, {
      id: 0,
      event: "assistant_delta",
      data: {
        sessionId,
        content: message,
      },
    });
    this.pushEvent(sessionId, {
      id: 0,
      event: "assistant_done",
      data: {
        sessionId,
      },
    });
    this.pushEvent(sessionId, {
      id: 0,
      event: "requirements_completed",
      data: {
        sessionId,
        result,
      },
    });
    return session;
  }

  fail(sessionId: string, message: string) {
    const session = this.requireSession(sessionId);
    session.status = "failed";
    session.errorMessage = message;
    this.pushEvent(sessionId, {
      id: 0,
      event: "error",
      data: {
        sessionId,
        message,
      },
    });
    return session;
  }

  setProcessing(sessionId: string, isProcessing: boolean) {
    const session = this.requireSession(sessionId);
    session.isProcessing = isProcessing;
    return session;
  }

  subscribe(sessionId: string, subscriber: Phase1Subscriber) {
    const current =
      this.subscribers.get(sessionId) ?? new Set<Phase1Subscriber>();
    current.add(subscriber);
    this.subscribers.set(sessionId, current);

    return () => {
      const target = this.subscribers.get(sessionId);
      if (!target) {
        return;
      }
      target.delete(subscriber);
      if (target.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  getEventHistory(sessionId: string) {
    return [...(this.eventHistory.get(sessionId) ?? [])];
  }

  private pushEvent(sessionId: string, event: Phase1SseEvent) {
    const nextId = (this.eventSequenceBySession.get(sessionId) ?? 0) + 1;
    this.eventSequenceBySession.set(sessionId, nextId);

    const eventWithId = {
      ...event,
      id: nextId,
    } satisfies Phase1SseEvent;

    const history = this.eventHistory.get(sessionId) ?? [];
    history.push(eventWithId);
    this.eventHistory.set(sessionId, history);

    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(eventWithId);
    }
  }

  private requireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }
}
