---
tags: [sprint-selfeval]
sprint: growth-g7
---

# 成長G7 自己評価レポート

## 実装した内容
- F-G7-1: `SOURCE_TYPES` に `"x"` 追加。連動する `Record<SourceType,...>`（`collection/config.ts`・`hotness/config.ts`・`adapters/mock.ts`・`generate-article.ts`の`CATEGORY_BY_SOURCE`/`ARTICLE_SOURCE_LABEL`・`compose.ts`の`QUOTE_SOURCE_LABEL`）をコンパイラ指摘に従って順に埋めた。カテゴリ「Xの反応」を`categories.ts`に新設（gradient・slug="x"・既定サムネイルSVG追加）。`getHotnessConfig("x")`はreddit相当（minScore=100/minComments=30）。5chのような論争度無効化はしない。
- F-G7-2: `src/lib/collection/adapters/x.ts`（新規）に`XAdapter`。GetXAPI `GET /twitter/tweet/advanced_search`をBearer認証・q/product/cursorで呼び、`buildXItem`でtweet→RawCollectionItem変換（externalId/sourceUrl/content/score/commentCount/author/postedAt/media/category="Xの反応"）。isReply除外。失敗・非2xx・タイムアウト(10s)・不正JSONは空配列。既定クエリ2件（国内lang:ja min_faves:100 / 海外lang:en min_faves:1000）、`since:`未指定クエリには重複取得防止の日次窓を自動付与。
- F-G7-3: `adapters/index.ts`の`getAdapter`/`getAllAdapters`に`x`登録。live全体モードでも`X_API_KEY`未設定時は`x`だけmock(fixture)にフォールバックする専用分岐を追加（他ソースのlive/mock判定とは独立）。`fixtures/x.json`に日本語/英語tweet・いいね/リプライ・author・media付きサンプル4件を追加。
- F-G7-4: `embed.ts`に`isValidTweetStatusUrl`（tweet status URL検証、既存`isAllowedEmbedUrl`/`embedProviderForUrl`の"twitter"providerを再利用）。`compose.ts`に`composeXBody`（見出し「Xでの反応」→独自導入(LLM)→tweet embed(有効なstatus URL時)または短い引用＋出典(author併記、reddit経路の`translateReactionBatch`に合流して英語のみ翻訳)→独自結び(LLM)）。`generate-article.ts`にx用の最低条件チェック（riot-news同様、見出し1件以上）を追加。

