# roles

## セットアップ

```bash
bun install
```

## 実行方法

### Webモード

```bash
roles serve
```

開発時は次でも起動できます。

```bash
bun run dev
```

### CLIモード

```bash
roles cli start --topic "営業行動を整理したい" --wait
roles cli reply --session <sessionId> --message "営業本部向けです" --wait
roles cli start-discussion --session <sessionId> --wait
roles cli report --session <sessionId> --wait
```

## CLI コマンド

```bash
roles cli start --topic "<topic>" [--wait]
roles cli reply --session <sessionId> --message "<message>" [--wait]
roles cli list
roles cli show --session <sessionId>
roles cli start-discussion --session <sessionId> [--wait]
roles cli retry-discussion --session <sessionId> [--wait]
roles cli report --session <sessionId> [--wait]
roles cli retry-report --session <sessionId> [--wait]
```

`--wait` の挙動は次の通りです。

- `start --wait`: 要件定義役の追加質問または要件定義完了まで待機します。
- `reply --wait`: 次の追加質問または要件定義完了まで待機します。
- `start-discussion --wait`: 議論完了または失敗まで待機し、新規発話を表示します。
- `retry-discussion --wait`: 議論再試行の完了または失敗まで待機します。
- `report --wait`: レポート生成完了まで待機し、保存済みMarkdownを表示します。
- `retry-report --wait`: レポート再試行の完了または失敗まで待機します。

## 永続化

- セッションは既定で `./.data/roles.sqlite` に保存されます。
- WebモードとCLIモードは同じDBを共有します。

## 検証

```bash
bun sanity
```
