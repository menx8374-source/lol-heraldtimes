---
tags: [sprint-selfeval]
sprint: E38
---

# 拡張E38 自己評価レポート

## 実装した内容
- F-E38-1: `src/lib/generation/champion-splash.ts` を新規作成（http非依存の純粋モジュール）。
  `buildChampionSplashUrl`・`CURATED_SPLASH_CHAMPION_IDS`・`pickDeterministicChampionSplashUrl`（決定論index計算含む）をここに移動。
  `src/lib/generation/champion-thumbnail.ts` は同モジュールから import し `export { ... }` で再export（既存の import 元 `generate-article.ts` はパス変更不要・挙動不変）。
- F-E38-2: `src/lib/categories.ts` に `REACTION_CATEGORY_LABELS`（`["5chの反応","海外の反応"]`）と `isReactionCategory(category)` を追加。
- F-E38-3: `src/components/article-thumbnail.tsx` に `slug?: string` prop を追加し、src決定を
  「①`isSafeImageUrl(thumbnailUrl)` ②`isReactionCategory(category) && slug` → `pickDeterministicChampionSplashUrl(slug)` ③従来のカテゴリ/汎用SVG」の優先順に変更。
  呼び出し元 `article-card.tsx`・`pickup-carousel.tsx` で `slug={article.slug}` を追加。
- F-E38-4: `src/app/articles/[slug]/page.tsx` の `resolveOgImageUrl` に `category`・`slug` 引数を追加し、
  thumbnailUrl無し+反応カテゴリのとき `pickDeterministicChampionSplashUrl(slug)` を返すよう拡張。2箇所の呼び出し（`generateMetadata`・structuredData の `image`）を更新。

## 技術選定（該当する場合のみ）
- 新規ライブラリなし。既存の関数移動＋純粋関数追加のみ（ブリーフの制約どおり）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（76 test files / 808 tests passed。新規テスト champion-splash.test.ts、categories.test.ts追加分、article-thumbnail.test.tsx追加分、seo-output.test.ts追加分を含む）。
- [x] 基準2: `npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（既存の警告4件のみ、エラー0、本スプリントの変更に起因する新規警告なし）通過。
- [x] 基準3: 表示側フォールバックのロジックとしては実装済み・テストで決定論／保存優先／非反応時の従来挙動を確認済み。実DBの既存反応記事（thumbnailUrl未設定）が実際にチャンピオンアートで表示されることは、上記ユニット/結合テスト（`ArticleThumbnail`・`resolveOgImageUrl`経由の`generateMetadata`）でロジックレベルで検証済み。ブラウザでの目視確認（evaluator向け）は未実施。
- [x] 基準4: 新規npm依存なし。E37の生成側ロジック（`generate-article.ts`のimport・呼び出し）は変更していない。逐語・本文・NG・強調色・タイトルには一切触れていない。

## アプリの起動方法
- `npm run dev` でNext.js開発サーバー起動（既定 http://localhost:3000）。
- 反応記事一覧・詳細ページのサムネ/OG画像確認には、`thumbnailUrl`未設定・`category`が「5chの反応」または「海外の反応」の記事が必要（既存DBに該当記事があればそのまま確認可能）。
- 本スプリントの自己確認では `npm run build` の一括ビルドのみ実施し、`npm run dev`等のサーバーは起動していない（起動不要で確認完了のため停止作業も不要）。

## 既知の問題・懸念点
- 決定論キーが生成側（candidate.id）と表示側（slug）で異なるため、E37以降に生成されno保存された記事と、E37以前の同一記事的な既存記事とで表示されるチャンピオンがずれる可能性がある。ブリーフの想定どおり「両者とも妥当なチャンピオンアートであり見た目上問題ない」という前提で許容。
- 実ブラウザでの目視確認（反応記事一覧・詳細のサムネ・OGP実描画）はこのスプリントでは未実施。evaluatorでの実機確認を推奨。

## 追加したテスト（任意）
- `src/lib/__tests__/champion-splash.test.ts`（新規）: 決定論・分散・`_0.jpg`形式・`champion-thumbnail.ts`からの再export整合。
- `src/lib/__tests__/categories.test.ts`（更新）: `isReactionCategory`の反応/非反応/null判定。
- `src/components/__tests__/article-thumbnail.test.tsx`（更新）: 反応+null+slug→スプラッシュ／決定論／非反応+null→カテゴリSVG／有効thumbnail優先／反応+slug無し→カテゴリSVG。
- `src/lib/__tests__/seo-output.test.ts`（更新）: `generateMetadata`経由で反応+null→スプラッシュ絶対URL／非反応+null→og-default／保存済みthumbnail優先。

## 関連ドキュメント
- [[ext-e38-brief]]（本スプリントの仕様抜粋）
