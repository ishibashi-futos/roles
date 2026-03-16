import "../../test/silence-runtime";
import { describe, expect, test } from "bun:test";
import { WorkflowSessionRepository } from "../../shared/workflow-session-repository";
import type { RequirementAgent } from "./requirement-agent";
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
    },
    {
      id: "point-2",
      title: "定着方法",
      description: "入力負荷を抑えながら運用する方法",
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
    const service = new Phase1Service(repository, agent, {
      staleProcessingTimeoutMs: 0,
    });
    const session = repository.createSession("営業行動を整理したい");
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
    const service = new Phase1Service(repository, agent);

    const session = service.createSession("営業行動を整理したい");
    await Bun.sleep(0);

    const latest = service.getSession(session.id);
    expect(latest?.phase1.status).toBe("failed");
    expect(latest?.phase1.errorMessage).toBe("LLM request timed out.");
    expect(latest?.phase1.isProcessing).toBe(false);
  });
});
