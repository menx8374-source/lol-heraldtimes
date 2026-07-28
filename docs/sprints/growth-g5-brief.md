# 成長G5 — SEOタイトル/メタの型化＋構造化データ強化＋ニュースサイトマップ（AI呼び出し回数不変）

成長提案書(docs/growth-research.md 観点⑥・G5)。日本のLoL検索需要（パッチ番号・チャンピオン名・Tier・大会結果）を
タイトル/構造化データで確実に取りにいく。**SEO生成は既存1記事1回のまま**（呼び出し回数を増やさず「型」で質を上げる）。純ルール中心。対象: Web。

## 背景（現状と差分）
- SEO生成 `src/lib/generation/seo.ts` の `SEO_SYSTEM_PROMPT` は良質だが**カテゴリ別のタイトル型が無い**。日本語検索結果のタイトルは約28〜32字で切られるため、**重要語（パッチ番号・チャンピオン名・大会名・日付）を前半へ**寄せる型が要る。`generateSeo` は既に `input.category` を受け取っている。
- 記事ページ `src/app/articles/[slug]/page.tsx` の JSON-LD は `NewsArticle`（headline/datePublished/articleSection/image/publisher）のみで、**`dateModified`・`author`・`BreadcrumbList` が無い**。`Article.updatedAt`（`@updatedAt`）は存在するが `ArticleDetail` の select に含まれていない。
- `src/app/sitemap.ts`（通常sitemap）はあるが、**Googleニュース向けの news sitemap（48時間以内）が無い**。

## 含まれる機能

### F-G5-1: SEOタイトル/メタの型化（seo.ts・呼び出し回数不変）
`SEO_SYSTEM_PROMPT` に**カテゴリ別タイトルテンプレ**を追記する（systemは静的のまま。呼び出しは既存1記事1回）:
- 共通ルール: 「重要語（パッチ番号・チャンピオン名・大会名・日付）を**前半28〜32字以内**に置く。区切りは全角 `｜`・`・`。捏造しない（本文に無い事実/チャンピオン名を作らない）」。
- カテゴリ別の型（例。LLMは記事の `category` に合う型を選んで適用）:
  - パッチ/メタ: `【LoL】パッチ{番号}変更点まとめ｜強化/弱体チャンピオン一覧`
  - 5chの反応/海外の反応: `【{ラベル}】{主題}｜{象徴的な一言/反応}`（既存の反応記事タイトルの雰囲気を尊重）
  - Riot公式: `【LoL】{発表主題}｜公式まとめ`
  - eスポーツ: `【{大会名}】{節/結果}まとめ`
  - チャンピオン/Tier系の話題があれば: `【{チャンピオン名}】{ビルド/対策/カウンター等}｜パッチ{番号}`
- **反応記事の本文タイトル（`title.ts`/`generateHookTitleLLM`）は変更しない**。ここで型化するのは `seoTitle`（検索/OGP用の別フィールド）であり、表示見出し（`title`）とは別物。既存のフォールバック（seoTitle→title）も不変。
- 文字数目安（seoTitle 30〜40字）等の既存指示は保持。metaDescription も「前半に検索語」を意識する一文を追記。

### F-G5-2: 構造化データの強化（記事ページ JSON-LD）
`src/app/articles/[slug]/page.tsx` の `NewsArticle` JSON-LD を強化し、`BreadcrumbList` を追加する:
- `NewsArticle` に **`dateModified`**（`article.updatedAt.toISOString()`。ISO8601＋TZ。Zulu表記でよい）を追加。`datePublished` は現状維持。
- **`author`** を追加（まとめサイトのため `{ "@type": "Organization", "name": SITE_NAME }`。運営者＝サイト。個人名は作らない）。
- `publisher` に **`logo`**（`{ "@type": "ImageObject", "url": <サイトロゴURL> }`）を追加（既存のロゴ資産／OG既定画像があればそれを使う。無ければサイトルート配下の既定ロゴパス）。
- 別の `<script type="application/ld+json">` として **`BreadcrumbList`**（`itemListElement`: トップ > カテゴリ > 記事。既存の `Breadcrumbs` コンポーネントに渡している items と同じ階層・URL）を出力。`toSafeJsonLd` で安全に埋め込む（既存の手法を踏襲）。
- `ArticleDetail` 型と取得 select に `updatedAt` を追加する（**DBスキーマ変更ではなく、既存カラムを select に足すだけ**）。`listArticlesForSitemap` が既に updatedAt を取得しているのと同様。
- image は既に配列（`resolveOgImageUrl`）。**幅1200px以上が理想**という要件は既存のOG画像生成に委ね、JSON-LDのimage配列自体は現状維持でよい（値の作り込みは非目標）。

