# 拡張E45 — 「eスポーツ」単独ソース（YouTube/Twitch検索型）とカテゴリの削除

運用フィードバック起点（ユーザー決定）。対象: Web。

## 背景（なぜ）
`clip` 単独ソース（`ClipAdapter`）は「League of Legends」でYouTube/Twitchを無差別に新着検索して1動画=1記事を
「eスポーツ」カテゴリに作る設計だが、話題性・関連性の保証がなく質が低い（機械的な動画リスト）。加えて APIキーが
無いと何も生成せず**eスポーツ・カテゴリが空**になる。ユーザーの意図は「反応記事(5ch/reddit)の引用先に動画があれば
埋め込む」＝**既に実装済み（拡張E22 `detectClipEmbedBlocks`）**で足りるため、この単独ソースは**削除**する。

## 最重要: 残すもの（絶対に壊さない）
- **反応記事内の動画埋め込み機能**は完全に維持する: `detectClipEmbedBlocks`（compose.ts）、`ArticleBodyEmbedBlock`、
  `embed.ts` の provider（youtube/clip=twitch/twitter）、`EmbedBlockView`（article-body-view.tsx）、実iframe再生。
  これらは sourceType の "clip" とは**別物**（埋め込みprovider）なので触らない。
- 他ソース（5ch/reddit/riot）・カテゴリ（パッチ/メタ・5chの反応・海外の反応）の挙動は不変。

## 含まれる機能（削除対象）

### F-E45-1: clip 収集ソース（ClipAdapter）の削除
- `src/lib/collection/adapters/clip.ts` と対応テスト `src/lib/__tests__/collection-clip.test.ts` を削除する。
- `src/lib/collection/adapters/index.ts` の `getAllAdapters`/レジストリから `clip` を除外（ClipAdapter import も削除）。
- `src/lib/collection/config.ts` の `getDefaultSourceConfigs` から `clip` 設定を削除。
- `.env.example` の `YOUTUBE_API_KEY`/`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`（clipソース用）を削除
  （※埋め込みは別機能でキー不要なので、埋め込みに必要な設定があればそれは残す。基本これらはclipソース専用）。

### F-E45-2: SourceType から "clip" を削除（型レベルの掃除）
- `src/lib/collection/types.ts` の `SourceType` union から `"clip"` を削除。
- これに連動する箇所を全て更新（型エラーを解消）:
  - `generate-article.ts` の `CATEGORY_BY_SOURCE`・`ARTICLE_SOURCE_LABEL` から clip 行を削除。
    `composeArticleBody`（compose.ts）の `sourceType==="clip"` 分岐（`composeClipBody` 経路）を削除。
    ※`composeClipBody` はclipソース記事専用。反応記事の埋め込み(`detectClipEmbedBlocks`)とは別。
    `composeClipBody` とそれ専用のヘルパ・テストも削除してよい（反応埋め込みに使われていないことを確認のうえ）。
  - `compose.ts` の `QUOTE_SOURCE_LABEL` 等 `Record<SourceType, ...>` から clip を削除。
  - その他 `Record<SourceType, ...>` や clip を参照する箇所を網羅的に更新。
- **注意**: `generate-article.ts` の記事化フォーマット判定 `isClipFormat`（clipソース専用の埋め込み記事）は削除。
  ただし反応記事の埋め込み（reaction本文中のURL→embed）はcomposeReactionBody内で行われ、これは残す。

### F-E45-3: 「eスポーツ」カテゴリの削除
- `src/lib/categories.ts` の `CATEGORY_GRADIENTS`・`CATEGORY_SLUGS` から `"eスポーツ"`/`"esports"` を削除。
  `CategoryLabel` 型が自動的に3カテゴリ（パッチ/メタ・5chの反応・海外の反応）になる。
- カテゴリ一覧を参照するUI（ヘッダーナビ・カテゴリページ・sitemap 等）から eスポーツ を除外（`CATEGORY_LABELS` 経由なら自動）。
- sitemap・robots・フィード等に eスポーツ 固有の記述があれば削除。

## 制約・非目標
- **反応記事の動画埋め込みは完全維持**（最重要）。埋め込みprovider・embed.ts・EmbedBlockView・detectClipEmbedBlocksは不変。
- 逐語維持。新規依存なし。他ソース・他カテゴリは不変。
- 既存DBに clip 由来記事や eスポーツ カテゴリ記事が残っていても表示が壊れないこと（カテゴリ未知時の
  フォールバック表示は既存の仕組みで担保。必要なら確認）。ただし新規生成では clip/eスポーツ は作られない。

## テスト（必須・実API/実ネット非依存）
1. `getAllAdapters` に clip アダプタが含まれない（5ch/reddit/riot のみ）。
2. `CATEGORY_LABELS`/`CATEGORY_SLUGS` に eスポーツ/esports が無い（3カテゴリ）。`CATEGORY_BY_SOURCE` に clip が無い。
3. `SourceType` に "clip" が無く、tsc が通る（型レベルで clip 参照が残っていない）。
4. **回帰（最重要）**: 反応記事（5ch/reddit）本文中のYouTube/Twitch URLが従来どおり embed ブロックとして
   埋め込まれる（`detectClipEmbedBlocks`／composeReactionBody の埋め込みが不変）。
5. 既存の collection/compose/sitemap/categories テストが新仕様（clip/eスポーツ削除）に沿って回帰しない
   （clip専用テストは削除、SourceType/カテゴリを列挙するテストは3カテゴリ・3ソースに更新）。

## 受け入れ基準
1. `npx vitest run` 全Green（削除・更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過（clip 参照の型エラーが残らない）。
3. clip 収集ソース・eスポーツ カテゴリが無くなり、反応記事の動画埋め込みは完全に維持される。
4. 新規依存なし・他ソース/カテゴリ不変。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。mock/生成パイプラインが回帰しない（5ch/reddit/riotの記事が従来どおり・
  反応記事の動画埋め込みが従来どおり・コンソールエラー0）。
- eスポーツ カテゴリ・clip ソースが消え、埋め込み機能が残ることがテスト/実機で確認できる。
- 受け入れ基準1〜4を満たす。
