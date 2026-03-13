# Phase 3 最小構築仕様: 収束＆レポート出力

## Summary

Phase 3 では **The Report 相当の別画面** を追加し、Phase 2 完了済みセッションから自動遷移して、**議事録役が生成した Markdown レポート** を表示できるようにする。

更新通知は既存方針に合わせて `fetch + SSE` を使うが、Phase 3 ではトークン単位ストリーミングは入れず、**レポート完成時に一括配信**する。保存形式は Markdown のみとし、SQLite に保持して再訪・再読込で復元できるようにする。

## 実装方針

- 画面は `/report/:sessionId` の別ページとして追加する。
  - Phase 2 が `completed` になったら Arena から自動遷移する
  - Report 画面は初期表示時に `phase3/state` を取得し、`idle` のときだけ `phase3/start` を呼ぶ
  - `running/completed/failed` は復元のみ行い、再生成はしない
- Phase 3 の開始条件は `phase2.status === completed` に固定する。
  - `phase2.completionReason` が `resolved` と `circuit_breaker` の両方で開始可能
  - `phase2.status === failed` では開始不可
- 議事録役は OpenAI 互換 API を使い、出力は Markdown 固定とする。
  - 必須セクション:
    - `# 決定事項`
    - `# 対立意見`
    - `# 残課題`
  - サーバー側では Markdown の完全解析までは行わず、必須見出しの存在を検証する
- LLM 入力には以下を渡す。
  - Phase 1 の要件定義結果
  - 論点一覧
  - ロール一覧
  - Phase 2 の全発言履歴
  - Judge 判定履歴
  - 論点ごとの最終状態
  - Phase 2 の完了理由
- `circuit_breaker` 終了時は、`forced_stop` / 未解決論点が `残課題` に必ず含まれるようプロンプトで制約する
- Phase 3 も Phase 2 と同じ失敗運用にする。
  - LLM 呼び出しは最大 `3` 回自動再試行
  - 失敗後は `failed` に遷移
  - `POST /api/sessions/:sessionId/phase3/retry` で手動再試行できる
  - 再試行は同じ入力からレポート生成をやり直し、Phase 2 の状態は変更しない
- Phase 3 の source of truth は保存済み Markdown とし、再訪時に毎回再生成しない
- Phase 3 でも SSE イベント ID により重複描画を防ぐ

## 重要な変更 / API・型

- `WorkflowSession` に `phase3` を追加する。
  - `status: idle | running | completed | failed`
  - `reportMarkdown: string | null`
  - `completionReason: generated | failed | null`
  - `isProcessing: boolean`
  - `errorMessage: string | null`
- Phase 3 用の主要型を追加する。
  - `Phase3State`
  - `Phase3SseEvent`
  - `ReportAgent`
- SQLite repository を拡張する。
  - `sessions` に Phase 3 状態を保存する
  - SSE 再送用イベント履歴に Phase 3 イベントを保存する
- Phase 3 用 API を追加する。
  - `GET /report/:sessionId`
    - Report 画面を返す
  - `GET /api/sessions/:sessionId/phase3/state`
    - 現在状態と保存済み Markdown を返す
  - `POST /api/sessions/:sessionId/phase3/start`
    - Phase 3 を開始する
  - `POST /api/sessions/:sessionId/phase3/retry`
    - `failed` 状態の Phase 3 を再試行する
  - `GET /api/sessions/:sessionId/phase3/events`
    - SSE 配信を返す
- SSE イベントは以下に固定する。
  - `phase3_started`
  - `phase3_completed`
  - `error`

## UI / 振る舞い

- Arena
  - `phase2_completed` を受けたら `/report/:sessionId` に自動遷移する
  - `phase2.failed` の場合は Report へ進めず、既存の再試行導線を維持する
- Report
  - 初期状態では `レポートを生成しています` を表示する
  - `completed` になったら Markdown を描画する
  - `failed` になったらエラーバナーと `再試行` ボタンを表示する
  - 再訪時は保存済みレポートをそのまま表示する
  - Phase 2 の要約メタ情報として、テーマ・完了理由・未解決論点の有無をレポート上部に表示する
- レポート表示
  - Markdown を HTML として安全に描画する
  - 最小版では GitHub 風の過剰な装飾は入れず、読みやすさを優先する
  - `決定事項`、`対立意見`、`残課題` の各セクションが視認しやすいレイアウトにする

## テスト計画

- ユニットテスト
  - 議事録役の Markdown 見出し検証
  - 不正な Markdown を失敗扱いにできる
  - `phase2.completed` 以外では `phase3/start` を拒否する
  - 3 回自動再試行後に `phase3.failed` へ遷移する
  - `phase3/retry` で再生成できる
- API / SSE テスト
  - `phase3/start` で生成が始まり、`phase3_completed` を返せる
  - `phase3/events` で履歴再送と新規完了イベントを受け取れる
  - 再訪時に保存済み Markdown が返り、再生成しない
  - `phase3.failed` 時に `error` イベントを返せる
- UI 確認観点
  - Arena 完了後に自動で Report へ遷移する
  - Report 画面で生成中・完了・失敗が正しく見える
  - 保存済みレポートを再読込後も同じ内容で表示できる
  - `circuit_breaker` 終了セッションで `残課題` が表示される

## Assumptions

- Phase 3 の保存形式は Markdown のみとし、JSON との二重保持はしない
- レポート生成は Report 画面ロード時に開始し、Phase 2 完了直後にサーバーが即時生成開始はしない
- レポートのバージョン管理や履歴保持は入れず、常に最新 1 件だけを保持する
- レポートの手動編集機能は入れない
- 長文コンテキスト圧縮はまだ入れず、Phase 2 の全文履歴をそのまま入力に使う
