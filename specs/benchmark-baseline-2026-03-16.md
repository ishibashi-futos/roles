# CLIベースライン作成メモ 2026-03-16

## 目的

現状のベースラインを60点とみなし、`qwen2.5-coder-7b-instruct-mlx` を使った CLI Mode の実シナリオ評価を再実行し、推論強化のためのシステムプロンプト / ワークフロー調整プランを定義する。

今回は `src/` 以下は編集せず、現状把握と改善計画の策定に限定する。

## 評価条件

- 実行日: 2026-03-16
- 実行モード: CLI Mode
- 実行順序: 逐次実行のみ
- 出力言語: `ROLES_OUTPUT_LANGUAGE='en'`
- LLM 接続先:
  - `OPENAI_BASE_URL="http://localhost:1234/v1"`
  - `OPENAI_API_KEY="lmstudio"`
  - `OPENAI_MODEL="qwen2.5-coder-7b-instruct-mlx"`

## ベースライン評価観点

各シナリオを、以下の観点で観測する。

1. Phase1 初回応答率
2. Phase1 の質問品質
3. Phase1 の構造化完了率
4. 強制完了指示への追従率
5. Phase2 へ到達できる率
6. 余計な深掘りを抑えつつ論点を作れる率

## 実行シナリオ

### Scenario A: Sales behavior digitization

```text
We want to capture top-performing enterprise sales behaviors and make them reusable for junior reps. Objective: improve opportunity creation rate by 20% within 6 months. Constraints: no extra CRM typing and Salesforce remains the system of record. Include perspectives from sales director, frontline manager, top seller, IT admin, and revops.
```

- sessionId: `172d5e81-56de-42d5-83b7-3428fb2ad9af`
- 観測:
  - `start --wait` 実行後、初回の追加質問も完了通知も返らなかった
  - `show` では `Phase1: collecting_requirements` のまま
  - 一定の情報量を超えると初回応答自体が不安定

### Scenario B: Estimation process redesign

```text
We need a better estimation process for a 50-person software consultancy. Goal: cut gross-margin variance by half in 3 months. Constraint: do not add more timesheet work. Include viewpoints from head of sales, project manager, engineering lead, and CFO.
```

- sessionId: `84a89a48-5cda-4f9a-ac56-5c73a8e8fdfc`
- 観測:
  - 初回追加質問は返る
  - 3回の追加回答後も `kind="complete"` にならず、4つ目の質問が継続した
  - `userReplyCount: 3` の時点でも `collecting_requirements` のまま
  - `This is the final confirmation. Do not ask follow-up questions and always return kind="complete".` という指示に従えていない

### Scenario C: SIer sales digitization

```text
Digitize SIer top sales habits with zero manual CRM input. Need a strategy to overcome resistance from old-school middle managers.
```

- sessionId: `6b560145-daab-4c75-bee2-f2f27969965d`
- 観測:
  - 初回追加質問は返る
  - 1回回答後、次の応答が返らず `collecting_requirements` のまま停止
  - 短いテーマでは初回質問は出しやすいが、2ターン目の安定性が弱い

## 現状ベースライン判定

60点の内訳を、暫定的に以下とする。

- 20点: 初回質問の生成は一部成功する
- 15点: 要件から論点や役割を作る設計意図はある
- 10点: Structured Output の枠組みは実装済み
- 15点: ただし実運用では Phase1 の停止、過剰質問、強制完了不履行が目立つ

現状の実務評価は次の通り。

- 良い点:
  - 役割候補に上位職を含める方針はプロンプトに明示されている
  - JSON schema により最低限の出力制約はある
- 弱い点:
  - 完了判定の閾値が曖昧で、十分な情報があっても質問を続ける
  - 「最後の確認なので complete を返す」という明示指示への従属が弱い
  - ユーザー入力を丸ごと JSON 化して渡しているだけで、思考手順が粗い
  - 議論価値の高い論点抽出より、穴埋め質問に寄りやすい

## 調整方針

優先順位は、推論の高度化より先に、完了制御の安定化を置く。

### 優先度1: Phase1 の完了制御を強化する

- `ask` と `complete` の判断基準を明文化する
- 「不足情報があっても議論開始に十分なら complete」を今より強く指示する
- `userReplyCount >= maxUserReplyCount` のときは、追加質問禁止をより強いルールで重ねる
- `ask` を返してよい条件を列挙し、列挙に当てはまらない限り `complete` を返す構造にする

想定するプロンプト変更例:

```text
You must prefer kind="complete" once the topic, objective, major constraints, and candidate stakeholders are sufficiently clear.
You are not allowed to ask for nice-to-have details.
If userReplyCount >= maxUserReplyCount, asking another question is invalid.
When forcedCompletionInstruction is present, missing minor details must be converted into explicit assumptions.
```

### 優先度2: 要件定義役に思考手順を与える

現状は「曖昧要求を JSON にする」だけで、内部の分解手順がほぼない。次の順で考えさせるべき。

1. テーマの対象業務を特定する
2. 成果指標を抽出する
3. 制約を抽出する
4. 議論に必須な利害関係者を決める
5. 論点を 2-4 個に絞る
6. 不足情報が本当に致命的かを判定する
7. 致命的でなければ assumptions に吸収して complete する

