---
tags: [sprint-selfeval]
sprint: ext-e4
---

# Sprint E4（SEO/集客）自己評価レポート

## 実装した内容
- **RSS/Atomフィード**: `/feed.xml`（Route Handler, `force-dynamic`）。公開記事のみ直近30件（タイトル/リンク/抜粋/公開日時）をRSS 2.0で配信。XML組み立て・エスケープは `src/lib/feed.ts` の純関数（`buildRssFeed`/`escapeXml`）に分離。`layout.tsx` の `metadata.alternates.types` で `<link rel="alternate" type="application/rss+xml">` を出力。
- **期間別ランキング（日間/週間/月間）**: `ArticleView`（閲覧イベント1行1閲覧）テーブルを追加。`incrementViewCount` で累計 `viewCount` に加えてイベントも記録。`listPopularArticlesByPeriod`（`src/lib/articles.ts`）が `prisma.articleView.groupBy` を cutoff（`src/lib/ranking.ts` の純関数 `cutoffForPeriod`）で絞って集計（有界・1クエリ）。サイドバーの人気ランキング（`popular-ranking.tsx`）を client component 化し、累計/日間/週間/月間タブを実装。切替は `GET /api/ranking?period=` を叩く。
- **タグクラウド/人気タグ**: `src/lib/tags.ts` に `listPopularTags`（公開記事のみ集計）・`rankTags`/`tagCloudSizeClass`（純関数）を追加。`TagCloud` コンポーネントをサイドバーに追加（記事数で文字サイズ変化、`/tags/[tag]` へリンク）。
- **月別アーカイブ**: `src/lib/archive.ts`（`groupByMonth`/`monthDateRange`/`isValidMonthKey` 等の純関数＋`listArchiveMonths`/`listArticlesByMonth`）。`/archive`（月一覧）・`/archive/[month]`（月別記事一覧、既存ページネーション流用）を新設。サイドバーに直近6ヶ月のウィジェット。不正な月キーは404、形式は正しいが0件の月は空状態表示。
- **BreadcrumbList JSON-LD**: `src/lib/seo.ts` に `buildBreadcrumbJsonLd` を追加。共通コンポーネント `Breadcrumbs`（可視パンくず＋JSON-LD）を作成し、記事/カテゴリ/タグ/アーカイブ一覧/アーカイブ月ページに導入（既存の簡易パンくずを置き換え）。
- **ブログランキング/外部集客枠**: `src/lib/blog-ranking.ts`（env `BLOG_RANKING_HTML`、広告枠 `AdSlot` と同方式）＋`BlogRankingSlot` コンポーネントをサイドバーに追加。未設定時はプレースホルダー。
- サイトマップ（`sitemap.ts`）にタグページ・`/archive`・アーカイブ月ページを追加（いずれも公開記事由来のみ、語彙として有界）。

## 技術選定
- 既存ベースライン（Next.js App Router + TS + Prisma/SQLite + Vitest）をそのまま踏襲。新規ライブラリ追加なし。
- 期間別ランキングの切替はページ全体リロードを避けるため、サーバーコンポーネント（初期表示）+ 最小限のクライアントコンポーネント（タブ切替時のfetch）のハイブリッドにした。既存の `reaction-buttons.tsx`（fetch+楽観的更新）と同じパターンに揃えている。

## 受け入れ基準チェック（自己申告）
- [x] RSS/Atomフィード配信: `/feed.xml` が公開記事のみ・正しいRSS 2.0構造・XMLエスケープ済みで配信されることをテスト（`feed.test.ts`・`seo-output.test.ts`）と実機curlで確認。
- [x] 期間別ランキング（日間/週間/月間）: `ArticleView`集計・cutoff境界・保留記事除外をDBテストで確認（`ranking-db.test.ts`）。UIタブ切替を実機で確認（`/api/ranking?period=day` が閲覧回数順を返す）。
- [x] タグクラウド/人気タグ: 公開記事限定の集計をDBテストで確認（`tags-ranking-db.test.ts`）。実機でサイドバー表示・`/tags/[tag]`遷移を確認。
- [x] 月別アーカイブ: `/archive`・`/archive/[YYYY-MM]`の一覧・ページネーション・不正月404をDBテスト＋実機（curl）で確認。
- [x] BreadcrumbList JSON-LD: `buildBreadcrumbJsonLd`の位置連番・絶対URL・toSafeJsonLdとの組み合わせ（XSS対策）をテスト。記事/カテゴリ/タグ/アーカイブページで実機出力を確認。
- [x] ブログランキング/外部集客枠: env未設定時プレースホルダーを実機確認。設定値のみ`dangerouslySetInnerHTML`対象（閲覧者入力は混ぜない）。
- [x] 公開記事のみ露出（保留記事の非露出）: フィード・タグ集計・アーカイブ集計・期間別ランキングいずれもDBテストで保留記事が含まれないことを確認。
- [x] 既存307件のテスト・機能を壊さない: 拡張後 `npm test` は353件全てGreen（既存分含む）。

