---
tags: [sprint-selfeval]
sprint: S5b
---

# リファクタリング S5b（SEO生成）自己評価レポート

## 実装した内容
- `src/lib/generation/seo.ts`（新規）: `generateSeo(llmClient, {title, bodyText, category})`。
  - LLMに1回だけ問い合わせ、`{seoTitle, metaDescription, ogTitle, ogDescription, tags}` のJSONを
    堅牢パース（コードフェンス/前置き除去、`extractJsonObject`同等実装）。
  - 各値trim正規化。`seoTitle`/`metaDescription`/`tags`(1件以上)が揃わない場合は null。
  - `ogTitle`/`ogDescription`は省略可（空なら null。表示側でさらにフォールバック）。
  - `tags`は非空文字列のみ・重複除去・上限8件。
  - 例外・空応答・JSON抽出/パース失敗はすべて null（本体を止めない）。
- `src/lib/generation/generate-article.ts`: `GeneratedArticle.seo: GeneratedSeo | null` を追加。
  本文・タイトル確定後に `generateSeo` を1回だけ呼ぶ。mock（`MockLLMClient`）は決定論的にSEO用の
  JSONを組み立てないため常に null（追加コストなし・回帰なし）。
- `src/lib/generation/pipeline.ts`（旧CollectedItem経路）・`src/lib/generation/post-pipeline.ts`
  （新Post経路）: `generated.seo` が非nullのときのみ `Article.create` にSEO列
  （seoTitle/metaDescription/ogTitle/ogDescription）を含め、`tags` を
  `Tag`/`ArticleTag` に `connectOrCreate` で紐付ける。null時はSEO列・タグとも未設定（従来どおり）。
  slug（`slugForCandidate`/`slugForPost`）は変更していない。
- `src/lib/articles.ts`: `ArticleDetail` に `seoTitle`/`metaDescription`/`ogTitle`/`ogDescription`
  （すべて `string | null`）を追加し、`toDetail` で反映。取得クエリ（`articleWithRelations`）は
  `include`のためスキーマの全スカラー列（SEO列含む）が元々取得済みで、select側の変更は不要。
- `src/app/articles/[slug]/page.tsx`: `generateMetadata` をSEO列優先・フォールバック順に変更。
  - `title` = `seoTitle ?? title`
  - `description` = `metaDescription ?? buildArticleDescription(...)`
  - `openGraph.title` = `ogTitle ?? seoTitle ?? title`
  - `openGraph.description` = `ogDescription ?? metaDescription ?? buildArticleDescription(...)`
  - OGP画像（`resolveOgImageUrl`）は変更なし。

## 技術選定
- 新規npm依存なし。既存の `LLMClient` 抽象・`MockLLMClient`/`AnthropicLLMClient` 切替をそのまま利用。
- JSON堅牢パースは `compose.ts` の `extractJsonObject` と同等ロジックを `seo.ts` に個別実装
  （`compose.ts` 側が非export・モジュール内プライベートのため、共有せず同等実装で対応。ブリーフの
  「共有 or 同等実装」の後者を採用）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green: 87ファイル / 994件 全Pass（新規: `generation-seo.test.ts` 9件、
      既存3ファイルへのSEO関連追加テスト、既存回帰は崩れていない）。
- [x] `npx tsc --noEmit` 通過（出力なし=エラーなし）。
- [x] `npm run build` 通過（Next.js本番ビルド成功、型チェック含め正常終了）。
- [x] `npm run lint` 通過（0 errors、warningは既存分含め6件で本スプリント由来のエラーなし）。
- [x] slugは `slugForCandidate`/`slugForPost` を変更しておらず不変（テストの`postId`/`collectedItemId`
      経由の検証でも従来どおりArticle作成・紐付けが動くことを確認）。
- [x] AI呼び出しは記事1本につきSEO1回（`generateArticleForCandidate`内で `generateSeo` を1回のみ呼ぶ。
      テストで`seoCallCount`を検証）。カテゴリ分類・話題性判定にはAIを使っていない（既存ルール
      `CATEGORY_BY_SOURCE`・数値ルール`evaluateHotness`は変更なし）。
- [ ] 「live生成時に実際にSEOタイトル/メタ/OGP/タグが付き反映される」は、実際のAnthropic API
      （`GENERATION_MODE=live`+`ANTHROPIC_API_KEY`）を用いた実地検証は行っていない（実ネット非依存の
      スタブLLMでの結合テストのみ）。ロジック上は`AnthropicLLMClient`経由でも同じ`generateSeo`が
      呼ばれ、mockと同じ保存・表示分岐を通るため妥当と考えるが、実API呼び出しでの動作は未検証。

## アプリの起動方法
- 開発サーバー: `npm run dev`（既定 http://localhost:3000 。個別記事ページ例: `/articles/<slug>`）
- 生成パイプライン実行: 既存の `run-pipeline` 系スクリプト（本スプリントでは変更していない）。
  `GENERATION_MODE=live` + `ANTHROPIC_API_KEY` 設定時のみSEO生成が実際に動く（未設定/mockは
  従来どおりSEO列なし・従来メタで表示）。
- 本スプリントの自己確認では `npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint`
  のみ実行し、確認用サーバーは起動していない（起動・停止の手順は不要）。

## 既知の問題・懸念点
- live実接続でのSEO生成の実地確認は未実施（上記チェック参照）。APIコストが発生するため、本スプリント
  では実ネット非依存のスタブ/モックのみで検証。
- `generateSeo`の必須項目判定（seoTitle・metaDescription・tags>=1件が無ければ全体null）は仕様書に
  明記のない実装判断。ogTitle/ogDescriptionは省略可とし、表示側の追加フォールバック
  （`ogTitle ?? seoTitle ?? title`）で補う設計にした。

## 追加したテスト
- `src/lib/__tests__/generation-seo.test.ts`（新規）: `generateSeo`の正常/コードフェンス付き/
  タグ上限・重複除去/失敗系（mock・空文字・非JSON・必須値欠落・tags空・例外）計9件。
- `src/lib/__tests__/generation-generate-article.test.ts`: SEOスタブ経由で`GeneratedArticle.seo`に
  載ること・呼び出し回数1回・mockではnullになることの2件を追加。
- `src/lib/__tests__/generation-pipeline.test.ts`（旧経路）: SEOスタブでSEO列+タグが保存されること・
  mockでSEO列/タグが未設定のままであることの2件を追加。
- `src/lib/__tests__/generation-post-pipeline.test.ts`（新経路）: 同上の2件を追加。
- `src/lib/__tests__/seo-output.test.ts`: `generateMetadata`のSEO列優先・フォールバック（SEO列あり/
  なし/OGP列のみ欠落の3パターン）を追加。

## 関連ドキュメント
- [[sprint-refactor-s5b-brief]]（本スプリントの仕様抜粋）
- [[refactor-proposal]]（大規模リファクタリング全体設計）
