---
tags: [sprint-selfeval]
sprint: S5a
---

# リファクタリング S5a 自己評価レポート

## 実装した内容
- `src/lib/generation/post-pipeline.ts`（新規）: `generateArticlesFromHotPosts(llmClient, options)`
  - 未記事化Post（`where: { article: null }`）を取得 → `PostMetricsHistory`を読み`evaluateHotness`（S3・AI不使用）でisHot判定 → isHotのみ通す。
  - カテゴリ(=sourceType)別に独立して最大`maxPerCategory`件（既定`getPipelineConfig().maxPublishPerCategory`=2）、hotnessの強さ（score+comments+scoreGrowthPerHour+commentGrowthPerHour、決定論）降順で選択。
  - 選ばれたPostから`GenerationCandidate`を組み既存`generateArticleForCandidate`で生成 → `moderateArticleContent`（重複判定プールは`generation/pipeline.ts`の`loadPublishedContentPool`をexportして再利用）→ `Article`作成＋`postId`（@unique）紐付けをトランザクションで原子的に実行。
  - 1件の生成失敗は記録して他Postを継続、全体は例外を投げない。返り値`PostGenerationRunSummary`（succeededCount/failedCount/results、旧`GenerationRunSummary`とフィールド互換）。
- `src/lib/pipeline/config.ts`: `getGenerationSource()`追加（env `GENERATION_SOURCE`、既定"post"、"collected"のみ旧経路）。
- `src/lib/pipeline/run-pipeline.ts`: `PipelineRunOptions.generationSource`/`generatePostArticles`を追加し、既定は新フロー(`generateArticlesFromHotPosts`)、"collected"指定時のみ旧`generateArticlesForQueue`を呼ぶよう分岐。収集（CollectedItem＋Post両方保存）とキュー再構築は従来どおり常に実行（collected経路の回帰を保つため）。`generationSummary`の型を`GenerationRunSummary | PostGenerationRunSummary`のunionに変更。
- `src/lib/generation/pipeline.ts`: `loadPublishedContentPool`をexportに変更（新旧経路で重複判定ロジックを二重管理しないため）。旧`generateArticlesForQueue`自体は無改修。
- `scripts/pipeline.ts`: ログ出力ループが新旧どちらの結果形（`postId`/`collectedItemId`）でも動くよう`"postId" in r`で分岐。
- `.env.example`: `GENERATION_SOURCE`（既定post/collectedで旧経路）を追記。

## 技術選定
- 新規ライブラリ追加なし。既存の`generateArticleForCandidate`・`moderateArticleContent`・`evaluateHotness`・`getHotnessConfig`をそのまま結線するだけに留めた（ブリーフの制約どおり）。
- hotnessの強さの比較指標は「score+comments+scoreGrowthPerHour+commentGrowthPerHour」の単純合算とした（reddit=score優勢・5ch=comments優勢という各ソース特性を1つの決定論的数値に吸収するため）。タイブレークはpostId昇順で完全決定論にした。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（新規/更新含む、976 tests / 86 files）。
- [x] `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過（lintは既存の軽微なwarning5件のみ、エラー0件、今回追加分に起因するものなし）。
- [x] 既定で「hot判定された未記事化Postのみ」がAIで記事化され、Postに紐付き重複実行されない（`generation-post-pipeline.test.ts`で検証）。カテゴリ別最大2本（同テストで検証）。`GENERATION_SOURCE=collected`で旧経路に戻せる（`pipeline-run-pipeline.test.ts`末尾の切替テストで検証）。逐語維持・AIは生成/翻訳のみ・新規依存なし・グレースフル（1件失敗でも他継続、テストで検証）。

## アプリの起動方法
- テスト: `npx vitest run`（専用テストDB `prisma/test.db` に自動差し替え、globalSetupで毎回まっさらに初期化）。
- 型チェック: `npx tsc --noEmit`
- ビルド確認: `npm run build`（Next.js standaloneビルド。今回は起動確認まではせず、ビルド成功のみで自己確認完了。既存のUI/表示ロジックは変更していないため`next start`起動確認は省略）。
- lint: `npm run lint`
- パイプライン単独実行（本接続確認、任意）: `npm run pipeline`（既定`GENERATION_SOURCE`未設定=新フロー。DBに実際にPost/CollectedItemが無ければ0件記事化で正常終了する）。

## 既知の問題・懸念点
- 新フローでPostの生成失敗を永続化する列がPrismaスキーマに無い（スキーマ変更なしの制約による意図的な設計）。失敗したPostは次回実行時も再度hot判定されれば対象になり得るが、`Article.postId`（@unique）により二重公開は起きないため不変条件は壊れない旨をコード内コメントに明記した。
- hotnessの強さの合算指標（score+comments+成長率）は「例」として仕様書に挙げられた指標を単純合算した独自設計。将来S5b以降で運用データを見てチューニングする余地がある（現時点では決定論であることのみを担保）。
- `runFullPipeline`の`candidateCount`（実行ログの「候補数」）は新フロー(post)でも従来どおりCollectedItemキューの`queuedCount`のままにした（Postベースの「候補数」概念をこのスプリントでは新設しなかった）。実際に記事化されたPost数は`generationSummary.results.length`で確認できる。
- Post.mediaからのimageUrl抽出は`{ imageUrl, url }`という現行アダプタの実際の形状に依存する防御的パースにした（他形状のJSONが来た場合はnull扱いで安全側に倒す）。

## 追加したテスト
- `src/lib/__tests__/generation-post-pipeline.test.ts`（新規、5テスト）: isHotのみ記事化・非hot/既記事化スキップ、カテゴリ別上限とhotness降順選択、postId紐付け+moderation held(duplicate)+1件失敗継続、hot0件/Post0件時の正常終了。
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`: 既存テストの生成経路を明示的に"collected"に固定（回帰防止）。末尾に新規describeブロック(3テスト)を追加し、env未設定/`generationSource`未指定時は新フロー、`"collected"`指定時・env`GENERATION_SOURCE=collected`時は旧経路が呼ばれることをスパイで検証。
- `src/lib/__tests__/pipeline-config.test.ts`: `getGenerationSource()`の3テスト（既定post・collected指定・不正値フォールバック）を追加。

## 関連ドキュメント
- [[refactor-s5a-brief]]（本スプリントの仕様抜粋）
- [[refactor-proposal]]（大規模リファクタリング全体設計）
