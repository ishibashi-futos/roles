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
