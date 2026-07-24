---
tags: [sprint-selfeval]
sprint: 1
---

# Sprint 1 自己評価レポート

## 実装した内容
- Next.js（App Router）+ TypeScript + Tailwind CSS + Prisma + SQLite でプロジェクトを新規スキャフォールド。
- Prisma データモデル（`prisma/schema.prisma`）: `Article`（title/slug/category/body(JSON)/thumbnailUrl/viewCount/publishedAt）、`ArticleSource`（出典1件以上・label+url）、`Tag`/`ArticleTag`（多対多）。マイグレーション適用済み（`prisma/migrations/20260724191740_init`）。
- 本文は見出し/段落/引用のブロック配列（`ArticleBodyBlock`）として保持し、`src/lib/article-body.ts` の `parseArticleBody` で検証・パースしてから表示（長文ベタ書き対策）。
- データアクセス層 `src/lib/articles.ts`: `listArticles()`（新着順一覧）、`getArticleBySlug()`、純関数 `sortByPublishedDateDesc()`。
- トップページ（`src/app/page.tsx`）: 記事カード一覧（サムネイル・カテゴリ・投稿日時・タイトル）。
- 個別記事ページ（`src/app/articles/[slug]/page.tsx`）: タイトル・見出し/段落/引用構造の本文・投稿日時・カテゴリ・タグ・出典リンク・AI自動生成注記。存在しない slug は `notFound()` で 404。
- 404ページ（`src/app/not-found.tsx`）: トップへ戻る導線あり。
- サンプルシードスクリプト（`prisma/seed.ts`）: 12件のまとめ速報風記事（各記事に出典1件以上、本文3〜6ブロック）。
- レイアウト/ヘッダー/フッターは Tailwind のレスポンシブユーティリティで構成。
- Vitest による純関数のユニットテスト12件（並び順・本文パース・日時整形）。

## 技術選定
- Prisma は architecture.md 記載時点の最新版が v7 系だったが、v7 で `datasource.url` の書き方が破壊的変更され `prisma.config.ts` + driver adapter（例: better-sqlite3 系のネイティブアダプタ）が必須になっていた。ネイティブビルド回避という architecture.md の方針（Windows/Node24 での native-gyp 詰まり回避）と矛盾するため、**Prisma を安定版の v6.19.3 に固定**し、従来通り `schema.prisma` に `url = env("DATABASE_URL")` を書く方式を採用（プリコンパイル済みエンジンのみで完結、ネイティブアダプタ不要）。骨格（Prisma+SQLite）自体は architecture.md の決定通り。
- 自己確認のためだけに Playwright を一時的に devDependency 追加してレスポンシブ・コンソールエラーを検証し、確認後にアンインストール済み（プロジェクトの正式なテスト基盤は Vitest のまま。evaluator は別途 Playwright MCP を使用する想定のため重複導入を避けた）。

## 受け入れ基準チェック（自己申告）
- [x] トップページに記事カードが新しい順で最低10件（12件投入・降順表示を確認）。各カードにタイトル・カテゴリ・投稿日時・サムネイル領域あり。
- [x] 記事カードのタイトルクリックで個別ページへ遷移（`<Link href="/articles/{slug}">`、curlで200確認）。
- [x] 個別記事ページにタイトル・本文（見出し+段落構造）・投稿日時・カテゴリ・出典リンク（1件以上）・AI自動生成注記を表示（HTML確認済み）。
- [x] 375px・1280px の両方で横スクロールなし（Playwrightで `scrollWidth === clientWidth` を実測。overflow=false を確認、スクリーンショットも目視確認）。
- [x] 存在しない記事URLで404ページ表示＋トップへ戻る導線あり（curlで404ステータス・リンク文言を確認）。
- [x] 本文の見出し・段落・出典リンクが構造化されて表示（JSONブロック配列→個別コンポーネントで描画。長文ベタ書きではない）。

## アプリの起動方法
```bash
cd "c:\ClaudeProjects\lolまとめサイト自動運営"
npm install
npx prisma migrate dev   # 初回のみ（DBは既に作成済み・マイグレーション適用済み）
npm run db:seed          # サンプル記事12件を投入（既に投入済み。再実行すると全削除→再投入）
npm run dev              # http://localhost:3000
```
本番相当確認: `npm run build && npm run start`（既定ポート3000。自己確認時はポート3100で `next start` を使い、確認後にプロセス停止済み）。

## 既知の問題・懸念点
- サイドバーの人気記事ランキング・検索・カテゴリ絞り込みナビ（ワイヤーフレーム画面1）は F2/F4 等の後続スプリント対象のため未実装（スコープ外として意図的に見送り）。
- `viewCount` はシード値のみで、閲覧時にインクリメントするロジックは未実装（F3 で対応予定、Sprint 1 の受け入れ基準には含まれない）。
- `npm warn allow-scripts`: `sharp`・`unrs-resolver`（Next.js/ESLintの依存が使う画像最適化・リゾルバの任意ネイティブ処理）の install スクリプトは未承認のまま。ビルド・テスト・lint は全て成功しており機能に支障はないため保留。必要になれば `npm approve-scripts sharp unrs-resolver` で承認可能。
- Prisma を v7→v6.19.3にダウングレードした件は上記「技術選定」に記載の通り。将来 v7 系の driver adapter 方式（例: `@prisma/adapter-better-sqlite3`）へ移行する場合は、ネイティブビルドの要否を再検証すること。

## 追加したテスト
- `src/lib/__tests__/articles.test.ts`: `sortByPublishedDateDesc`（降順ソート・空配列・非破壊性）
- `src/lib/__tests__/article-body.test.ts`: `parseArticleBody`（正常系・配列でない値/空配列/未知type/空文字textでのエラー）、`hasStructuredHeadings`
- `src/lib/__tests__/format.test.ts`: `formatPublishedAt`（ゼロ埋め等）
- 実行結果: `npm test`（vitest run）→ 3 test files / 12 tests すべて PASS
- 見た目のみのUIコンポーネント（カード・ヘッダー等）は無理にテストを書いていない

## 関連ドキュメント
- [[sprint-1-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
