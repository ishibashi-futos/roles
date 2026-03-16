## 技術仕様

- runtime: bun
- testing: `bun test`
- framework:
  - server: Hono
  - front-end: hono/jsx + Tailwind CSS
  - Client to Server: fetch(REST API)
  - Server to Client: SSE(hono Server-Send Event)

## Rules

- 日本語で応答する
- ドキュメント作成は日本語で行う
- コメントは日本語でつける
- コードは常にメンテナンス製とテスト容易性を最も重要視する
- タスクは常に逐次実行する。並列化は行わない
- 時間の節約・開発スループットよりも、確実とトレーサビリティを優先する
- 後方互換性や例外処理のために処理を複雑にせず、シンプルで唯一の正解のために `DRY` な実装を行う
- Roles コード内部で扱うシステムプロンプトには、常に英語を使用する。出力言語は、`ROLES_OUTPUT_LANGUAGE` で指定可能。
- UIの言語には、日本語を使用する
- サーバーサイドで扱うエラーメッセージには英語を用いる

## 重要な設計ドキュメント

@specs/README.md

## Definition of Done(DoD)

- `bun sanity` による、 format, typecheck, test の完了

## CLI Mode補助スクリプト

Agent から CLI Mode を実行するときは、原則として `scripts/roles-cli-agent.sh` を使う。

- 既定でローカルのLM Studioを利用する環境変数を注入される
- 入力言語は英語で行う
- 実行は必ず逐次で行い、CLI Mode を並列起動しない
- リポジトリのルートで実行される

使用例:

```bash
scripts/roles-cli-agent.sh start --topic "Improve hiring quality" --wait
scripts/roles-cli-agent.sh reply --session <sessionId> --message "More context" --wait
scripts/roles-cli-agent.sh start-discussion --session <sessionId> --wait
scripts/roles-cli-agent.sh report --session <sessionId> --wait
scripts/roles-cli-agent.sh list
scripts/roles-cli-agent.sh show --session <sessionId>
```

環境変数を一時的に上書きしたい場合:

```bash
OPENAI_MODEL=other-model scripts/roles-cli-agent.sh start --topic "..."
```
