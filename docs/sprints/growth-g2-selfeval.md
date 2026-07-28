---
tags: [sprint-selfeval]
sprint: growth-g2
---

# 成長G2 自己評価レポート

## 実装した内容
- F-G2-1: `src/lib/related-articles.ts` に `viewCount` を `RelatedCandidate` に追加。純関数 `selectSameCategoryLatest`（同カテゴリ・自分除外・publishedAt降順・excludeSlugs対応）と `selectSameTagPopular`（一致タグ数→viewCount→publishedAt降順・一致タグ0除外・フォールバック無し・excludeSlugs対応）を追加。既存 `selectRelatedArticles` は無変更（型に viewCount 追加のみ）。
- F-G2-2: `src/lib/articles.ts` に `fetchSameCategoryLatestCandidates`（既存 `listArticlesByCategory` 利用）・`fetchSameTagPopularCandidates`（主要タグ最大2つに限定してDB候補取得、`selectMainTagNames`ヘルパ追加）を追加。記事詳細ページで `incrementViewCount`/`listRelatedArticles(6件)`/`fetchSameCategoryLatestCandidates`/`fetchSameTagPopularCandidates`/コメント取得を `Promise.all` で並列実行し、選定（純関数・同期処理）のみ関連→同カテゴリ→同タグの順に既出slugを積み上げて重複排除する設計にした（DBアクセス自体は逐次化していない）。
- F-G2-3: `src/app/articles/[slug]/page.tsx` の記事末を「関連記事(6件)」「同じカテゴリの最新記事(6件、空なら非表示)」「同じタグの人気記事(6件、空なら非表示)」の3ブロック＋ハブ導線に拡張。既存の `ArticleList`/`ArticleCard`・広告枠（matched-content/article-bottom/sidebar）は変更せず配置を維持。
- F-G2-4: 新規 `src/lib/hub-links.ts`（純関数・テンプレ）で `buildCategoryHubLink`/`buildTagHubLink`/`buildHubLinks`/`isForbiddenAnchorText` を実装。アンカーラベルは必ずカテゴリ名/タグ名を含み、「こちら」「詳しくは」「リンク」単体を禁止語として判定するユニットテストを追加。

## 技術選定
- 新規依存追加なし。既存の Prisma/Next.js/Vitest スタックのみで実装（architecture.md のベースライン継続利用）。
- 記事末の3ウィジェットは「DB候補プール取得（並列）→純関数での選定・重複除外（同期）」に分離する設計を採用。理由: brief F-G2-2 の「Promise.allで並列取得・逐次化しない」を、ウィジェット間のslug除外という状態依存ロジックと両立させるため（除外は同期処理なのでDB往復を増やさない）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1192件 pass）・`npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（エラー0、既存の警告6件のみで本スプリント由来ではない）。
- [x] 記事詳細ページ末尾に「関連記事」「同カテゴリの最新（空なら非表示）」「同タグの人気（空なら非表示）」の3ブロック＋ハブ導線を実装。実機（dev server, localhost:3000）で表示確認済み。ハブ導線は `パッチ/メタの記事一覧`（/category/patch-meta）・`ジャングルのまとめをもっと見る`（/tags/ジャングル）等、キーワードを含むアンカーが実際にレンダリングされることを確認。
- [x] 3ブロックで同一記事が重複しない: 純関数レベル（`selectSameCategoryLatest`/`selectSameTagPopular` の excludeSlugs 引数）とページ側の既出slug積み上げロジックで保証。ユニットテストで「関連で選ばれた記事が同カテゴリ最新に重複しない」ケースを検証済み。アンカーテキストに禁止語（こちら等）が無いことはユニットテストで固定。
- [x] AI不使用（全て純ルール/テンプレ）・DBスキーマ変更なし・新規依存なし。既存挙動（サイドバー/ハブページ/カード/広告配置）は変更していない（該当ファイルを一切編集していない）。

## アプリの起動方法
```
npm run dev
```
- http://localhost:3000/articles/<slug> で任意の公開記事を開くと記事末に新しい回遊ウィジェットが表示される。
- 確認に使用した記事例: `http://localhost:3000/articles/patch-2614-jungle-nerf-hikkuri-kaeru`

## 既知の問題・懸念点
- ローカル開発DB（prisma/dev.db）の公開記事は現状12件と少なく、確認に使った記事では「関連記事(6件)」だけで同カテゴリ・同タグの記事がほぼ全て消費されてしまい、「同カテゴリの最新記事」「同タグの人気記事」セクションが両方とも空＝非表示になった（仕様どおりの正しい挙動だが、実機での視覚的な非空表示確認はできていない）。この2ウィジェットの「非空時に正しく表示される」ことは、DB統合テスト（`article-end-widgets.test.ts`）とページ側の選定ロジックをそのまま使うユニットテスト（`related-articles.test.ts` の該当describe）で検証済み。記事数が十分に増えた本番相当データでの実機確認が望ましい。
- `selectMainTagNames`（主要タグ選定）は記事の全公開記事数を都度カウントするクエリを1回追加する（対象タグ名のみに絞ったクエリで、タグ数に比例して行数が増えるわけではないため許容範囲と判断）。

## 追加したテスト
- `src/lib/__tests__/related-articles.test.ts`: `selectSameCategoryLatest`（同カテゴリ限定・自分除外・降順・limit・0件時空配列・excludeSlugs）、`selectSameTagPopular`（一致タグ数→viewCount→publishedAt順・一致タグ0除外・自分除外・limit・excludeSlugs）、3ウィジェット間の既出slug除外の統合的な純関数テストを追加。
- `src/lib/__tests__/hub-links.test.ts`: 禁止語判定（こちら/詳しくは/リンク単体は禁止、「外部リンク一覧」等の複合語は許容）、`buildCategoryHubLink`/`buildTagHubLink`のキーワード含有、`buildHubLinks`の組み立て順・categorySlug未定義時の省略・タグ0件時の挙動。
- `src/lib/__tests__/article-end-widgets.test.ts`: `fetchSameCategoryLatestCandidates`/`fetchSameTagPopularCandidates` の published のみ・自分除外・件数上限・主要タグ限定（記事数の多い上位2タグのみ使用）を専用テストDBで検証。

## 関連ドキュメント
- [[growth-g2-brief]]（本スプリントの仕様抜粋）
