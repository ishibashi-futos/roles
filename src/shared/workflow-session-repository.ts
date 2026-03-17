import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "./logger";
import type {
  ArenaMessage,
  JudgeDecisionRecord,
  Phase1Result,
  Phase3CompletionReason,
  Phase2CompletionReason,
  Phase2Error,
  PointStatus,
  RequirementMessage,
  WorkflowSession,
  WorkflowSseEvent,
} from "./workflow-types";
import {
  createInitialPhase2State,
  createInitialPhase3State,
} from "./workflow-types";

type SessionRow = {
  id: string;
  title: string;
  topic: string;
  phase1_status: string;
  phase1_messages: string;
  phase1_result: string | null;
  phase1_user_reply_count: number;
  phase1_is_processing: number;
  phase1_error_message: string | null;
  phase2_status: string;
  phase2_current_discussion_point_index: number;
  phase2_current_turn_count: number;
  phase2_total_turn_count: number;
  phase2_max_turns_per_point_override: number | null;
  phase2_max_total_turns_override: number | null;
  phase2_messages: string;
  phase2_point_statuses: string;
  phase2_judge_decisions: string;
  phase2_last_judge_decision: string | null;
  phase2_completion_reason: string | null;
  phase2_is_processing: number;
  phase2_error: string | null;
  phase3_status: string;
  phase3_report_markdown: string | null;
  phase3_completion_reason: string | null;
  phase3_is_processing: number;
  phase3_error_message: string | null;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: number;
  event: string;
  data: string;
};

type Subscriber = (event: WorkflowSseEvent) => void;

const DEFAULT_DATABASE_PATH = "./.data/roles.sqlite";

const serialize = (value: unknown) => JSON.stringify(value);

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error("SQLite JSON parse failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
};

