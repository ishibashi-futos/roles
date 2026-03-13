# Phase 2 最小構築プラン: Arena と仮想会議ループ

## Summary

現状の Phase 1 を土台に、次は **Phase 1 完了済みセッションから手動で Arena に遷移し、ファシリテーター→ロール→Judge のループを回せる最小版** を作る。

UI は Lobby と分離した **別画面の Arena** とし、更新は **メッセージ単位の SSE** で配信する。Phase 3 はまだ作らず、Phase 2 の完了時点では Arena 上で「議論完了」と open item の有無だけを表示する。

## 実装方針

- セッション管理を Phase 1 専用からアプリ全体の `WorkflowSession` に引き上げる。
  - `phase1`: 既存の要件・論点・ロール定義
  - `phase2`: 議論状態、進行中論点、発言履歴、Judge 判定履歴
- Phase 2 は **論点を順番に 1 件ずつ処理**する。
  - 1 論点ごとに `ファシリテーター -> 指名ロール -> Judge`
  - `Judge.isResolved === true` なら次の論点へ進む
  - 全論点完了、または Circuit Breaker 到達で Phase 2 を終了する
- ファシリテーターと Judge は JSON 出力、ロール発言はテキスト出力にする。
  - `FacilitatorDecision`: `discussionPointId`, `targetRoleId`, `message`
  - `JudgeDecision`: `isResolved`, `reason`
- Arena は `/arena/:sessionId` の別画面にし、Phase 1 完了後の Lobby に `議論を開始` ボタンを出す。
- 議論開始は手動にする。
  - Lobby で結果確認
  - `議論を開始` 押下
  - Arena に遷移後、即座に Phase 2 のオーケストレーション開始
- LLM ストリーミングは入れず、1 発言が確定したタイミングで SSE 配信する。
- Circuit Breaker は Phase 2 最小版で必須とする。
  - `maxTurnsPerPoint = 6`
  - `maxTotalTurns = 15`
  - 到達時は未解決論点を `forced_stop` として終了する
- メモリ圧縮はまだ入れない。
  - 最小版では全文履歴を保持
  - 圧縮は Phase 2.5 以降の改善対象とする

## 重要な変更 / API・型

- 共有セッション型を追加する。
  - `WorkflowSession`
  - `Phase2State`
    - `status: idle | running | completed | failed`
    - `currentDiscussionPointIndex`
    - `turnCount`
    - `messages: ArenaMessage[]`
    - `pointStatuses: pending | resolved | forced_stop`
    - `completionReason: resolved | circuit_breaker | failed`
  - `ArenaMessage`
    - `id`
    - `speakerType: facilitator | role | judge`
    - `speakerId`
    - `speakerName`
    - `discussionPointId`
    - `content`
    - `turnNumber`
- Phase 2 用 API を追加する。
  - `GET /arena/:sessionId`
    - Arena 画面を返す
  - `POST /api/sessions/:sessionId/phase2/start`
    - Phase 1 完了済みセッションに対して議論開始
  - `GET /api/sessions/:sessionId/phase2/events`
    - SSE で Arena 更新を配信
  - `GET /api/sessions/:sessionId/phase2/state`
    - 画面初期化や再接続用に現在状態を返す
- SSE イベントは以下に固定する。
  - `phase2_started`
  - `arena_message`
  - `judge_result`
  - `phase2_completed`
  - `error`
- Phase 2 のエージェント構成を追加する。
  - `FacilitatorAgent`
  - `RoleAgent`
  - `JudgeAgent`
- 現在の Phase 1 ストアは、Phase 2 から参照できる共有ストアに置き換える。
  - `createPhase1App()` の中に閉じている状態は解消する
  - `src/app.ts` で 1 つのストアを組み立て、Phase 1 と Phase 2 のルートに注入する

## UI / 振る舞い

- Lobby
  - Phase 1 完了時に `議論を開始` ボタンを表示
  - ボタン押下で `/arena/:sessionId` に遷移
- Arena
  - メイン: 会話ログ
    - 発言順で下に積む
    - ファシリテーター、各ロール、Judge を視覚的に区別
  - サイド: ダッシュボード
    - 現在の論点
    - 論点ごとの進行状態
    - 現在のターン数
    - Judge の直近判定
  - 開始直後の状態文言を明示する
    - 例: `ファシリテーターが最初の論点と発言者を決めています`
  - 完了時は Arena 上に終了バナーを出す
    - `全論点の議論が完了しました`
    - または `最大ターン数に達したため未解決論点を残して終了しました`
  - Phase 3 未実装であることを明示する
    - `レポート生成は次フェーズで実装予定`

## テスト計画

- ユニットテスト
  - ファシリテーター決定 JSON の解析
  - Judge 判定 JSON の解析
  - 1 論点の進行
  - 論点完了時の次論点への遷移
  - `maxTurnsPerPoint` と `maxTotalTurns` の Circuit Breaker
  - ロール未発見や LLM エラー時の失敗状態遷移
- API / SSE テスト
  - Phase 1 未完了セッションでは `phase2/start` を拒否する
  - `phase2/start` で実行が始まる
  - `phase2/events` で履歴再送と新規イベントを受け取れる
  - 再接続時に同じ SSE を重複描画しない前提を維持する
  - 完了時に `phase2_completed` が送られる
- UI 確認観点
  - Lobby から `議論を開始` で Arena に遷移できる
  - Arena で発言とダッシュボードが同期して更新される
  - Judge 判定で論点が resolved に変わる
  - Circuit Breaker 終了時もユーザーに終了理由が見える

## Assumptions

- Phase 2 最小版では、Phase 1 が返した `discussionPoints` の順番をそのまま処理順に使う。
- 参加ロールは Phase 1 の `roles` をそのまま使い、Arena 開始前の編集 UI は入れない。
- Judge は各ロール発言のたびに 1 回呼ぶ。
- 発言本文は全文確定後に SSE 配信し、トークン単位の typing 表示は後回しにする。
- セッション永続化はまだ入れず、サーバープロセス生存中のメモリ保持を前提にする。