### F-G5-3: ニュースサイトマップ（48時間以内の記事のみ）
`src/app/news-sitemap.xml/route.ts`（新規、既存 sitemap.ts と同じ動的ルート方式）で **Googleニュース向け news sitemap** を出力する:
- `xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"` を宣言し、**公開から48時間以内**の published 記事のみを列挙。各 `<url>` に `<news:news>`（`<news:publication>`＝`<news:name>`=SITE_NAME・`<news:language>`=ja、`<news:publication_date>`=publishedAtのISO8601、`<news:title>`=記事タイトル）。
- 48時間以内の対象が0件でも**空の有効な urlset を返す**（エラーにしない）。
- 通常 `sitemap.ts` は変更しない（併用）。robots.txt にニュースsitemapのURLを追記できるなら追記（任意・既存robots構成を壊さない範囲）。
- XMLは特殊文字（`&`・`<`・タイトル内の記号）を必ずエスケープする（XSS/破損防止）。

## 制約・非目標
- **AIの呼び出し回数を増やさない**（SEOは既存1記事1回。タイトル型はsystemプロンプトの静的追記のみ）。捏造禁止（本文に無い事実/固有名詞を作らない）を維持。
- **表示見出し `title`（title.ts/反応記事タイトル）は変更しない**。G5が触るのは `seoTitle`/メタ/JSON-LD/sitemap。
- **DBスキーマ変更なし**（`updatedAt` は既存カラムの select 追加のみ）。新規npm依存なし。
- 内部リンク（R1〜R8）はG2で実装済みのため本スプリントでは扱わない。投稿スケジュール・配信導線（RSS/X/Discord）はG6で扱う。
- 既存の sitemap.ts・feed.xml・robots・既存JSON-LD（NewsArticleの既存フィールド）・OG画像生成は壊さない。

## テスト（必須・実ネット非依存）
1. `SEO_SYSTEM_PROMPT`（強化後）にカテゴリ別テンプレ・前半キーワード・区切り・捏造禁止が含まれ、動的値が混ざらない（フリーズ）。`generateSeo` の出力形式（seoTitle/metaDescription/ogTitle/ogDescription/tags）と既存フォールバックが回帰しない。
2. 記事ページ JSON-LD: `NewsArticle` に dateModified/author/publisher.logo が入り、`BreadcrumbList` が トップ>カテゴリ>記事 の階層で出力される（`renderToStaticMarkup` かユニットで検証）。`toSafeJsonLd` でエスケープされる。
3. `ArticleDetail` に updatedAt が入り、既存の記事取得・一覧・関連記事が回帰しない。
4. news sitemap: 48時間以内の記事のみ・`news:` 名前空間・publication/language/publication_date/title・特殊文字エスケープ・対象0件で空urlset。48時間より古い記事が除外される。
5. 既存の sitemap.ts・seo・記事ページ・article-body-view のテストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. seoTitleがカテゴリ別テンプレで前半にキーワードを含む型になる（プロンプト・テストで確認）。記事に dateModified/author/BreadcrumbList のJSON-LDが出力される。48時間以内のnews sitemapが `/news-sitemap.xml` で有効なXMLとして返る。
3. AI呼び出し回数不変・表示見出し不変・DBスキーマ変更なし・新規依存なし・既存sitemap/feed/JSON-LD/OG画像が壊れない・捏造なし。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 記事ページのJSON-LD（NewsArticle強化＋BreadcrumbList）が構造的に妥当（`@type`/必須プロパティ/エスケープ）。`/news-sitemap.xml` が有効なXMLで48時間フィルタが効く。
- SEOタイトル型がプロンプトに反映され、既存の生成/表示が回帰しない。
- 受け入れ基準1〜3を満たす。
