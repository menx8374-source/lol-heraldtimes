# リファクタリング S5a — 記事化を「Post＋HotnessEvaluator（数値判定）」ベースに（新フロー骨格・旧経路はフラグ残置）

大規模リファクタ（docs/refactor-proposal.md）の本丸S5の前半。S1〜S4で用意した `Post`／時系列メトリクス／HotnessEvaluator を
結線し、**数値ルールで「hot」と判定された未記事化PostだけをAIで記事化**する新フローを既定にする。SEO生成はS5b。対象: Web。

## 背景（なぜ）
要件「話題性判定は数値ルール・AIは生成/翻訳/SEOのみ・1投稿1回・重複防止」。S3のHotnessEvaluator（AI不使用）で記事化母数を
絞り、S5で本文/タイトル/翻訳を生成する。旧 `CollectedItem`→記事化経路は**比較用にフラグで残す**。

## 含まれる機能

### F-S5a-1: Postベースの記事生成（`src/lib/generation/post-pipeline.ts` 新規）
- `generateArticlesFromHotPosts(llmClient, options)`:
  1. **対象Post抽出**: `Post` のうち **まだ記事化されていない**もの（`Article.postId` から参照されていない＝`where:{ article: null }`）を取得。
     各Postの `PostMetricsHistory`（時系列）を読み、**`evaluateHotness`（S3・AI不使用）で isHot 判定**。isHot のみ通す。
  2. **カテゴリ別上限（E48踏襲）**: sourceType（=カテゴリ）ごとに最大 `maxPerCategory`（既定は `getPipelineConfig().maxPublishPerCategory`＝2）件。
     hotness の強さ（例 metrics.score や増加率）で各カテゴリ内を降順に選ぶ（決定論・AI不使用）。
  3. **記事生成（既存流用）**: 各Postから `GenerationCandidate` を組み（id=post.id, sourceType, sourceUrl=post.url, title=post.title,
     content=post.body, imageUrl=post.media の imageUrl 等）、既存 `generateArticleForCandidate`（本文/タイトル/翻訳・reactionは
     S3既定の数値ルール選定）で生成。
  4. **moderation**: 既存 `moderateArticleContent`（NG/出典/中傷/重複）を必ず通す。重複判定プール（`loadPublishedContentPool` 相当）も踏襲。
  5. **保存＋紐付け＋重複防止**: Article を作成し **`Article.postId = post.id`**（@unique）で紐付け（1投稿1記事）。トランザクションで原子的に。
     既に `article` がある Post はそもそも対象外＝**1投稿1回のAI実行**を保証。
  6. **グレースフル**: 1件の生成失敗は記録して他を継続（既存方針）。全体は例外を投げない。
- 返り値は既存 `GenerationRunSummary` 互換（succeeded/failed/results）にして run-pipeline のログ集計を流用。

### F-S5a-2: 生成経路の切替フラグ（run-pipeline.ts）
- env `GENERATION_SOURCE` で切替:
  - **既定（未設定 or `"post"`）＝新フロー**：`generateArticlesFromHotPosts` を使う。
  - `"collected"`＝旧フロー：従来の `generateArticlesForQueue`（CollectedItemベース・比較用）。
- `runFullPipeline` は収集（CollectedItem＋Post の両方保存＝S2のまま）→（既定）Postベース生成、に。メトリクス更新（S4）は別ジョブのまま。
- `.env.example` に `GENERATION_SOURCE`（既定 post／collected で旧経路）を追記。

### F-S5a-3: カテゴリはルールで付与（AI分類しない）
- 既存 `CATEGORY_BY_SOURCE`（riot→パッチ/メタ・5ch→5chの反応・reddit→海外の反応）をそのまま使う（ルールベース）。AIによる分類は行わない。

## 制約・非目標
- **SEO生成（seoTitle/meta/OGP/slug/タグ）はS5b**（本スプリントは新フロー骨格＝hot判定→既存生成→postId紐付け→重複防止まで）。
- 旧 `CollectedItem`→記事化（`generateArticlesForQueue`）は削除せず `collected` フラグで残す。moderation・逐語・強調・翻訳の方針は不変。
- DBスキーマ変更なし（S1で追加済みの postId/SEO列を使う。SEO列はS5bで埋める）。新規依存なし。
- HotnessEvaluator の閾値は S3 の設定（env）を使う。mock収集ではPostにexternalId/metricsが乗らないため、テストは注入/専用データで行う。

## テスト（必須・専用テストDB＋スタブLLM・実ネット非依存）
1. `generateArticlesFromHotPosts`: isHot な未記事化Postのみ記事化される。非hot・既記事化(article有り)Postはスキップ（1投稿1回・重複防止）。
2. カテゴリ別上限: 5ch×多数・reddit×多数の hot Post があっても各カテゴリ最大2本（E48同等・独立）。hotnessの強さで各カテゴリ内降順選択。
3. 生成・保存: 生成された Article が `postId` で Post に紐付く（@unique）。moderation不通過は held（既存挙動）。1件失敗でも他継続・例外なし。
4. フラグ: 既定/`GENERATION_SOURCE=post` で新フロー、`=collected` で旧 `generateArticlesForQueue`（回帰なし）。
5. 既存の pipeline/generation/sitemap テストが回帰しない（旧経路・表示は不変。既定生成経路の切替による期待更新は最小限）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 既定で「hot判定された未記事化Postのみ」がAIで記事化され、Postに紐付き重複実行されない。カテゴリ別最大2本。
   `GENERATION_SOURCE=collected` で旧経路に戻せる。逐語維持・AIは生成/翻訳のみ・新規依存なし・グレースフル。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが致命的回帰なし（コンソールエラー0）。
- hot判定による母数絞り・postId紐付け・1投稿1回・カテゴリ別上限・経路フラグがテストで確認できる。
- 受け入れ基準1〜3を満たす。