重要なのは、Chain-of-Thought を出力させることではなく、プロンプト内で思考順序を制約すること。

### 優先度3: 追加質問を「1問1論点」に制限する

現在の質問は複数論点を同時に聞きがちで、回答後も別表現で似た質問を続けやすい。改善案は次の通り。

- 1回の `ask` で質問してよい主要論点は1つまで
- 複数論点が不足していても、最もクリティカルな1つだけ聞く
- 同じ意味の質問を繰り返さない
- 既に得た回答は assumptions へ畳み込む

### 優先度4: `complete` 時の品質要件を上げる

今のプロンプトは項目必須だけで、論点の深さをあまり保証していない。以下を追加する。

- `discussionPoints` は「意思決定を分ける論点」であることを明示する
- `roles` は単なる部署網羅でなく、意見が衝突しうる視点差を持たせる
- `systemPromptSeed` は立場の主張軸を1文で明確化する
- `assumptions` に、未確定だが議論開始のために置いた仮定を必ず含める

### 優先度5: Phase2/3 を評価できる標準シナリオを別途固定する

現時点では Phase1 の完了率が低く、Phase2 の推論品質比較に進みにくい。したがってベンチマークを2階建てに分ける。

- ベンチマークA: Phase1 安定性評価
- ベンチマークB: 事前に固定した requirement / discussionPoints / roles を使う Phase2 評価

これにより、Phase1 の不安定さに引きずられず、ファシリテーター / 役割エージェント / Judge の改善を個別評価できる。

## 推奨ワークフロー変更

### 変更案1: Phase1 を 2 段階化する

1回のモデル呼び出しで `ask/complete + 高品質JSON` を同時にやらせるのではなく、論理的には次の2段階に分ける。

1. `intake pass`
   - テーマから `objective / constraints / stakeholders / open_gaps` を抽出する
2. `decision pass`
   - `open_gaps` が致命的かを判定し、`ask` か `complete` を決める

同一 API 呼び出しのままでも、プロンプトの中でこの2段階手順を明示するだけで改善余地がある。

### 変更案2: 強制完了時のフォーマットを簡略化する

強制完了時まで通常と同じ粒度の JSON を求めると、小型モデルほど崩れやすい。強制完了時は次を許容するとよい。

- `discussionPoints`: 2件固定
- `roles`: 3-4件を優先
- `assumptions` に不足情報を集約

### 変更案3: CLI ベンチマークの判定基準を固定する

各シナリオで次を記録する。

- 初回応答までの成否
- 追加質問回数
- `complete` 到達可否
- `userReplyCount=max` 以降も質問継続したか
- Phase2 開始可否
- Judge が論点単位で判定できているか

## 次回ベンチマーク実施案

次回は次の順で実施する。

1. 要件定義役のシステムプロンプトだけを調整する
2. 評価シナリオ3本を同一条件で再実行する
3. Phase1 完了率が上がったかを比較する
4. その後にファシリテーター / Judge の推論品質を個別評価する

## 再検証 2026-03-16

前回の仮説が妥当かを確認するため、別シナリオを2本追加で試行した。

### Scenario D: Enterprise onboarding redesign

```text
We need to redesign enterprise customer onboarding for a B2B SaaS product. Goal: reduce time-to-first-value from 45 days to 21 days within two quarters. Constraint: no new headcount and no extra mandatory data entry for customer-facing teams. Include viewpoints from VP of Customer Success, implementation manager, solutions architect, product manager, and finance.
```

- sessionId: `3b5ebf96-2a9a-401f-bf99-70807ec89b74`
- 観測:
  - `start --wait` 後、初回応答なし
  - `show` では `messages: 1`, `userReplyCount: 0`, `collecting_requirements`
  - 情報量が少し増えると「質問すら返らない」現象が再発した

### Scenario E: Hiring quality improvement

```text
Improve hiring quality for a 120-person startup without slowing down hiring speed. Include viewpoints from CEO, hiring manager, recruiter, engineering lead, and HR.
```

- sessionId: `fa37a809-e8fb-41c1-b066-aec32b6e17d2`
- 観測:
  - 初回質問は返った
  - 2回目の回答までは受理された
  - その後 `reply --wait` と `show` の整合が悪く、`session_processing` が残存した
  - 状態は `collecting_requirements` のまま止まり、3回目の回答を投入できなかった

### 再検証結果

追加2シナリオでも、前回の仮説は概ね支持された。

1. 情報量がある初回入力では、初回応答自体が不安定
2. 短い初回入力では質問は返るが、Phase1 完了までの到達が安定しない
3. 推論不足だけでなく、CLI/Phase1 の処理状態管理も不安定で、評価を難しくしている

したがって、前回の結論は維持する。

- 主因は「要件定義役の完了ルールの弱さ」と「処理フローの不安定さ」の組み合わせである
- 特に `ask` の継続条件と `session_processing` の扱いは、推論品質評価の前提条件として先に安定化が必要

## 結論

今回の観測では、本質的な課題は以下の3点にある。

1. `ask` を続けすぎる完了判定
2. 強制完了指示への追従不足
3. Phase1 で要求している推論手順の粗さ

したがって、次の改善対象は「要件定義役の完了ルールと推論手順の再設計」である。
