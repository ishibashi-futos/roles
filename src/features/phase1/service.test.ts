import "../../test/silence-runtime";
import { describe, expect, test } from "bun:test";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { RequirementAgent } from "./requirement-agent";
import type { SessionTitleAgent } from "./session-title-agent";
import { Phase1Service } from "./service";

const completedResult = {
  requirements: {
    theme: "営業行動の可視化",
    objective: "営業活動をデータで管理する",
    successCriteria: ["活動履歴の収集", "案件進捗の可視化"],
    constraints: ["現場負荷を増やさない"],
    assumptions: ["既存 CRM を継続利用する"],
  },
  discussionPoints: [
    {
      id: "point-1",
      title: "取得対象データ",
      description: "何を営業活動データとして扱うか",
      decisionOwnerRoleId: "role-1",
    },
    {
      id: "point-2",
      title: "定着方法",
      description: "入力負荷を抑えながら運用する方法",
      decisionOwnerRoleId: "role-1",
    },
  ],
  roles: [
    {
      id: "role-1",
      name: "営業責任者",
      perspective: "売上責任",
      responsibilities: ["施策優先順位の判断"],
      concerns: ["売上への悪影響"],
      systemPromptSeed: "売上責任の観点で発言する",
    },
    {
      id: "role-2",
      name: "現場営業",
      perspective: "入力実務",
      responsibilities: ["日々の活動入力"],
      concerns: ["入力負荷の増大"],
      systemPromptSeed: "現場負荷の観点で発言する",
    },
    {
      id: "role-3",
      name: "情シス",
      perspective: "運用保守",
      responsibilities: ["システム連携の整備"],
      concerns: ["保守コストの増大"],
      systemPromptSeed: "システム運用の観点で発言する",
    },
  ],
};

const sessionTitleAgent: SessionTitleAgent = {
  async generateTitle(input) {
    return input.forkMessage ? "経営判断を優先する営業設計" : "営業行動の整理";
  },
};

describe("Phase1Service", () => {
  test("stale processing を回復して reply を受け付ける", async () => {
    const repository = new WorkflowSessionRepository(":memory:");
    const agent: RequirementAgent = {
      async decide() {
        return {
          kind: "complete",
          message: "定義がまとまりました。",
          result: completedResult,
        };
      },
    };
    const service = new Phase1Service(repository, agent, sessionTitleAgent, {
      staleProcessingTimeoutMs: 0,
    });
    const session = repository.createSession({
      title: "営業行動の整理",
      topic: "営業行動を整理したい",
    });
    repository.setPhase1Processing(session.id, true);

    service.submitReply(session.id, "現場負荷は増やしたくありません。");
    await Bun.sleep(0);

    const latest = service.getSession(session.id);
    expect(latest?.phase1.status).toBe("completed");
    expect(latest?.phase1.isProcessing).toBe(false);
  });

  test("エージェント失敗時に isProcessing を解除する", async () => {
    const repository = new WorkflowSessionRepository(":memory:");
    const agent: RequirementAgent = {
      async decide() {
        throw new Error("LLM request timed out.");
      },
    };
    const service = new Phase1Service(repository, agent, sessionTitleAgent);

    const session = await service.createSession("営業行動を整理したい");
    await Bun.sleep(0);

    const latest = service.getSession(session.id);
    expect(latest?.phase1.status).toBe("failed");
    expect(latest?.phase1.errorMessage).toBe("LLM request timed out.");
    expect(latest?.phase1.isProcessing).toBe(false);
  });

  test("Phase1 完了後でも Phase2 開始前なら同じセッションで方向修正できる", async () => {
    let callCount = 0;
    const repository = new WorkflowSessionRepository(":memory:");
    const agent: RequirementAgent = {
      async decide(input) {
        callCount += 1;
        if (callCount === 1) {
          return {
            kind: "complete",
            message: "最初の定義がまとまりました。",
            result: completedResult,
          };
        }

        expect(input.userReplyCount).toBe(1);
        expect(input.messages.at(-1)?.content).toBe(
          "経営指標の整理を優先したいです。",
        );
        return {
          kind: "complete",
          message: "方向修正を反映しました。",
          result: completedResult,
        };
      },
    };
    const service = new Phase1Service(repository, agent, sessionTitleAgent);

    const session = await service.createSession("営業行動を整理したい");
    await Bun.sleep(0);

    service.submitReply(session.id, "経営指標の整理を優先したいです。");
    await Bun.sleep(0);

    const latest = service.getSession(session.id);
    expect(latest?.phase1.status).toBe("completed");
    expect(latest?.phase1.userReplyCount).toBe(1);
    expect(latest?.phase2.status).toBe("idle");
    expect(
      latest?.phase1.messages.some(
        (message) => message.content === "方向修正を反映しました。",
      ),
    ).toBe(true);
  });

  test("既存チャット履歴を引き継いだ新セッションを作成できる", async () => {
    const repository = new WorkflowSessionRepository(":memory:");
    const agent: RequirementAgent = {
      async decide() {
        return {
          kind: "complete",
          message: "定義がまとまりました。",
          result: completedResult,
        };
      },
    };
    const service = new Phase1Service(repository, agent, sessionTitleAgent);

    const session = await service.createSession("営業行動を整理したい");
    await Bun.sleep(0);

    const nextSession = await service.createSessionFromExistingChat(
      session.id,
      "現場運用より経営判断を優先したいです。",
    );
    await Bun.sleep(0);

    const latest = service.getSession(nextSession.id);
    expect(latest?.title).toBe("経営判断を優先する営業設計");
    expect(latest?.topic).toBe("営業行動を整理したい");
    expect(
      latest?.phase1.messages.some(
        (message) => message.content === "定義がまとまりました。",
      ),
    ).toBe(true);
    expect(
      latest?.phase1.messages.some(
        (message) =>
          message.content === "現場運用より経営判断を優先したいです。",
      ),
    ).toBe(true);
    expect(latest?.phase2.messages).toEqual([]);
    expect(latest?.phase1.userReplyCount).toBe(1);
  });

  test("タイトル生成に失敗した場合はセッションを作成しない", async () => {
    const repository = new WorkflowSessionRepository(":memory:");
    const agent: RequirementAgent = {
      async decide() {
        return {
          kind: "complete",
          message: "定義がまとまりました。",
          result: completedResult,
        };
      },
    };
    const failingTitleAgent: SessionTitleAgent = {
      async generateTitle() {
        throw new Error("upstream failed");
      },
    };
    const service = new Phase1Service(repository, agent, failingTitleAgent);

    await expect(service.createSession("営業行動を整理したい")).rejects.toThrow(
      "failed to generate session title.",
    );
    expect(repository.listSessions()).toHaveLength(0);
  });
});