const mapSession = (row: SessionRow): WorkflowSession => ({
  id: row.id,
  title: row.title,
  topic: row.topic,
  phase1: {
    status: row.phase1_status as WorkflowSession["phase1"]["status"],
    messages: parseJson<RequirementMessage[]>(row.phase1_messages, []),
    result: parseJson<Phase1Result | null>(row.phase1_result, null),
    userReplyCount: row.phase1_user_reply_count,
    isProcessing: Boolean(row.phase1_is_processing),
    errorMessage: row.phase1_error_message,
  },
  phase2: {
    ...createInitialPhase2State(),
    status: row.phase2_status as WorkflowSession["phase2"]["status"],
    currentDiscussionPointIndex: row.phase2_current_discussion_point_index,
    currentTurnCount: row.phase2_current_turn_count,
    totalTurnCount: row.phase2_total_turn_count,
    maxTurnsPerPointOverride: row.phase2_max_turns_per_point_override,
    maxTotalTurnsOverride: row.phase2_max_total_turns_override,
    messages: parseJson<ArenaMessage[]>(row.phase2_messages, []),
    pointStatuses: parseJson<PointStatus[]>(row.phase2_point_statuses, []),
    judgeDecisions: parseJson<JudgeDecisionRecord[]>(
      row.phase2_judge_decisions,
      [],
    ),
    lastJudgeDecision: parseJson<JudgeDecisionRecord | null>(
      row.phase2_last_judge_decision,
      null,
    ),
    completionReason:
      row.phase2_completion_reason as WorkflowSession["phase2"]["completionReason"],
    isProcessing: Boolean(row.phase2_is_processing),
    error: parseJson<Phase2Error | null>(row.phase2_error, null),
  },
  phase3: {
    ...createInitialPhase3State(),
    status: row.phase3_status as WorkflowSession["phase3"]["status"],
    reportMarkdown: row.phase3_report_markdown,
    completionReason:
      row.phase3_completion_reason as WorkflowSession["phase3"]["completionReason"],
    isProcessing: Boolean(row.phase3_is_processing),
    errorMessage: row.phase3_error_message,
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const createSessionId = () => crypto.randomUUID();
const createMessageId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export class WorkflowSessionRepository {
  private readonly database: Database;
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(
    databasePath = process.env.ROLES_DB_PATH ?? DEFAULT_DATABASE_PATH,
  ) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.database = new Database(databasePath, { create: true });
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        topic TEXT NOT NULL,
        phase1_status TEXT NOT NULL,
        phase1_messages TEXT NOT NULL,
        phase1_result TEXT,
        phase1_user_reply_count INTEGER NOT NULL,
        phase1_is_processing INTEGER NOT NULL,
        phase1_error_message TEXT,
        phase2_status TEXT NOT NULL,
        phase2_current_discussion_point_index INTEGER NOT NULL,
        phase2_current_turn_count INTEGER NOT NULL,
        phase2_total_turn_count INTEGER NOT NULL,
        phase2_max_turns_per_point_override INTEGER,
        phase2_max_total_turns_override INTEGER,
        phase2_messages TEXT NOT NULL,
        phase2_point_statuses TEXT NOT NULL,
        phase2_judge_decisions TEXT NOT NULL DEFAULT '[]',
        phase2_last_judge_decision TEXT,
        phase2_completion_reason TEXT,
        phase2_is_processing INTEGER NOT NULL,
        phase2_error TEXT,
        phase3_status TEXT NOT NULL DEFAULT 'idle',
        phase3_report_markdown TEXT,
        phase3_completion_reason TEXT,
        phase3_is_processing INTEGER NOT NULL DEFAULT 0,
        phase3_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureSessionColumns();
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL,
        id INTEGER NOT NULL,
        event TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
    `);
  }

  createSession(input: { title: string; topic: string }) {
    const timestamp = now();
    const session: WorkflowSession = {
      id: createSessionId(),
      title: input.title,
      topic: input.topic,
      phase1: {
        status: "collecting_requirements",
        messages: [{ role: "user", content: input.topic }],
        result: null,
        userReplyCount: 0,
        isProcessing: false,
        errorMessage: null,
      },
      phase2: createInitialPhase2State(),
      phase3: createInitialPhase3State(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.insertSession(session);

    this.pushEvent(session.id, {
      id: 0,
      event: "session_created",
      data: {
        sessionId: session.id,
        title: session.title,
        topic: session.topic,
      },
    });

    return session;
  }

  createSessionFromPhase1Messages(input: {
    title: string;
    topic: string;
    messages: RequirementMessage[];
    userReplyCount?: number;
  }) {
    const timestamp = now();
    const session: WorkflowSession = {
      id: createSessionId(),
      title: input.title,
      topic: input.topic,
      phase1: {
        status: "collecting_requirements",
        messages: [...input.messages],
        result: null,
        userReplyCount: input.userReplyCount ?? 0,
        isProcessing: false,
        errorMessage: null,
      },
      phase2: createInitialPhase2State(),
      phase3: createInitialPhase3State(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.insertSession(session);

    this.pushEvent(session.id, {
      id: 0,
      event: "session_created",
      data: {
        sessionId: session.id,
        title: session.title,
        topic: session.topic,
      },
    });

    return session;
  }

  createSessionForPhase2Resume(input: {
    sourceSessionId: string;
    maxTurnsPerPointOverride: number;
    maxTotalTurnsOverride: number;
  }) {
    const sourceSession = this.requireSession(input.sourceSessionId);
    const sourceResult = sourceSession.phase1.result;

    if (!sourceResult || sourceSession.phase1.status !== "completed") {
      throw new Error("session_phase1_not_completed");
    }

    const timestamp = now();
    const session: WorkflowSession = {
      id: createSessionId(),
      title: sourceSession.title,
      topic: sourceSession.topic,
      phase1: {
        status: "completed",
        messages: [...sourceSession.phase1.messages],
        result: sourceResult,
        userReplyCount: sourceSession.phase1.userReplyCount,
        isProcessing: false,
        errorMessage: null,
      },
      phase2: {
        status: "idle",
        currentDiscussionPointIndex:
          sourceSession.phase2.currentDiscussionPointIndex,
        currentTurnCount: sourceSession.phase2.currentTurnCount,
        totalTurnCount: sourceSession.phase2.totalTurnCount,
        maxTurnsPerPointOverride: input.maxTurnsPerPointOverride,
        maxTotalTurnsOverride: input.maxTotalTurnsOverride,
        messages: [...sourceSession.phase2.messages],
        pointStatuses: sourceSession.phase2.pointStatuses.map((status) => ({
          ...status,
          status: status.status === "resolved" ? "resolved" : "pending",
        })),
        judgeDecisions: [...sourceSession.phase2.judgeDecisions],
        lastJudgeDecision: sourceSession.phase2.lastJudgeDecision,
        completionReason: null,
        isProcessing: false,
        error: null,
      },
      phase3: createInitialPhase3State(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.insertSession(session);

    this.pushEvent(session.id, {
      id: 0,
      event: "session_created",
      data: {
        sessionId: session.id,
        title: session.title,
        topic: session.topic,
      },
    });

    return session;
  }

  getSession(sessionId: string) {
    const row = this.database
      .query(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as SessionRow | null;
    return row ? mapSession(row) : null;
  }

  listSessions() {
    const rows = this.database
      .query(`SELECT * FROM sessions ORDER BY updated_at DESC, created_at DESC`)
      .all() as SessionRow[];
    return rows.map(mapSession);
  }

  deleteSession(sessionId: string) {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }

    this.database
      .query(`DELETE FROM session_events WHERE session_id = ?`)
      .run(sessionId);
    this.database.query(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    this.subscribers.delete(sessionId);
    return true;
  }

  appendPhase1UserMessage(sessionId: string, content: string) {
    const session = this.requireSession(sessionId);
    session.phase1.messages.push({ role: "user", content });
    session.phase1.userReplyCount += 1;
    this.saveSession(session);
    return session;
  }

  reopenPhase1(sessionId: string, userReplyCount: number) {
    const session = this.requireSession(sessionId);
    session.phase1.status = "collecting_requirements";
    session.phase1.userReplyCount = userReplyCount;
    session.phase1.isProcessing = false;
    session.phase1.errorMessage = null;
    session.phase2 = createInitialPhase2State();
    session.phase3 = createInitialPhase3State();
    this.saveSession(session);
    return session;
  }

  appendPhase1AssistantMessage(sessionId: string, content: string) {
    const session = this.requireSession(sessionId);
    session.phase1.messages.push({ role: "assistant", content });
    this.saveSession(session);
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

  completePhase1(sessionId: string, message: string, result: Phase1Result) {
    const session = this.requireSession(sessionId);
    session.phase1.status = "completed";
    session.phase1.result = result;
    session.phase1.messages.push({ role: "assistant", content: message });
    this.initializePhase2(session);
    this.saveSession(session);
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

  failPhase1(sessionId: string, message: string) {
    const session = this.requireSession(sessionId);
    session.phase1.status = "failed";
    session.phase1.errorMessage = message;
    this.saveSession(session);
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

  setPhase1Processing(sessionId: string, isProcessing: boolean) {
    const session = this.requireSession(sessionId);
    session.phase1.isProcessing = isProcessing;
    this.saveSession(session);
    return session;
  }

  markPhase2Started(sessionId: string) {
    const session = this.requireSession(sessionId);
    if (session.phase2.pointStatuses.length === 0) {
      this.initializePhase2(session);
    }
    session.phase2.status = "running";
    session.phase2.isProcessing = true;
    session.phase2.error = null;
    session.phase2.completionReason = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase2_started",
      data: {
        sessionId,
      },
    });
    return session;
  }

  appendArenaMessage(sessionId: string, message: Omit<ArenaMessage, "id">) {
    const session = this.requireSession(sessionId);
    const messageWithId: ArenaMessage = {
      id: createMessageId(),
      ...message,
    };
    session.phase2.messages.push(messageWithId);
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "arena_message",
      data: {
        sessionId,
        message: messageWithId,
      },
    });
    return messageWithId;
  }

  recordJudgeDecision(sessionId: string, result: JudgeDecisionRecord) {
    const session = this.requireSession(sessionId);
    session.phase2.judgeDecisions.push(result);
    session.phase2.lastJudgeDecision = result;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "judge_result",
      data: {
        sessionId,
        result,
      },
    });
    return result;
  }

  updatePhase2Counters(
    sessionId: string,
    values: {
      currentDiscussionPointIndex?: number;
      currentTurnCount?: number;
      totalTurnCount?: number;
    },
  ) {
    const session = this.requireSession(sessionId);
    session.phase2.currentDiscussionPointIndex =
      values.currentDiscussionPointIndex ??
      session.phase2.currentDiscussionPointIndex;
    session.phase2.currentTurnCount =
      values.currentTurnCount ?? session.phase2.currentTurnCount;
    session.phase2.totalTurnCount =
      values.totalTurnCount ?? session.phase2.totalTurnCount;
    this.saveSession(session);
    return session;
  }

  setPointStatus(
    sessionId: string,
    discussionPointId: string,
    status: PointStatus["status"],
  ) {
    const session = this.requireSession(sessionId);
    session.phase2.pointStatuses = session.phase2.pointStatuses.map((point) =>
      point.discussionPointId === discussionPointId
        ? { ...point, status }
        : point,
    );
    this.saveSession(session);
    return session;
  }

  completePhase2(sessionId: string, reason: Phase2CompletionReason) {
    const session = this.requireSession(sessionId);
    session.phase2.status = "completed";
    session.phase2.completionReason = reason;
    session.phase2.isProcessing = false;
    session.phase2.error = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase2_completed",
      data: {
        sessionId,
        reason,
      },
    });
    return session;
  }

  failPhase2(sessionId: string, error: Phase2Error) {
    const session = this.requireSession(sessionId);
    session.phase2.status = "failed";
    session.phase2.completionReason = "failed";
    session.phase2.isProcessing = false;
    session.phase2.error = error;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "error",
      data: {
        sessionId,
        message: error.message,
      },
    });
    return session;
  }

  setPhase2Processing(sessionId: string, isProcessing: boolean) {
    const session = this.requireSession(sessionId);
    session.phase2.isProcessing = isProcessing;
    this.saveSession(session);
    return session;
  }

  markPhase3Started(sessionId: string) {
    const session = this.requireSession(sessionId);
    session.phase3.status = "running";
    session.phase3.reportMarkdown = null;
    session.phase3.completionReason = null;
    session.phase3.isProcessing = true;
    session.phase3.errorMessage = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase3_started",
      data: {
        sessionId,
      },
    });
    return session;
  }

  completePhase3(
    sessionId: string,
    reportMarkdown: string,
    reason: Phase3CompletionReason,
  ) {
    const session = this.requireSession(sessionId);
    session.phase3.status = "completed";
    session.phase3.reportMarkdown = reportMarkdown;
    session.phase3.completionReason = reason;
    session.phase3.isProcessing = false;
    session.phase3.errorMessage = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase3_completed",
      data: {
        sessionId,
      },
    });
    return session;
  }

  failPhase3(sessionId: string, message: string) {
    const session = this.requireSession(sessionId);
    session.phase3.status = "failed";
    session.phase3.completionReason = "failed";
    session.phase3.isProcessing = false;
    session.phase3.errorMessage = message;
    this.saveSession(session);
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

  setPhase3Processing(sessionId: string, isProcessing: boolean) {
    const session = this.requireSession(sessionId);
    session.phase3.isProcessing = isProcessing;
    this.saveSession(session);
    return session;
  }

  resetPhase3ForRetry(sessionId: string) {
    const session = this.requireSession(sessionId);
    session.phase3.status = "running";
    session.phase3.reportMarkdown = null;
    session.phase3.completionReason = null;
    session.phase3.isProcessing = true;
    session.phase3.errorMessage = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase3_started",
      data: {
        sessionId,
      },
    });
    return session;
  }

  resetCurrentPointForRetry(sessionId: string) {
    const session = this.requireSession(sessionId);
    const result = session.phase1.result;
    if (!result) {
      throw new Error("session_phase1_not_completed");
    }

    const point =
      result.discussionPoints[session.phase2.currentDiscussionPointIndex];
    if (!point) {
      throw new Error("discussion_point_not_found");
    }

    session.phase2.messages = session.phase2.messages.filter(
      (message) => message.discussionPointId !== point.id,
    );
    session.phase2.judgeDecisions = session.phase2.judgeDecisions.filter(
      (decision) => decision.discussionPointId !== point.id,
    );
    session.phase2.currentTurnCount = 0;
    session.phase2.lastJudgeDecision =
      session.phase2.lastJudgeDecision?.discussionPointId === point.id
        ? null
        : session.phase2.lastJudgeDecision;
    session.phase2.pointStatuses = session.phase2.pointStatuses.map((status) =>
      status.discussionPointId === point.id
        ? { ...status, status: "pending" }
        : status,
    );
    session.phase2.status = "running";
    session.phase2.isProcessing = true;
    session.phase2.error = null;
    session.phase2.completionReason = null;
    this.saveSession(session);
    this.pushEvent(sessionId, {
      id: 0,
      event: "phase2_started",
      data: {
        sessionId,
      },
    });
    return session;
  }

  replacePhase2Messages(sessionId: string, messages: ArenaMessage[]) {
    const session = this.requireSession(sessionId);
    session.phase2.messages = messages;
    this.saveSession(session);
    return session;
  }

  getEventHistory(sessionId: string) {
    const rows = this.database
      .query(
        `SELECT id, event, data FROM session_events WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId) as EventRow[];
    return rows.map((row) => ({
      id: row.id,
      event: row.event,
      data: parseJson<Record<string, unknown>>(row.data, {}),
    })) as WorkflowSseEvent[];
  }

  subscribe(sessionId: string, subscriber: Subscriber) {
    const current = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
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

  private initializePhase2(session: WorkflowSession) {
    const discussionPoints = session.phase1.result?.discussionPoints ?? [];
    session.phase2.pointStatuses = discussionPoints.map((point) => ({
      discussionPointId: point.id,
      status: "pending",
    }));
  }

  private saveSession(session: WorkflowSession) {
    session.updatedAt = now();
    this.database
      .query(
        `UPDATE sessions SET
          title = ?,
          topic = ?,
          phase1_status = ?,
          phase1_messages = ?,
          phase1_result = ?,
          phase1_user_reply_count = ?,
          phase1_is_processing = ?,
          phase1_error_message = ?,
          phase2_status = ?,
          phase2_current_discussion_point_index = ?,
          phase2_current_turn_count = ?,
          phase2_total_turn_count = ?,
          phase2_max_turns_per_point_override = ?,
          phase2_max_total_turns_override = ?,
          phase2_messages = ?,
          phase2_point_statuses = ?,
          phase2_judge_decisions = ?,
          phase2_last_judge_decision = ?,
          phase2_completion_reason = ?,
          phase2_is_processing = ?,
          phase2_error = ?,
          phase3_status = ?,
          phase3_report_markdown = ?,
          phase3_completion_reason = ?,
          phase3_is_processing = ?,
          phase3_error_message = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .run(
        session.title,
        session.topic,
        session.phase1.status,
        serialize(session.phase1.messages),
        session.phase1.result ? serialize(session.phase1.result) : null,
        session.phase1.userReplyCount,
        Number(session.phase1.isProcessing),
        session.phase1.errorMessage,
        session.phase2.status,
        session.phase2.currentDiscussionPointIndex,
        session.phase2.currentTurnCount,
        session.phase2.totalTurnCount,
        session.phase2.maxTurnsPerPointOverride,
        session.phase2.maxTotalTurnsOverride,
        serialize(session.phase2.messages),
        serialize(session.phase2.pointStatuses),
        serialize(session.phase2.judgeDecisions),
        session.phase2.lastJudgeDecision
          ? serialize(session.phase2.lastJudgeDecision)
          : null,
        session.phase2.completionReason,
        Number(session.phase2.isProcessing),
        session.phase2.error ? serialize(session.phase2.error) : null,
        session.phase3.status,
        session.phase3.reportMarkdown,
        session.phase3.completionReason,
        Number(session.phase3.isProcessing),
        session.phase3.errorMessage,
        session.updatedAt,
        session.id,
      );
  }

  private ensureSessionColumns() {
    const rows = this.database
      .query(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    const columns = new Set(rows.map((row) => row.name));

    const missingColumns = [
      {
        name: "title",
        sql: "ALTER TABLE sessions ADD COLUMN title TEXT",
      },
      {
        name: "phase2_max_turns_per_point_override",
        sql: "ALTER TABLE sessions ADD COLUMN phase2_max_turns_per_point_override INTEGER",
      },
      {
        name: "phase2_max_total_turns_override",
        sql: "ALTER TABLE sessions ADD COLUMN phase2_max_total_turns_override INTEGER",
      },
      {
        name: "phase2_judge_decisions",
        sql: "ALTER TABLE sessions ADD COLUMN phase2_judge_decisions TEXT NOT NULL DEFAULT '[]'",
      },
      {
        name: "phase3_status",
        sql: "ALTER TABLE sessions ADD COLUMN phase3_status TEXT NOT NULL DEFAULT 'idle'",
      },
      {
        name: "phase3_report_markdown",
        sql: "ALTER TABLE sessions ADD COLUMN phase3_report_markdown TEXT",
      },
      {
        name: "phase3_completion_reason",
        sql: "ALTER TABLE sessions ADD COLUMN phase3_completion_reason TEXT",
      },
      {
        name: "phase3_is_processing",
        sql: "ALTER TABLE sessions ADD COLUMN phase3_is_processing INTEGER NOT NULL DEFAULT 0",
      },
      {
        name: "phase3_error_message",
        sql: "ALTER TABLE sessions ADD COLUMN phase3_error_message TEXT",
      },
    ];

    for (const column of missingColumns) {
      if (columns.has(column.name)) {
        continue;
      }
      this.database.exec(column.sql);
    }

    if (!columns.has("title")) {
      this.database.exec(
        `UPDATE sessions SET title = topic WHERE title IS NULL`,
      );
    }
  }

  private insertSession(session: WorkflowSession) {
    this.database
      .query(
        `INSERT INTO sessions (
          id, title, topic, phase1_status, phase1_messages, phase1_result,
          phase1_user_reply_count, phase1_is_processing, phase1_error_message,
          phase2_status, phase2_current_discussion_point_index, phase2_current_turn_count,
          phase2_total_turn_count, phase2_max_turns_per_point_override,
          phase2_max_total_turns_override, phase2_messages, phase2_point_statuses,
          phase2_judge_decisions, phase2_last_judge_decision, phase2_completion_reason,
          phase2_is_processing, phase2_error, phase3_status, phase3_report_markdown,
          phase3_completion_reason, phase3_is_processing, phase3_error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.title,
        session.topic,
        session.phase1.status,
        serialize(session.phase1.messages),
        session.phase1.result ? serialize(session.phase1.result) : null,
        session.phase1.userReplyCount,
        Number(session.phase1.isProcessing),
        session.phase1.errorMessage,
        session.phase2.status,
        session.phase2.currentDiscussionPointIndex,
        session.phase2.currentTurnCount,
        session.phase2.totalTurnCount,
        session.phase2.maxTurnsPerPointOverride,
        session.phase2.maxTotalTurnsOverride,
        serialize(session.phase2.messages),
        serialize(session.phase2.pointStatuses),
        serialize(session.phase2.judgeDecisions),
        session.phase2.lastJudgeDecision
          ? serialize(session.phase2.lastJudgeDecision)
          : null,
        session.phase2.completionReason,
        Number(session.phase2.isProcessing),
        session.phase2.error ? serialize(session.phase2.error) : null,
        session.phase3.status,
        session.phase3.reportMarkdown,
        session.phase3.completionReason,
        Number(session.phase3.isProcessing),
        session.phase3.errorMessage,
        session.createdAt,
        session.updatedAt,
      );
  }

  private pushEvent(sessionId: string, event: WorkflowSseEvent) {
    const nextId = this.nextEventId(sessionId);
    const eventWithId = {
      ...event,
      id: nextId,
    } satisfies WorkflowSseEvent;

    this.database
      .query(
        `INSERT INTO session_events (session_id, id, event, data) VALUES (?, ?, ?, ?)`,
      )
      .run(sessionId, nextId, eventWithId.event, serialize(eventWithId.data));

    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(eventWithId);
    }
  }

  private nextEventId(sessionId: string) {
    const row = this.database
      .query(
        `SELECT COALESCE(MAX(id), 0) AS id FROM session_events WHERE session_id = ?`,
      )
      .get(sessionId) as { id: number };
    return row.id + 1;
  }

  private requireSession(sessionId: string) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("session_not_found");
    }
    return session;
  }
}
