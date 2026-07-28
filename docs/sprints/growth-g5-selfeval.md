---
tags: [sprint-selfeval]
sprint: growth-g5
---

# 成長G5 自己評価レポート

## 実装した内容
- F-G5-1: `src/lib/generation/seo.ts` の `SEO_SYSTEM_PROMPT` にカテゴリ別タイトル型（パッチ/メタ・5chの反応/海外の反応・Riot公式・eスポーツ・チャンピオン/Tier系）と共通ルール（重要語を前半28〜32字以内・全角｜・区切り・捏造禁止）を静的追記。JSON出力形式・既存フォールバックは不変。呼び出し回数・`generateSeo`のシグネチャは変更なし。
- F-G5-2:
  - `src/lib/seo.ts` に純関数 `buildNewsArticleJsonLd` を追加（dateModified・author(Organization)・publisher.logo(ImageObject, `/og-default.svg`)を含むNewsArticle JSON-LDを組み立て）。
  - `src/app/articles/[slug]/page.tsx` の構造化データ生成をこの新関数呼び出しに置き換え。
  - `src/lib/articles.ts` の `ArticleDetail` 型・`toDetail` に `updatedAt` を追加（`articleWithRelations` は `include` を使っているため既存クエリは元々全スカラー列を取得済み。selectを個別に絞っていないため追加のDB列変更は不要、DBスキーマ変更なし）。
  - BreadcrumbList JSON-LD は既存の `Breadcrumbs` コンポーネント（拡張E4で実装済み、`buildBreadcrumbJsonLd`）が記事ページで既にトップ>カテゴリ>記事の階層で出力しているため、追加実装不要（既存機能の確認のみ）。
- F-G5-3:
  - 新規 `src/lib/news-sitemap.ts`: 48時間ウィンドウ判定 (`isWithinNewsWindow`/`NEWS_SITEMAP_WINDOW_MS`) とXML組み立て (`buildNewsSitemapXml`、`lib/feed.ts`の既存`escapeXml`を再利用) の純関数群。
  - `src/lib/articles.ts` に `listArticlesForNewsSitemap(now)` を追加（公開から48時間以内のpublished記事のみDBクエリで絞り込み取得。有界化）。
  - 新規 `src/app/news-sitemap.xml/route.ts`: 上記を組み合わせて `Content-Type: application/xml` を返す。DB取得失敗時も例外を投げず空urlsetにフォールバック。
  - 既存 `sitemap.ts`・`robots.ts`・`feed.xml` は変更なし（robots.tsへのnews-sitemap追記は任意項目のため、既存の`sitemap`フィールド型変更が既存テストの厳密一致検証を壊すリスクを避けるため見送り）。

## 技術選定（該当する場合のみ）
- 新規ライブラリなし。既存の `lib/feed.ts` の `escapeXml` を再利用（XMLエスケープの重複実装を避けるため）。
- JSON-LD強化・news sitemapともに既存の「純関数（DB/フレームワーク非依存）＋薄いルート/コンポーネント層」という本プロジェクトの既存パターン（`buildBreadcrumbJsonLd`/`buildRssFeed`）を踏襲。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（100ファイル/1255テスト、既存1207件+新規約48件）。
- [x] `npx tsc --noEmit` エラー0。
- [x] `npm run build` 成功（`/news-sitemap.xml` ルートが一覧に出力されることを確認）。
- [x] `npm run lint` エラー0（既存の警告6件のみ、すべて本スプリント変更前から存在するもの／`no-img-element`や別テストファイルの`_messages`未使用警告で本スプリントの変更箇所ではない）。
- [x] seoTitleがカテゴリ別テンプレで前半にキーワードを含む型になる: `SEO_SYSTEM_PROMPT`にカテゴリ別型・前半28〜32字ルールを追記しテストで固定（`generation-seo.test.ts`）。
- [x] dateModified/author/BreadcrumbListのJSON-LD出力: `buildNewsArticleJsonLd`ユニットテスト（`seo.test.ts`）で検証。BreadcrumbListは既存`Breadcrumbs`が担保（新規テスト無し、既存機能）。
- [x] 48時間以内のnews sitemapが`/news-sitemap.xml`で有効なXMLとして返る: `news-sitemap.test.ts`（純関数）＋`seo-output.test.ts`（DB結合・GETルート）で検証。
- [x] AI呼び出し回数不変: `generateSeo`のLLM呼び出し回数・引数・シグネチャは無変更。プロンプト末尾に静的テキストを追記しただけ。
- [x] 表示見出し不変: `src/lib/generation/title.ts`は無変更（git diffで確認）。触れたのは`seoTitle`関連の`SEO_SYSTEM_PROMPT`とJSON-LD/select/sitemapのみ。
- [x] DBスキーマ変更なし: `prisma/schema.prisma`は無変更（git diffで確認）。`updatedAt`は既存カラム。
- [x] 新規依存なし: `package.json`/`package-lock.json`は無変更（git diffで確認）。
- [x] 既存sitemap/feed/JSON-LD/OG画像が壊れない: 既存の全テストがGreenのまま（回帰テストは`seo-output.test.ts`の既存describeブロックがそのまま通過）。

## アプリの起動方法
- `npm run dev`（デフォルト http://localhost:3000）または本番相当は `npm run build && npm start`。
- 確認対象: `/articles/<slug>` のJSON-LD（`<script type="application/ld+json">`2つ: NewsArticle強化版とBreadcrumbList）、`/news-sitemap.xml`。
- 本スプリントは自己確認をVitest（DB結合テスト込み）・`tsc`・`next build`のみで実施し、確認用にサーバー（`next dev`/`next start`）は起動していないため停止作業は不要。

## 既知の問題・懸念点
- robots.txtへのnews-sitemap URL追記は brief で「任意」とされており、既存 `robots.ts` の `sitemap` フィールド（文字列）を配列化すると既存テスト（`toContain("/sitemap.xml")`、配列だと完全一致比較になり壊れる）との整合が崩れるリスクがあるため見送った。必要なら次スプリント以降でテスト更新とセットで対応可能。
- BreadcrumbList のJSON-LDは今回新規実装しておらず、拡張E4で実装済みの既存 `Breadcrumbs` コンポーネントが記事ページで既にトップ>カテゴリ>記事階層で出力していることを確認したのみ（brief の背景説明にあった「BreadcrumbListが無い」は現状のコードベースでは既に解消済みだった）。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-seo.test.ts`: `SEO_SYSTEM_PROMPT`のフリーズテスト（カテゴリ別型・共通ルール・出力形式の維持）。
- `src/lib/__tests__/seo.test.ts`: `buildNewsArticleJsonLd`のユニットテスト（dateModified/author/publisher.logo・XSS対策）。
- `src/lib/__tests__/news-sitemap.test.ts`: 純関数`isWithinNewsWindow`/`buildNewsSitemapXml`のユニットテスト（境界値・エスケープ・0件時の空urlset・複数記事の並び）。
- `src/lib/__tests__/seo-output.test.ts`: `getArticleBySlug`のupdatedAt取得、`listArticlesForNewsSitemap`の48時間フィルタ結合テスト、`/news-sitemap.xml`ルートのGET結合テスト（0件・直近記事のみ含む）。

## 関連ドキュメント
- [[growth-g5-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
