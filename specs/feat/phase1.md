# Phase 1 最小構築仕様: 要件定義からロール定義まで

## Summary

Phase 1 では **The Lobby 相当の 1 画面** を提供し、ユーザーが入力したテーマを起点に、要件定義役との対話を通じて **要件・論点・ロール定義** を構造化する。

UI は Hono JSX で構成し、クライアントからサーバーへの送信は `fetch`、サーバーからクライアントへの更新通知は **SSE** を使う。要件定義役は OpenAI 互換 API を利用し、応答は JSON Schema で制約した構造化出力として扱う。

## 実装方針

- 画面は `/` の 1 ページに集約する。
  - テーマ入力と追加回答を兼ねる単一フォーム
  - 対話ログ
  - 要件定義の結果表示
- 対話はセッション単位で管理し、状態はプロセス内メモリに保持する。
  - `collecting_requirements`
  - `completed`
  - `failed`
- 要件定義役は次の 2 種類の意思決定だけを返す。
  - `ask`
  - `complete`
- 要件定義役の対話言語は `ROLES_OUTPUT_LANGUAGE` で切り替える。
  - `ja` または `en`
  - 未設定時の既定値は `ja`
  - システムプロンプト内部では常に英語を使い、出力言語だけを切り替える
- 要件定義役の構造化出力は `json_schema` を使って取得し、サーバー側でも再検証する。
- `complete` が返っても内容が未完成なら失敗にはせず、`ask` にフォールバックして対話継続する。
- 無限対話防止のため、ユーザー回答回数の上限を持つ。
  - 既定値: `3`
- セッションや結果の永続化は入れない。
- SSE はメッセージ単位で配信し、イベント ID によりクライアント側で重複描画を防ぐ。

## 重要な変更 / API・型

- Phase 1 の主要型を持つ。
  - `RequirementDefinition`
  - `DiscussionPoint`
  - `RoleDefinition`
  - `Phase1Result`
  - `RequirementSession`
  - `Phase1SseEvent`
- セッション状態には以下を含む。
  - `id`
  - `topic`
  - `status`
  - `messages`
  - `result`
  - `userReplyCount`
  - `isProcessing`
  - `errorMessage`
- Phase 1 用 API を提供する。
  - `GET /`
    - Lobby 画面を返す
  - `POST /api/phase1/sessions`
    - 入力: `{ topic: string }`
    - 出力: `{ sessionId: string }`
  - `POST /api/phase1/sessions/:sessionId/messages`
    - 入力: `{ message: string }`
    - 出力: `202 Accepted`
  - `GET /api/phase1/sessions/:sessionId/events`
    - SSE 配信を返す
- SSE イベントは以下に固定する。
  - `session_created`
  - `assistant_delta`
  - `assistant_done`
  - `requirements_completed`
  - `error`
- LLM 接続には以下の環境変数を使う。
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `ROLES_OUTPUT_LANGUAGE`

## UI / 振る舞い

- Lobby
  - 初期状態では `テーマ` 入力フォームを表示する
  - 初回送信後は同じ入力欄を `追加回答` モードへ切り替える
  - 完了後は入力欄を無効化する
- 対話ログ
  - 新着メッセージを上に積む
  - ユーザーと要件定義役の発話を視覚的に区別する
- 結果表示
  - `Requirement Definition`
  - `Discussion Points`
  - `Roles`
  を右カラムに表示する
- 状態文言は、送信完了だけでなく裏で何をしているかがわかる表現にする
  - 例: `要件定義役が回答内容を読み込み、要件と不足情報を整理しています。`
- LLM エラーや JSON 解釈失敗時は UI にエラーメッセージを表示し、サーバー標準出力・標準エラーにもログを出す

## テスト計画

- ユニットテスト
  - 要件定義役の `complete` JSON を解釈できる
  - 不正 JSON を拒否できる
- API / SSE テスト
  - テーマ送信でセッションを作成できる
  - 追加回答で `requirements_completed` まで到達できる
  - 要件定義役失敗時に `error` イベントを返せる
- UI 確認観点
  - テーマ送信後に同じフォームが追加回答入力として使える
  - 新着ログが上に表示される
  - 完了時に要件・論点・ロール定義が表示される
  - 再接続や履歴再送があっても同じ応答が重複表示されない

## Assumptions

- LLM は OpenAI 互換 API だが、`response_format.type = "json_object"` は前提にせず、`json_schema` を利用する。
- Phase 1 は Lobby のみを対象とし、Arena や Report への遷移はまだ持たない。
- サーバー再起動やブラウザ再読込後の復元は考慮しない。
- 参加ロール数は 3〜5 件、論点は 2 件以上を前提にする。