## 技術選定
- GetXAPI採用（既にbriefで確定済みの外部サービス）。理由: (a) fetch標準のみで新規npm依存なし・Windows/管理者権限不要、(b) $0.05/1,000tweets・$0.10無料クレジットで月額固定費なし・従量課金のみ。`architecture.md`に短い決定メモを追記。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run`全Green（105ファイル/1316テスト）・`npx tsc --noEmit`エラー0・`npm run build`成功・`npm run lint`エラー0（既存の無関係な警告6件のみ、G7由来のエラーなし）。
- [x] `X_API_KEY`未設定でmock収集が動き、x投稿がPost化→Hotness判定→記事化（カテゴリ「Xの反応」）→表示までE2Eが通る。**実際の`npm run collect`＋`npm run pipeline`（COLLECTION_MODE/GENERATION_MODE共に既定mock、実DBへの実書き込み）で確認済み**: fixture4件収集→hot判定された2件がカテゴリ「Xの反応」で公開、本文に`heading:"Xでの反応"`＋独自導入/結び段落＋`embed(provider:"twitter")`ブロックを確認。devサーバー(`npm run dev`)で該当記事ページ・`/category/x`・トップページのナビをcurlで確認し、いずれも200・「Xでの反応」見出し・埋め込みプレースホルダーカード・「Xの反応」ナビタブが表示されることを確認した。
- [x] live実装（`XAdapter`）はGetXAPI仕様（GET advanced_search・Bearer・q/product/cursor・tweetsフィールド）に忠実。単体テスト（`collection-x.test.ts`）で非2xx・タイムアウト(AbortError相当)・不正JSON・ネットワーク断いずれも空配列（例外を投げない）ことを確認。表示はtweet embed（有効なstatus URL）または引用＋出典（author併記）で著作権の主従を確保（`generation-compose-x.test.ts`・`generation-post-pipeline-x.test.ts`）。
- [x] 発見・記事化判定にAI不使用（min_faves検索＋HotnessEvaluatorの数値ルールのみ、AIはintro/context段落生成・タイトル生成・翻訳のみに使用）。翻訳は既存reddit経路（`translateReactionBatch`、"reaction-translate"タスク種別）に合流し追加のAI呼び出し種別は増やしていない。新規npm依存なし（fetch標準）。DBスキーマ変更なし（`prisma/schema.prisma`は未編集、既存Post.author等の列を再利用）。秘密（`X_API_KEY`）はenv経由、`.env.example`にキー名のみ記載。既存ソース（reddit/5ch/riot/riot-news）向けの既存テストは全て回帰なくGreen。

## アプリの起動方法
- 開発サーバー: `npm run dev`（http://localhost:3000）。
- 収集（mock、既定）: `npm run collect`（`COLLECTION_MODE`未設定=mock。`X_API_KEY`を設定し`COLLECTION_MODE=live`にするとGetXAPIへ実接続）。
- 記事生成・公開: `npm run pipeline`。
- テスト: `npx vitest run`。型チェック: `npx tsc --noEmit`。lint: `npm run lint`。ビルド: `npm run build`。

## 既知の問題・懸念点
- タイトル生成（`generateHookTitleLLM`のmock実装）が短い英語tweet本文に対して不自然な短縮タイトル（例:「【朗報】This、まさかの展開に」）を生成するケースをE2E確認中に観測した。これはG7で新規導入したロジックではなく既存の煽りタイトル生成（reddit/5ch記事にも同様に適用される既存ロジック）の挙動であり、本スプリントのスコープ外・回帰ではない。
- live実キー（実際のGetXAPI）での本番疎通確認は未実施（brief・受け入れ基準どおり、本スプリントの合否対象外。ユーザーがキーを取得次第、別途本番PoC検証が必要）。
- since:窓・cursorページネーションは「日次窓＋1ページのみ」の簡易実装（brief「無理なら日次窓でよい」の範囲）。将来ページ送り運用が必要になれば`buildAdvancedSearchUrl`のcursor引数を使って拡張できる（既に用意済み）。

## 追加したテスト
- `src/lib/__tests__/collection-x.test.ts`: `buildXItem`のGetXAPIレスポンス→RawCollectionItemマッピング（media/isReply除外/欠落フィールド/不正日付）、`buildTweetTitle`、`parseSearchQueries`/`appendSinceIfMissing`、`buildAdvancedSearchUrl`、`XAdapter.fetchItems`（APIキー未設定/複数クエリ直列＋Bearerヘッダ/非2xx/ネットワーク断/タイムアウト/不正JSON/isReply除外）。
- `src/lib/__tests__/generation-compose-x.test.ts`: `composeXBody`の見出し・独自導入/結び段落、tweet embed（有効status URL）とquote＋出典（author併記）の分岐、reddit経路への翻訳合流（日本語はスキップ・英語は翻訳・翻訳失敗時は原文フォールバック）。
- `src/lib/__tests__/generation-post-pipeline-x.test.ts`: x由来Postのhot/非hot判定→記事化→カテゴリ「Xの反応」→embed/quoteブロック→moderation(NGワード)保留、をPrisma実DB結合で検証。
- `src/lib/__tests__/collection-collect-source.test.ts`（追加）: x由来のscore/commentCount/author/media/categoryの転記漏れが無いことを確認（S7cの教訓の再確認）。
- `src/lib/__tests__/embed.test.ts`（追加）: `isValidTweetStatusUrl`のstatus URL許可/非status URL拒否/無関係ドメイン拒否。
- `src/lib/__tests__/categories.test.ts`・`collection-adapters-registry.test.ts`・`hotness-config.test.ts`・`generation-article-updater.test.ts`・`article-thumbnail.test.tsx`（既存ファイル更新）: カテゴリ/アダプタレジストリ/hotness既定/Record網羅/サムネイルの回帰確認にxを追加。

## 関連ドキュメント
- [[growth-g7-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
