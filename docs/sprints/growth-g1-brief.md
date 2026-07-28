# 成長G1 — 論争度シグナルを HotnessEvaluator に追加（賛否・対立を数値で拾う・AI不使用）

成長提案書(docs/growth-research.md 観点③)の第1歩。LoLプレイヤーが最も反応する「賛否が割れる・対立・炎上」スレを
**数値ルール**で検出し、記事化を優先＋タイトルを議論寄りにする。AIは使わない。対象: Web。

## 背景（なぜ・実データ確認済み）
`HotnessEvaluator` は現在「現在値/増加率」のみで、**賛否が割れる＝論争を測る指標が無い**。実データ（Arctic Shift, r/leagueoflegends）で:
- 全投稿が `upvote_ratio`(0〜1) を返す（確認済み）。議論スレ（「I hate bel'veth's kit」c/s比0.48・ratio0.83／「Taliyah Botlane最適論」
  c/s比0.38・ratio0.85）は、consensus人気（画像系 c/s比0.06・ratio0.98）と数値で区別できる。
- Redditは投稿のdownを隠すため厳密な controversy 式は不可 → 代理指標「**コメント数/スコア比**」＋「**upvote_ratio**」を使う。
- 5chは score が常時0なので comment 比＝そのまま注目・議論の指標。

## 含まれる機能

### F-G1-1: 論争度の設定（hotness/config.ts）
- `getHotnessConfig` に追加（env上書き可）:
  - `minControversyRatio`（既定 0.15。`commentCount/max(score,1)` がこれ以上で論争サイン。平常0.05〜0.10）
  - `maxUpvoteRatio`（既定 0.80。`upvote_ratio` がこれ以下で賛否が割れている。1.0に近いほど平和）
- 5ch は score=0 のため comment 比が発散しがち → 5ch用は既存の comment 主体判定を尊重し、論争は「comment 比」を使わず
  既存の comment 現在値/増加率で足りる（＝論争ルールは主に reddit/x 向け。config はソース別に持てる形を維持）。

### F-G1-2: 論争度の判定（hotness/evaluator.ts・純関数）
- `HotnessInput` に `upvoteRatio?: number` を追加。
- `HotnessResult` に `controversyScore: number`（＝`comments/max(score,1)`）と `isControversial: boolean` を追加。
- 判定: `isControversial = (controversyScore >= minControversyRatio) || (upvoteRatio != null && upvoteRatio <= maxUpvoteRatio)`。
  `isHot` の算出は従来どおり（論争は独立フラグ）。reasons に論争根拠を追記。

### F-G1-3: upvote_ratio の収集・保存（reddit adapter / Post）
- `RawCollectionItem` に `upvoteRatio?: number` を追加。`reddit.ts` が Arctic Shift の `upvote_ratio` を設定。
- `prisma/schema.prisma` の `Post` に `upvoteRatio Float?`（nullable）を追加＋マイグレーション（S1同様の非破壊 ADD COLUMN）。
  `persist-posts` が `item.upvoteRatio` を `Post.upvoteRatio` に保存。`collect-source.ts toCollectionItems` も転記（S7cの教訓＝転記漏れに注意）。

### F-G1-4: 論争スレを記事化で優先＋タイトルを議論寄りに
- `post-pipeline.ts`：`evaluateHotness` 呼び出しに `upvoteRatio: post.upvoteRatio ?? undefined` を渡す。カテゴリ別上限内の
  ランキングで、**`isControversial` なPostをhotnessStrength同点時に優先**（決定論。論争スレが選ばれやすくする）。
- タイトル: 反応記事(5ch/reddit)の `generateHookTitleLLM` に `isControversial` を渡し、system/hintに
  「この話題は賛否が割れているので【議論】【賛否両論】等の対立が伝わるタイトルが適切」を1文足す（LLM呼び出し回数は不変）。
  ルールベース `generateHookTitle` フォールバックも `isControversial` 時に LABELS=`議論`・HOOKS=`で大荒れ/を巡り議論に/に賛否両論`
  を優先（既存語彙を使う）。

## 制約・非目標
- 論争キーワード辞書/flair加点・相対分位(P90/P95)閾値・カレンダートリガは後続（G1では comment比＋upvote_ratio の核＋優先＋タイトル）。
- AIは使わない（判定は純ルール）。翻訳/SEO/moderation/collectionのそれ以外・5chの既存判定は不変。新規依存なし。DBは Post.upvoteRatio の非破壊追加のみ。
- `isControversial` は `isHot` を置き換えない（独立フラグ。hotなPostのうちcontroversialなものをタイトルとランキングでLoL好みに寄せる）。

## テスト（必須・専用テストDB/スタブ・実ネット非依存）
1. `evaluateHotness`: comments/score比が閾値超 or upvote_ratio が閾値以下で `isControversial=true`・`controversyScore` 正しい。両条件の分岐・upvoteRatio未指定時。
2. `getHotnessConfig`: `minControversyRatio`(0.15)/`maxUpvoteRatio`(0.80) 既定＋env上書き。
3. reddit adapter/persist-posts/toCollectionItems: `upvote_ratio`→`item.upvoteRatio`→`Post.upvoteRatio` 保存（転記漏れなし）。マイグレーション非破壊。
4. post-pipeline: `upvoteRatio` が evaluateHotness に渡る。同hotnessStrengthで isControversial が優先される。
5. title: isControversial 時にルールベースが 議論/賛否ラベルを選ぶ。LLM経路に hint が渡る（呼び出し回数不変）。
6. 既存の hotness/collection/生成/パイプラインテストが回帰しない。

## 受け入れ基準
1. マイグレーション適用＋`npx vitest run` 全Green。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 賛否が割れるスレ（コメント/スコア比高 or upvote_ratio低）が `isControversial` として検出され、記事化で優先＋タイトルが議論寄りになる。
   AI不使用・純ルール・新規依存なし・既存挙動/データ不変（Post.upvoteRatio は非破壊追加）。

## 評価基準（evaluator向け）
- マイグレーション適用済み・テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- 論争度判定・upvote_ratio保存・優先・タイトル議論寄りがテストで確認できる。
- 受け入れ基準1〜3を満たす。
