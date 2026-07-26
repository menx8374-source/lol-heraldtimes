---
tags: [sprint-selfeval]
sprint: ext-e45
---

# 拡張E45 自己評価レポート

## 実装した内容
- F-E45-1: `src/lib/collection/adapters/clip.ts`・`src/lib/__tests__/collection-clip.test.ts`・`src/lib/collection/fixtures/clip.json` を削除。`adapters/index.ts` の `ClipAdapter` import・`LIVE_ADAPTER_FACTORIES.clip`・関連コメントを削除。`config.ts` の `getDefaultSourceConfigs` から `clip` エントリを削除。`.env.example` から `YOUTUBE_API_KEY`/`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`（clipソース専用）と `COLLECTION_CLIP_MAX_ITEMS`/`COLLECTION_CLIP_MIN_INTERVAL_MS` を削除。
- F-E45-2: `types.ts` の `SOURCE_TYPES`（`SourceType`の導出元）から `"clip"` を削除。連動する `CATEGORY_BY_SOURCE`・`ARTICLE_SOURCE_LABEL`（generate-article.ts）、`QUOTE_SOURCE_LABEL`（compose.ts）から clip 行を削除。`composeClipBody`・`isClipFormat`分岐・`composeArticleBody`のclip分岐を削除（`composeClipBody`は反応埋め込み`detectClipEmbedBlocks`とは無関係であることをコード確認済み）。`llm-client.ts` の `"clip-intro"` GenerationTask種別・`renderClipIntro`（composeClipBody専用ヘルパー）も削除。`mock.ts` の `FIXTURES` からclip行削除。
- F-E45-3: `categories.ts` の `CATEGORY_GRADIENTS`/`CATEGORY_SLUGS` から `"eスポーツ"`/`"esports"` を削除（3カテゴリに）。`site-header.tsx` のサブタイトル文言から「eスポーツ」表記を削除（ナビ・sitemap・robots・feedは `CATEGORY_LABELS` 経由の自動反映のため個別修正不要）。
- 副次対応（tscエラー解消のため必須）: `prisma/seed.ts` の `CATEGORIES` 型が `CategoryLabel` に束縛されており、`eスポーツ` 削除でコンパイルエラーになったため、旧eスポーツ枠のサンプル記事3件（いずれも sources=Riot公式）を `パッチ/メタ` に再分類。
- 副次対応（最小限のドキュメント更新）: `README.md` の環境変数表・外部サービス接続方針の説明からclip関連env var・「全4ソース」表記を削除し「全3ソース」に更新、eスポーツ削除の経緯を一言追記。

## 技術選定（該当する場合のみ）
- 新規技術選定なし（既存コードの削除・整理のみ）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green: 75ファイル / 862テスト全パス（削除・更新テスト含む）。
- [x] `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過（lintはエラー0件、既存の無関係な警告5件のみ・本スプリント無関係）。
- [x] clip 収集ソース・eスポーツ カテゴリが無くなった: `getAllAdapters`は3ソース(5ch/reddit/riot)のみ、`CATEGORY_LABELS`は3カテゴリのみ（テストで確認）。
- [x] 反応記事の動画埋め込みは完全に維持: `detectClipEmbedBlocks`・`composeReactionBody`・`embed.ts`のprovider（youtube/clip=twitch/twitter）・`EmbedBlockView`・iframe再生ロジックは一切変更していない。`generation-compose.test.ts`の反応記事embed回帰テスト（5ch:youtube、reddit:twitchクリップ、上限3件、許可外ドメイン除外、重複排除）は全て残置・パス確認済み。
- [x] 新規依存なし・他ソース(5ch/reddit/riot)・他カテゴリ(パッチ/メタ・5chの反応・海外の反応)は不変（テスト・ビルドで確認）。
- [x] 既存DBにclip/eスポーツ記事が残っても表示が壊れない: `article-thumbnail.tsx`は`categorySlugFor`が`undefined`を返すカテゴリを汎用既定サムネイル(`/default-thumb.svg`)にフォールバックする既存ロジックがそのまま効くことを確認・回帰テスト追加(`article-thumbnail.test.tsx`)。

## アプリの起動方法
- 開発サーバー: `npm run dev` → `http://localhost:3000`
- 本番相当: `npm run build && npm run start`
- テスト: `npx vitest run`（または `npm test`）
- 型チェック: `npx tsc --noEmit`
- lint: `npm run lint`
- （本スプリントでは自己確認用にサーバーを起動していない。build/tsc/vitest/lintの静的検証のみで完結）

## 既知の問題・懸念点
- `public/default-thumb-esports.svg` はブリーフに削除指示が無く、参照も無くなったが未使用ファイルとして残置（実害なし、削除は明示指示外のためスコープ外と判断）。
- `prisma/seed.ts` のシード記事に残る `tags: ["eスポーツ", ...]` 等のタグ文字列は自由文字列(CategoryLabelに束縛されない)のため型エラーにはならず、ブリーフの明示対象(カテゴリ本体)ではないため変更していない。
- 一時的な基盤障害は発生しなかった。

## 追加したテスト（任意）
- `collection-adapters-registry.test.ts`: 3ソース(5ch/reddit/riot)のみになったことの確認に更新。
- `categories.test.ts`: 3カテゴリのみになったことの確認に更新。
- `article-thumbnail.test.tsx`: 旧「eスポーツ」カテゴリの記事が未知カテゴリとして汎用既定サムネイルにフォールバックする回帰テストを追加。
- `generation-generate-article.test.ts`・`generation-compose.test.ts`: clip専用テストを削除。反応記事(5ch/reddit)本文中のYouTube/TwitchクリップURL embed回帰テストは維持（最重要の回帰確認）。

## 関連ドキュメント
- [[sprint-ext-e45-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
