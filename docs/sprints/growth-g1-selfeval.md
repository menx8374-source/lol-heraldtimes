---
tags: [sprint-selfeval]
sprint: growth-g1
---

# 成長G1 自己評価レポート

## 今回の修正点（品質ゲート指摘対応: 5ch論争判定の無効化）
- 指摘: `minControversyRatio=0.15`をソース非依存で全ソースに適用していたため、5ch（score常時0）は`controversyScore=comments/max(score,1)`が収集数（既定minComments=30）だけで0.15を大きく超え、**5ch反応記事が実質常時`isControversial=true`**になりタイトルが【議論】固定化・多様性を損なっていた（brief F-G1-1の「5chはcomment比を論争判定に使わない」逸脱）。
- 対応: `src/lib/hotness/config.ts`の`getHotnessConfig`の5ch分岐で`minControversyRatio`を`envFloat("HOTNESS_5CH_MIN_CONTROVERSY_RATIO", Number.POSITIVE_INFINITY)`に上書き。5chは`upvote_ratio`も持たないため、この変更だけで5chの`isControversial`は常に`false`になる（`evaluator.ts`のロジック自体は無変更、config値のみで制御）。env `HOTNESS_5CH_MIN_CONTROVERSY_RATIO`で明示的に有効化したい場合のみ上書き可能（既存のソース別上書きパターンを踏襲）。reddit/riot/汎用は既定0.15のまま不変。
- テスト追加: `hotness-config.test.ts`に5chがInfinityになること・env上書き・不正値フォールバックの3ケース、`hotness-evaluator.test.ts`に5ch(comments=30,score=0)で`isControversial=false`、reddit(comment比高/upvote_ratio低)で`isControversial=true`のままの3ケースを追加。既存テストの回帰なし（全1169件Green）。
- `.env.example`に`HOTNESS_5CH_MIN_CONTROVERSY_RATIO`のコメント付き説明を追記。

## 実装した内容（元のG1実装、変更なし）
- F-G1-1: `hotness/config.ts` に `minControversyRatio`(既定0.15)・`maxUpvoteRatio`(既定0.80)を追加。`envFloat`ヘルパーを新設し `HOTNESS_MIN_CONTROVERSY_RATIO`/`HOTNESS_MAX_UPVOTE_RATIO` でenv上書き可能（ソース非依存の共通設定として`base`に追加。将来ソース別に分けたくなった場合の拡張余地はコメントで明記）。
- F-G1-2: `hotness/evaluator.ts` の `HotnessInput` に `upvoteRatio?: number`、`HotnessResult` に `controversyScore`（=`comments/max(score,1)`）・`isControversial` を追加。`isControversial = (controversyScore>=minControversyRatio) || (upvoteRatio<=maxUpvoteRatio)`。年齢窓外の早期return分岐でも論争判定は独立に計算・reasonsへ追記（isHotとは独立のフラグ、isHotの算出ロジック自体は不変）。
- F-G1-3:
  - `collection/types.ts`: `RawCollectionItem`/`CollectionItem` に `upvoteRatio?: number` を追加。
  - `collection/adapters/reddit.ts`: `RedditPostData.upvote_ratio` を追加し `buildRedditItem` で転記。
  - `collection/collect-source.ts` の `toCollectionItems` にも `upvoteRatio` を転記（S7cの転記漏れ教訓を踏まえ明示的に対応）。
  - `prisma/schema.prisma` の `Post` に `upvoteRatio Float?`（nullable）を追加し、`npx prisma migrate dev` で非破壊マイグレーション（`ALTER TABLE "Post" ADD COLUMN "upvoteRatio" REAL;`）を作成・適用済み。
  - `collection/persist-posts.ts` の create/update 両方で `item.upvoteRatio ?? null` を保存。
- F-G1-4:
  - `generation/post-pipeline.ts`: `evaluateHotness` 呼び出しに `upvoteRatio: post.upvoteRatio ?? undefined` を渡す。`selectTopHotPosts` の戻り値を `{post, hotness}[]` に変更し、同一hotnessStrength時は `isControversial` を優先するタイブレークを追加（`postedAt`降順より優先、決定論）。`buildExemptHotnessResult`（riot/riot-news免除ソース）は `isControversial=false` 固定（公式情報は論争概念に馴染まないため）。
  - `generation/generate-article.ts`: `GenerationCandidate` に `isControversial?: boolean` を追加し、反応記事（5ch/reddit）の `generateHookTitleLLM` 呼び出しに渡す（riot/riot-newsは従来どおり事実タイトルをそのまま使うため未使用）。
  - `generation/title.ts`: `generateHookTitle(input, isControversial=false)` は `isControversial=true` のとき ラベルを【議論】固定・感情フックを「で大荒れ/を巡り議論に/に賛否両論」の中から選ぶ（既存語彙のみ使用、新規語彙なし）。`generateHookTitleLLM(llmClient, input, isControversial=false)` は `isControversial=true` のときsystemプロンプトへ「この話題は賛否が割れているので、【議論】【賛否両論】等の対立が伝わるタイトルが適切です。」を1文追記（LLM呼び出し回数は不変・1回のまま）。フォールバック時も `isControversial` を引き継ぐ。