## アプリの起動方法
```
npm run db:seed            # サンプル記事投入（既存DBがあれば任意）
npm run build && npm run start   # 本番相当起動（http://localhost:3000）
```
- 開発起動: `npm run dev`
- 確認したURL例: `http://localhost:3000/feed.xml`、`http://localhost:3000/archive`、`http://localhost:3000/archive/2026-07`、`http://localhost:3000/api/ranking?period=day`
- テスト: `npm test`（Vitest, 353件Green）／型チェック: `npx tsc --noEmit`／Lint: `npm run lint`（既存の無関係な警告1件のみ、エラー0件）

## 既知の問題・懸念点
- `ArticleView` は物理削除を行わない設計（cutoffで集計時に除外するのみ）。長期運用で行数が増え続けるため、将来的にcutoffより十分古い行を定期削除するバッチ処理の追加余地があるとコード内コメントに明記した（今スプリントでは未実装、スコープ外と判断）。
- 期間別ランキングのタブ切替はクライアント側`fetch`で行うため、JavaScript無効環境ではタブ切替が機能しない（初期表示の「累計」ランキングは通常通りSSRで表示される）。
- サイトマップへのタグ/アーカイブページ追加は仕様上「任意」とされていたが、SEO/集客が本スプリントの主目的のため追加した（スコープを超える判断だが、E4の趣旨に直接資すると判断）。
- ブログランキング枠はサイドバーのみに配置（フッターへは未配置）。仕様は「フッターまたはサイドバー」のいずれかで良いとの理解。

## 追加したテスト
- `src/lib/__tests__/feed.test.ts`: RSS XML組み立て・XMLエスケープ（`<`/`&`/`"`/`'`等）の純関数テスト。
- `src/lib/__tests__/ranking.test.ts`: `cutoffForPeriod`境界値・`isValidRankingPeriod`・`mapRankingOrder`の純関数テスト。
- `src/lib/__tests__/ranking-db.test.ts`: `listPopularArticlesByPeriod`のcutoff境界・保留記事除外・`incrementViewCount`のイベント記録をDB結合テスト。
- `src/lib/__tests__/archive.test.ts`: 月キー算出・月別集計・日時範囲算出の純関数テスト。
- `src/lib/__tests__/archive-db.test.ts`: `listArchiveMonths`/`listArticlesByMonth`の公開記事限定・404判定をDB結合テスト。
- `src/lib/__tests__/tags-ranking-db.test.ts`: `listPopularTags`/`listAllTagNames`の公開記事限定集計をDB結合テスト。
- `src/lib/__tests__/tags.test.ts`（既存に追記）: `rankTags`/`tagCloudSizeClass`の純関数テスト。
- `src/lib/__tests__/seo.test.ts`（既存に追記）: `buildBreadcrumbJsonLd`の位置連番・絶対URL・XSS対策の組み合わせテスト。
- `src/lib/__tests__/seo-output.test.ts`（既存に追記）: サイトマップのタグ/アーカイブエントリ、`/feed.xml`の公開記事限定・降順配列をDB結合テスト。

## マイグレーション
- `prisma/migrations/20260725064729_add_article_views/`: `ArticleView` テーブル追加（`articleId`, `viewedAt`、インデックス `articleId`/`viewedAt`）。`npx prisma migrate dev` で適用済み（`prisma/dev.db`・テストDB双方に反映確認）。

## 追加した環境変数
- `BLOG_RANKING_HTML`（任意）: ブログランキング/外部集客枠に差し込む信頼済みHTML文字列。`.env.example`にキー名のみ追記済み。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
