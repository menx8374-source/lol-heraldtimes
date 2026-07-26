---
tags: [sprint-selfeval]
sprint: ext-e22
---

# 拡張E22 自己評価レポート

## 実装した内容
- **F-E22-1**（`src/lib/generation/compose.ts`）: `detectClipEmbedBlocks()` を追加。反応記事（5ch/reddit）の本文テキストからURLを正規表現で抽出し、`embedProviderForUrl` + `isAllowedEmbedUrl`（既存の`embed.ts`）を経由して youtube/clip のみを許可（twitterは対象外）。重複排除・最大3件。`composeReactionBody()` の末尾で reaction ブロックの後に embed ブロックとして加算（逐語テキストはそのまま保持）。
- **F-E22-2**（`src/lib/embed.ts`）: `extractYoutubeVideoId` / `extractTwitchClipSlug` / `embedIframeSrc` を追加。いずれも `embedProviderForUrl`+`isAllowedEmbedUrl` の許可判定を必ず経由したうえで、ID/slugを厳格な形式（`^[A-Za-z0-9_-]{11}$`＝YouTube、`^[A-Za-z0-9_-]+$`＝Twitch）で検証し、不正なら null。
- **F-E22-2**（`src/components/article-body-view.tsx`）: `EmbedBlockView` を、provider が youtube/clip かつ src構築成功時は実iframe（`loading="lazy"`・`allowFullScreen`・`referrerPolicy="strict-origin-when-cross-origin"`・最小限の`allow`）を描画するよう変更。src構築失敗（不正ID等）・twitterは従来のプレースホルダーカードにフォールバック。`getSiteUrl()`（`src/lib/site.ts`）由来のホストをTwitchの`parent`に使用。`dangerouslySetInnerHTML`は未使用（srcは検証済みID/slug経由でのみ構築、生URLを直接srcにしない）。
- **F-E22-3**（`next.config.ts`）: `headers()` を新規追加し、全パスに `Content-Security-Policy: frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv` を付与（frame-srcのみ、他ディレクティブは指定せず既存挙動を維持）。

## 対応したURL形式（ID/slug抽出）
- YouTube: `youtube.com/watch?v=ID`、`youtu.be/ID`、`youtube.com/shorts/ID` → ID(11文字・英数/-/_)を抽出し `https://www.youtube-nocookie.com/embed/{ID}`。
- Twitch clip: `clips.twitch.tv/SLUG`、`twitch.tv/*/clip/SLUG`（www.twitch.tvも許可） → slug(英数/-/_、1文字以上)を抽出し `https://clips.twitch.tv/embed?clip={SLUG}&parent={siteHost}`。
- 上記いずれも `embedProviderForUrl`/`isAllowedEmbedUrl` の許可外ホスト・URL不正・ID/slug形式違反はすべて null（プレースホルダーへフォールバック）。

## 技術選定（該当する場合のみ）
- 新規依存の追加なし（既存の `embed.ts`/`site.ts`/Next.js標準の`headers()`のみで実装、architecture.mdの更新不要）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全668件Green（新規テスト26件を含む）。
- [x] 基準2: `composeArticleBody`（5ch/reddit）の本文に `https://youtu.be/dQw4w9WgXcQ` 等を含めるとembedブロックが1件以上入ることをテストで確認（`generation-compose.test.ts`）。クリップURLを含まない反応記事にembedが増えないことも確認。
- [x] 基準3: `embed.ts`の新ID抽出関数が正規URL（`youtu.be/ID`・`clips.twitch.tv/SLUG`・`twitch.tv/*/clip/SLUG`等）から正しいsrcを返し、不正URL・許可外ホスト・ID形式違反でnullを返すことをユニットテストで確認（`embed.test.ts`）。
- [x] 基準4: 実サーバー起動（`npm run start`）＋既存seedデータの記事詳細ページで実iframe生成を確認（`5ch-yasuo-otp-densetsu-no-play`のTwitchクリップが`<iframe src="https://clips.twitch.tv/embed?clip=SampleHighlightClipDemo&parent=localhost">`として描画）。`curl -I`で`frame-src`CSPヘッダの付与を確認。許可外ドメイン(twitter)・不正ID(YouTube id長さ違反)のembedはiframe化されずカード表示にフォールバックすることも既存seed記事(`worlds-2026-group-stage-draw-kekka`のYouTube、`overseas-tier-list-patch-146-hantei`のtwitter)で確認。
- [x] 基準5: `npx tsc --noEmit`・`npm run build`・`npm run lint` すべて通過（lintは既存の警告2件のみ、今回の変更に起因するエラー・警告なし）。
- [x] 基準6: 既存のarticle-body-viewテスト・generation-composeテストは全てGreenのまま（回帰なし）。twitter埋め込みは従来どおりカード表示のまま（テストで確認）。clipソース記事(`composeClipBody`)・(A)検索ソース・eスポーツカテゴリ・画像表示・逐語転載テキストは未変更。

## アプリの起動方法
- 開発: `npm run dev` → `http://localhost:3000`
- 本番相当確認: `npm run build && npm run start` → `http://localhost:3000`（本自己評価では`npm run start`で起動確認後、`npx kill-port 3000`で停止済み）
- CSPヘッダ確認: `curl -I http://localhost:3000/`
- テスト: `npx vitest run`

## 既知の問題・懸念点
- なし（自動補完インストールは発生せず、`.env`等シークレット関連の変更もなし）。

## 追加したテスト
- `src/lib/__tests__/embed.test.ts`: `extractYoutubeVideoId`/`extractTwitchClipSlug`/`embedIframeSrc`の正規URL・不正ID・許可外ホスト・twitter対象外を検証。
- `src/lib/__tests__/generation-compose.test.ts`: 反応記事(5ch/reddit)本文からのYouTube/Twitchクリップ検出、重複排除、最大3件、クリップ無し記事での回帰なし、twitter等の許可外providerは検出しないことを検証。
- `src/components/__tests__/article-body-view.test.tsx`: youtube/clipの実iframe描画、ID抽出失敗時のプレースホルダーフォールバック、twitterは常にカード表示、iframe属性(loading/allowFullScreen/referrerPolicy)を検証。
- `src/__tests__/next-config-headers.test.ts`: `next.config.ts`の`headers()`がframe-src CSP（youtube-nocookie/player.twitch.tv/clips.twitch.tv）を返し、他ディレクティブを含まないことを検証。

## 関連ドキュメント
- [[ext-e22-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