- `.env.example` に `HOTNESS_MIN_CONTROVERSY_RATIO`/`HOTNESS_MAX_UPVOTE_RATIO` のコメント付き既定値を追記。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の envInt パターンを踏襲した `envFloat` ヘルパーを追加しただけ（小数の比率設定を扱うため）。AIは一切使用していない（純ルール）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: マイグレーション適用（`20260728104523_growth_g1_add_upvote_ratio`、非破壊ADD COLUMN）＋`npx vitest run` 全Green（95ファイル/1169テスト、既存含め全パス。修正後再実行済み）。
- [x] 基準2: `npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（エラー0、既存パターンの警告6件のみ・修正差分に起因する新規警告なし）通過（修正後再実行済み）。
- [x] 基準3: 賛否が割れるスレ（comment/score比高 or upvote_ratio低）が `isControversial` として検出されることをユニットテストで確認。記事化優先（同hotnessStrength時のタイブレーク）とタイトル議論寄り（ルールベース【議論】固定・LLMヒント追記）を結合テストで確認。AI不使用・純ルール・新規依存なし・既存挙動/データ不変（Post.upvoteRatioは非破壊追加、既存テストは全てGreenのまま）。5ch（F-G1-1指摘）はcomment比を論争判定に使わない挙動を今回の修正で担保。

## アプリの起動方法
- `npm run dev`（Next.js開発サーバー、http://localhost:3000）
- テスト: `npx vitest run`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- 本スプリントはロジック層（HotnessEvaluator/収集/生成パイプライン）のみの変更でUIには手を入れていないため、動作確認は上記テストコマンドで実施（サーバー起動は不要と判断し、自己確認では起動していない＝停止処理も不要）。

## 既知の問題・懸念点
- `minControversyRatio`/`maxUpvoteRatio` はreddit/riot/汎用では共通設定のまま（5chのみ今回の修正でInfinity上書き）。ソース別に個別調整したくなった場合は`HOTNESS_5CH_MIN_CONTROVERSY_RATIO`等のenvで対応可能な形を維持。
- `buildExemptHotnessResult`（riot/riot-news）は `isControversial` を常に `false` とした（ブリーフに明記が無かったための裁量判断。公式パッチ/ニュースは「賛否が割れる」概念に馴染まないという設計判断で、非目標にも抵触しない）。
- 論争度判定はscore/commentsの現在値のみを使用し、増加率・分位閾値・カレンダートリガ等は非目標どおり未実装（次スプリント以降の想定）。

## 追加したテスト
- `hotness-evaluator.test.ts`: `isControversial`/`controversyScore` の各分岐（comment比超過・upvote_ratio以下・両方満たさない・upvoteRatio未指定・isHotとの独立性）を新規describeブロックで追加。既存の「reasonsは空になる」テストは意図せず論争条件を満たさないよう入力値を調整。今回の修正で5ch(isControversial=false固定)・reddit(既定0.15/0.80維持)の3ケースを追加。
- `hotness-config.test.ts`: `minControversyRatio`/`maxUpvoteRatio` の既定値・env上書き・不正値フォールバックを追加。既存の`toEqual`厳密比較テストに新フィールドを追記。今回の修正で5chのInfinity化・env上書き・不正値フォールバックの3ケースを追加。
- `collection-reddit.test.ts`: `upvote_ratio`→`item.upvoteRatio`の転記・未指定時undefinedを追加。
- `collection-collect-source.test.ts`: `toCollectionItems`の`upvoteRatio`転記を追加。
- `collection-persist-posts.test.ts`: `Post.upvoteRatio`のcreate/update時の保存・未指定時null・更新時の反映を追加。
- `generation-title.test.ts`: `generateHookTitle`の論争優先（ラベル【議論】固定・フック限定・既定falseの回帰なし）、`generateHookTitleLLM`のsystemヒント追記（呼び出し回数不変）・フォールバック時の議論寄り継承を追加。
- `generation-post-pipeline.test.ts`: `Post.upvoteRatio`のevaluateHotness伝播→タイトル議論化、同hotnessStrength時の`isControversial`優先タイブレークを追加。

## 前回フィードバックへの対応（品質ゲート指摘の再実装）
- 指摘: brief F-G1-1「5chはcomment比を論争判定に使わない」に反し、`minControversyRatio=0.15`がソース非依存に全ソース適用され5ch反応記事が常時isControversial=trueになりタイトル多様性を損なう → 対応: `getHotnessConfig`の5ch分岐で`minControversyRatio`をInfinity（env上書き可）に上書き。他ソース・evaluator.tsのロジックは無変更。テスト追加・全既存テスト回帰なしを確認済み。

## 関連ドキュメント
- [[growth-g1-brief]]（本スプリントの仕様抜粋）
- [[growth-research]]（成長提案書）
