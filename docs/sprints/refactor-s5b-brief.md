# リファクタリング S5b — SEO生成（seoTitle/metaDescription/OGP/タグをAI生成し表示に反映・slugはID維持）

大規模リファクタS5の後半。AIの許容用途「SEO生成」を実装する。記事生成時にSEOメタとタグをAIで1回生成し、Articleに保存、
表示（`<head>`/OGP）へ反映する。**slugは現行のID安定方式を維持**（URL変更なし・ユーザー決定）。対象: Web。

## 背景（なぜ）
要件「AIは生成・翻訳・SEOに使う／SEOタイトル・メタディスクリプション・OGP・タグを生成・クリック率と検索流入を意識」。
S1でArticleにSEO列（seoTitle/metaDescription/ogTitle/ogDescription）を用意済み。ここを埋め、表示に効かせる。

## 含まれる機能

### F-S5b-1: SEOジェネレータ（`src/lib/generation/seo.ts` 新規・AI 1回）
- `generateSeo(llmClient, { title, bodyText, category }): Promise<GeneratedSeo | null>`
  - 出力(JSON): `{ seoTitle, metaDescription, ogTitle, ogDescription, tags: string[] }`。
  - system指示: 「LoLまとめサイトのSEO編集者。検索意図とクリック率を意識し、記事内容に忠実な（捏造しない）
    SEOタイトル(全角30〜40字目安)・メタディスクリプション(全角110〜120字目安)・OGPタイトル/説明・タグ(3〜6個、
    チャンピオン名や話題など記事に実在する語)を作る。出力はJSONのみ」。
  - 堅牢パース（コードフェンス/前置き除去。既存 compose.ts の extractJsonObject 相当を共有 or 同等実装）。
  - **失敗（mock・APIエラー・空・parse不能）は null を返す**（呼び出し側が従来のメタ生成にフォールバック＝壊れない）。
  - 各値は空文字・非文字列を除去して正規化。tags は非空文字列のみ・件数上限（例8）。

### F-S5b-2: 生成への結線＋保存（generate-article.ts / pipeline・post-pipeline）
- `generateArticleForCandidate` の返り値 `GeneratedArticle` に **`seo?: GeneratedSeo | null`** を追加し、生成時に `generateSeo` を1回呼ぶ
  （本文・タイトル生成の後）。**mock/失敗時は seo=null**（追加コストなし・従来どおり）。
- Article 作成箇所（**post-pipeline.ts と 旧 pipeline.ts の両方**）で、`generated.seo` があれば SEO列
  （seoTitle/metaDescription/ogTitle/ogDescription）に保存し、`generated.seo.tags` を **既存 Tag/ArticleTag に connectOrCreate**
  で紐付ける（タグAI補完）。seo=null なら SEO列は未設定（表示は従来メタにフォールバック）。
- **slug は現行のID安定方式のまま**（変更しない）。
- AI呼び出しは「記事1本につきSEO 1回」。判定・分類には使わない（要件遵守）。

### F-S5b-3: 表示への反映（articles/[slug]/page.tsx ほか）
- `generateMetadata` を、Articleに SEO列があればそれを使うよう更新（無ければ従来ロジックにフォールバック）:
  - `<title>` = `article.seoTitle ?? article.title`
  - `description` = `article.metaDescription ?? buildArticleDescription(...)`（既存）
  - OGP: `openGraph.title` = `article.ogTitle ?? article.seoTitle ?? article.title`、
    `openGraph.description` = `article.ogDescription ?? article.metaDescription ?? buildArticleDescription(...)`
  - OGP画像は既存 `resolveOgImageUrl`（拡張E38/E42）を維持。
- 記事取得（`lib/articles.ts` の select）に SEO列を含める（generateMetadata が読めるように）。一覧カード等の表示は変えない。

## 制約・非目標
- **slugは変えない**（ID安定方式）。カテゴリ分類はAIでやらない（既存ルール）。話題性判定・選別もAIでやらない（S3のまま）。
- mock既定では seo=null＝従来メタ（無課金・回帰なし）。SEOはlive時のみ生成。新規npm依存なし。逐語・moderation・強調・翻訳の方針は不変。
- 既存記事（SEO列が空）は従来メタで表示（フォールバックで壊れない）。

## テスト（必須・実API/実ネット非依存＝スタブLLM／専用テストDB）
1. `generateSeo`（スタブ）: 正常JSON→ seoTitle/metaDescription/ogTitle/ogDescription/tags を正規化して返す。空/不正/例外→ null。tags 上限・空要素除去。
2. `generateArticleForCandidate`: スタブでseoを返すと `GeneratedArticle.seo` に載る。mock/失敗時は seo=null（従来どおり）。SEO呼び出しは記事1回。
3. 保存: post-pipeline / 旧pipeline どちらでも、seoありなら Article の SEO列に保存＋tags が ArticleTag に紐付く。seo=null なら SEO列未設定。
4. 表示: `generateMetadata` が SEO列ありのとき seoTitle/metaDescription/ogTitle/ogDescription を使い、無いとき従来メタにフォールバック（両方テスト）。
5. 既存の seo-output/generation/pipeline テストが回帰しない（mockはseo=nullで従来メタ）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. live生成時に記事へ SEOタイトル/メタ/OGP/タグ が付き、`<head>`/OGPに反映される。slugは不変。mockは従来メタ（回帰なし）。
   AIはSEO 1記事1回・判定/分類には不使用。新規依存なし。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成/表示が回帰しない（コンソールエラー0・SEO列なしでも従来メタで表示）。
- SEO生成→保存→generateMetadata反映のフォールバック分岐、tags紐付け、slug不変がテストで確認できる。
- 受け入れ基準1〜3を満たす。
