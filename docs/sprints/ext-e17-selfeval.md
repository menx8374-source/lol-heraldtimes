---
tags: [sprint-selfeval]
sprint: E17
---

# Sprint E17 自己評価レポート

## 実装した内容
- `src/lib/collection/types.ts`: `SourceType` に `"clip"` を追加。
- `src/lib/collection/adapters/clip.ts`（新規）: `ClipAdapter implements SourceAdapter`（`sourceType:"clip"`）。
  - YouTube: `GET https://www.googleapis.com/youtube/v3/search`（`YOUTUBE_API_KEY`、クエリ固定 "League of Legends"）。`sourceUrl`=`https://www.youtube.com/watch?v=<videoId>`、`title`=動画タイトル、`content`=説明冒頭(200字)＋チャンネル名、`fetchedAt`=`publishedAt`。
  - Twitch: `POST https://id.twitch.tv/oauth2/token`（client_credentials）→`GET https://api.twitch.tv/helix/clips?game_id=21779`（`Client-Id`/`Bearer`）。`sourceUrl`=クリップURL、`title`=クリップタイトル、`content`=配信者名を含む紹介文、`fetchedAt`=`created_at`。
  - YouTube/Twitchの各キーは独立に任意（片方のみ設定ならその社のみ、両方未設定なら空配列＋スキップログを1件ずつ）。各fetch失敗（キー未設定/HTTPエラー/不正JSON/ネットワーク断）は握り潰し例外を投げない。`fetchItems()`内でsourceUrlのSetによるローカル重複排除も実施。純関数（`buildYouTubeItem`/`extractYouTubeItems`/`buildTwitchItem`/`extractTwitchItems`/URL構築関数）に分離。
- `src/lib/generation/compose.ts`: `sourceType==="clip"` 分岐 `composeClipBody` を追加。「注目クリップ」見出し＋askLLM(`clip-intro`)の短い紹介文（1〜2文）＋`sourceUrl`から`embedProviderForUrl`でprovider判定（youtube/clip=Twitch想定）し`isAllowedEmbedUrl`通過時のみembedブロックを追加。`GenerationCandidateInput`に`sourceUrl?: string`を追加（clip専用、他ソースは未使用）。`QUOTE_SOURCE_LABEL`に`clip`エントリ追加。
- `src/lib/generation/llm-client.ts`: `GenerationTask`に`{ kind: "clip-intro"; title; hint }`を追加、`MockLLMClient`用テンプレート`renderClipIntro`を実装。
- `src/lib/generation/generate-article.ts`: `CATEGORY_BY_SOURCE.clip="動画・クリップ"`、`ARTICLE_SOURCE_LABEL.clip="YouTube/Twitch"`。受け入れ基準の検証ロジックを`isReactionFormat`(5ch/reddit)・`isClipFormat`(clip、embedブロック1件以上を最低条件)・fact形式(riot、従来の300字/逐語/引用比率チェック)の3分岐に整理。
- `src/lib/categories.ts`: 新カテゴリ「動画・クリップ」（`CATEGORY_GRADIENTS`に`from-red-600 to-red-800`、`CATEGORY_SLUGS`に`clips`）を追加。ナビ（`site-header.tsx`）・カテゴリ一覧・サムネイル色・sitemapは`CATEGORY_LABELS`駆動のため自動反映。
- `src/lib/collection/config.ts`: `getDefaultSourceConfigs()`に`clip`設定（`COLLECTION_CLIP_MAX_ITEMS`既定10・`COLLECTION_CLIP_MIN_INTERVAL_MS`既定30分）を追加。
- `src/lib/collection/adapters/index.ts`: `SOURCE_TYPES`に`"clip"`追加、`LIVE_ADAPTER_FACTORIES.clip = () => new ClipAdapter()`追加（`getAllAdapters("live")`=riot+reddit+clip、5chスキップ）。
- `src/lib/collection/adapters/mock.ts`＋`src/lib/collection/fixtures/clip.json`（新規、3件・YouTube2件+Twitch1件、LoLキーワード一致タイトル）: `MockSourceAdapter`がclipもfixtureから返す。
- `.env.example`/`README.md`: `YOUTUBE_API_KEY`/`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`（キー名のみ）・`COLLECTION_CLIP_MAX_ITEMS`/`COLLECTION_CLIP_MIN_INTERVAL_MS`を追記。
- `docs/spec/lol-matome-sokuhou-architecture.md`: 「収集アダプタ構造」にclip（拡張E17）の決定を追記。

## 技術選定（該当する場合のみ）
- 新規依存ライブラリなし（Node標準`fetch`・既存の`SourceAdapter`/`LLMClient`/embed機構を流用）。E15/E16と同じ「1社のキー未設定は握り潰してその社だけスキップ」方針をYouTube/Twitchの2社に個別適用。
- Twitchの「League of Legends」game_id（`21779`）はTwitch公開情報のためコード内定数として直書き（秘密情報ではない）。

## 受け入れ基準チェック（自己申告）
- [x] `SourceType`に`clip`追加、`ClipAdapter`がYouTube/Twitchから（キーがある方だけでも）`RawCollectionItem[]`を返す（fetchモック検証）。sourceUrlは動画/クリップURLで一意（アダプタ内Setで重複排除もテスト済み）。
- [x] YouTube/Twitchキーが各社独立に任意、両方未設定なら空配列＋スキップログ2件（他ソース停止なし）。失敗握り潰し。シークレット（APIキー・client_secret・アクセストークン）はコード/ログ双方に出ない（ログはURL・件数等の非秘密情報のみ）。
- [x] clip由来アイテムが「動画・クリップ」カテゴリの埋め込み紹介記事（見出し＋紹介文＋embedブロック）として生成され、記事ページで既存のembedプレースホルダー表示になる（実iframe読み込みなし）。mockパイプラインで3件とも生成・DB確認・ブラウザ表示確認済み（下記参照）。
- [x] 新カテゴリ「動画・クリップ」がナビ・カテゴリ一覧・sitemapに自然に出る（`CATEGORY_LABELS`駆動のため自動反映、実機確認済み）。既存カテゴリ・記事に回帰なし（全607テストGreen）。
- [x] `getAllAdapters("live")`=riot+reddit+clip（3件）、5chスキップ。mockモードはclip含め4ソース従来どおり（`fixtures/clip.json`）。
- [x] `npm test`全Green。tsc/build/eslint通過。新規依存なし。

## アプリの起動方法
- テスト: `npm test`（vitest）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build` → `npm run start`（http://localhost:3000）
- Lint: `npx eslint .`
- mock動作確認手順（実施・完了後はDBを復元済み）: `npm run db:seed` → `npm run collect`（`[clip] success: fetched=3 saved=3`を確認）→ `npm run pipeline`（キュー枯渇まで複数回）→ `npm run start` で `/category/clips` に「動画・クリップ」記事が表示され、記事内embedブロックがプレースホルダー（「※埋め込みは本番接続時に表示されます」）表示になることをcurlで確認。確認後 `collectedItem`/`sourceFetchLog` を空に戻し、`npm run db:seed` でArticle系を再投入済み（サーバーも停止済み）。

## 既知の問題・懸念点
- 実ライブ稼働（実際のYouTube/Twitchキーでの疎通）は未検証。運営者が`YOUTUBE_API_KEY`・`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`を`.env`に設定後、`COLLECTION_MODE=live npm run collect`で別途確認する必要がある。
- YouTube検索クエリは固定文字列"League of Legends"のみ（DEFAULT_LOL_KEYWORDSのような複数キーワードのOR検索やお気に入りチャンネル限定等は未実装。件数上限・relevanceフィルタは既存pipeline側のconfig/filter.tsが適用）。
- Twitchのgame_id（21779）は既知の公開値を定数として使用。Twitch側でIDが変更された場合は要更新（可能性は低い）。
- clip記事のembed provider判定はホスト名ベースの単純ルール（youtube.com系→youtube、それ以外→clip）。sourceUrlが将来的にTwitch VOD等の別ホストへ広がる場合は`embed.ts`のホワイトリストとあわせて要拡張。

## 追加したテスト（任意）
- `src/lib/__tests__/collection-clip.test.ts`（新規）: 純関数（YouTube/Twitchの URL構築・item整形・抽出）の単体テスト＋`ClipAdapter.fetchItems`の結合テスト（両社成功・YouTubeのみ・Twitchのみ・両方未設定＋スキップログ2件・各HTTPエラー・ネットワーク断・重複排除）。全てfetchモック、実ネットに出ない。
- `src/lib/__tests__/generation-compose.test.ts`（既存に追記）: clip由来（YouTube URL・Twitch URL）でembedブロックのproviderが正しく判定されることを検証。
- `src/lib/__tests__/generation-generate-article.test.ts`（既存に追記）: clip由来でカテゴリ「動画・クリップ」・embedブロック必須・300字未満でもGenerationErrorにならないことを検証。
- `src/lib/__tests__/collection-adapters-registry.test.ts`（既存を更新）: clip liveがClipAdapterを返すこと・`getAllAdapters("live")`が3件（riot+reddit+clip）・mockが4件になることを検証するよう更新。

### テスト結果（実数）
- `npm test`: 68 test files / 607 tests 全てpassed。
- `npx tsc --noEmit`: エラーなし。
- `npm run build`: 成功（Next.js本番ビルド）。
- `npx eslint .`: エラー0件（既存の無関係な警告1件のみ、本スプリント変更ファイルではない）。

## 関連ドキュメント
- [[ext-e17-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
