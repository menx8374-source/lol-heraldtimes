# 拡張スプリント E17: YouTube/Twitch クリップ収集（新ソース種別 clip・埋め込み紹介記事）

対象プラットフォーム: web（既存アーキテクチャに従う）／フェーズ2「実データ収集の本接続」第3弾。

## 背景・スコープ
話題の LoL クリップ（YouTube 動画・Twitch クリップ）を「**埋め込み紹介**」として収集・記事化する。
逐語転載ではなく**動画の紹介＋埋め込み**なので比較的安全。既存の3ソース（reddit/5ch/riot）に対し、
本スプリントで**新しいソース種別 `clip`** を追加し、収集→記事化→表示（embed）まで通す。

## 設計方針（重要）
- **新ソース種別 `clip`** を `SourceType` に追加（`"reddit" | "5ch" | "riot" | "clip"`）。YouTube と Twitch を
  1つの `ClipAdapter`（`sourceType:"clip"`）が両方から取得してまとめて返す（それぞれのキーは任意・独立に）。
- **記事化は「埋め込み紹介」形式**（reaction でも fact でもない新形式）: 見出し＋短い紹介文（LLM=GENERATION_MODEに従う。mockでも成立）＋**embedブロック**（`src/lib/article-body.ts` の `embed` 型・provider は `youtube`/`clip`）＋出典リンク。逐語本文の羅列はしない。
- **新カテゴリ「動画・クリップ」** を追加し、収集した clip 記事はこのカテゴリに入れる。ナビ・カテゴリ一覧・sitemap 等に自然に載るようにする。
- 埋め込みは既存方針どおり**実際のiframe/スクリプトは読み込まず、プレースホルダーカード＋元URLリンク**（`article-body-view.tsx` の `EmbedBlockView`。著作権/CSP/SSRF回避）。本番で実埋め込みに切り替える余地は残す。

## 含まれる機能

### F-E17-1: Clip live アダプタ（YouTube＋Twitch）
- `ClipAdapter implements SourceAdapter`（`sourceType:"clip"`）を新設。**共通の `adapters/http.ts`（`fetchJsonSafe`）を使う**（E16で抽出済み）。
- **YouTube**: YouTube Data API v3（`https://www.googleapis.com/youtube/v3/search` 等）でLoL関連の人気/新着動画を検索。env `YOUTUBE_API_KEY`（秘密）。`sourceUrl`=`https://www.youtube.com/watch?v=<id>`（動画ごとに一意）、`title`=動画タイトル、`content`=説明（description）冒頭＋チャンネル名等の紹介文、`fetchedAt`=publishedAt。
- **Twitch**: Twitch API（app access token = client_credentials → `https://api.twitch.tv/helix/clips` 等でLoLゲームの人気クリップ）。env `TWITCH_CLIENT_ID`・`TWITCH_CLIENT_SECRET`（秘密）。`sourceUrl`=クリップURL（`https://clips.twitch.tv/<slug>` 等・一意）、`title`=クリップタイトル、`content`=配信者/ゲーム名等の紹介文、`fetchedAt`=created_at。
- **キーは各社独立に任意**: YouTubeキーのみ設定ならYouTubeのみ、Twitchキーのみなら Twitch のみ、両方未設定なら**空配列＋スキップログ**（他ソースを止めない）。各fetchの失敗（キー未設定/HTTPエラー/不正JSON/ネット断）は握り潰し（E15/E16と同方針）。シークレットはログに出さない。
- 件数上限は呼び出し側(pipeline)が `config.ts` の clip 用設定（`COLLECTION_CLIP_MAX_ITEMS` 等）で適用。relevance キーワードは既存のLoLキーワードを流用してよい。

### F-E17-2: clip の記事化（compose）＋新カテゴリ
- `src/lib/generation/compose.ts`: `sourceType==="clip"` の分岐を追加し、**埋め込み紹介本文**を組み立てる:
  - 見出し（例「注目クリップ」）＋短い紹介パラグラフ（`askLLM` の kind を1つ足す or 既存kindを流用。mockでも1〜2文で成立）＋**embedブロック**（provider は sourceUrl から判定＝youtube/clip、`src/lib/embed.ts` の許可判定を通す）＋（任意で）出典引用。
  - `QUOTE_SOURCE_LABEL` 等 `Record<SourceType, ...>` になっている箇所に `clip` のエントリを追加（TypeScriptの網羅性で漏れなく）。
- `src/lib/generation/generate-article.ts`: `clip` 由来のカテゴリを **「動画・クリップ」** にマッピング（riot→公式ニュース、5ch→5chの反応、reddit→海外の反応 と同様の追加）。
- カテゴリ定義（`src/lib/categories.ts` の `CATEGORY_LABELS`/`categorySlugFor`/色等）に「動画・クリップ」を追加し、ヘッダーナビ・カテゴリページ・sitemapに自然に出るようにする。カテゴリの英字slugは既存規約に合わせる（例 `clips`）。
- embed の provider 判定・表示（`article-body.ts`/`embed.ts`/`article-body-view.tsx`）は既存の仕組みを流用（新規の危険な描画経路を作らない・`dangerouslySetInnerHTML`は使わない）。

### F-E17-3: live レジストリ・config・env
- `LIVE_ADAPTER_FACTORIES` に `clip: () => new ClipAdapter()` を追加（`getAllAdapters("live")`=riot+reddit+clip、5chはスキップ）。mockは従来どおり。
- `config.ts` の `getDefaultSourceConfigs()` に `clip` の設定を追加（`COLLECTION_CLIP_MAX_ITEMS`・`COLLECTION_CLIP_MIN_INTERVAL_MS`、relevanceキーワード）。`SOURCE_TYPES` 等 SourceType を列挙している箇所に `clip` を追加。
- mock 用に `fixtures/clip.json` を追加し、`MockSourceAdapter` が clip も返せるようにする（mockモードで clip 記事が生成・表示できるように）。
- `.env.example`（`YOUTUBE_API_KEY`・`TWITCH_CLIENT_ID`・`TWITCH_CLIENT_SECRET` をキー名のみ）・README・architecture.md を最小限更新。

## 実装原則（CLAUDE.md）
- テスト必須(TDD-lite): `global.fetch` をモックし、(a) YouTube検索/Twitchクリップの取得→`RawCollectionItem`整形（sourceUrl一意・publishedAt/created_at→Date）、(b) 各社キー独立の任意性（片方のみ設定/両方未設定→空＋スキップログ）、(c) 失敗握り潰し、(d) compose の clip→embed本文（embedブロックが生成され provider が正しい）、(e) clip→カテゴリ「動画・クリップ」マッピング、を検証。実ネットに出ない。純関数に切り出す。**SourceType 追加で `Record<SourceType,...>` の網羅漏れが tsc で出ないこと。**
- **新規依存を追加しない**（Node標準 `fetch`・既存embed機構）。**シークレットのハードコード/ログ出力禁止**。既存パイプライン契約・E15/E16・mock全テストGreenを維持。
- 自己確認で起動したものは自己評価レポート作成前に停止。DBを汚したら `npm run db:seed` で戻す。

## 受け入れ基準（検証可能・原文）
- [ ] `SourceType` に `clip` が追加され、`ClipAdapter` が YouTube/Twitch から（キーがある方だけでも）クリップを `RawCollectionItem[]` で返す（fetchモック検証）。sourceUrl は動画/クリップURLで一意。
- [ ] YouTube/Twitch のキーが各社独立に任意で、両方未設定なら空＋スキップログ（他ソース・全体を止めない）。失敗は握り潰し。シークレットはコード/ログに出ない。
- [ ] clip 由来アイテムが「動画・クリップ」カテゴリの**埋め込み紹介記事**（見出し＋紹介文＋embedブロック＋出典）として生成され、記事ページで既存の embed プレースホルダー表示になる（実iframeは読み込まない）。
- [ ] 新カテゴリ「動画・クリップ」がナビ・カテゴリ一覧・sitemap に自然に出る。既存カテゴリ・記事に回帰なし。
- [ ] `getAllAdapters("live")`=riot+reddit+clip、5chスキップ。mockモードは clip も含め従来どおり（`fixtures/clip.json`）。
- [ ] `npm test` 全てGreen（fetchモックのオフラインテスト）。tsc/build/eslint通過。新規依存なし。

## 評価基準（evaluator向け）
- 致命的バグ0件／コンソール・実行エラー0件／上記受け入れ基準の充足率100%／テストGreen。1つでも下回れば全体FAIL。
- **実ネット確認は任意**（YouTube/Twitchキーが評価環境に無いのが通常）。無い場合は「検証モード: フィクスチャ＋mock」と明記し、fetchモックテストGreen＋キー未設定時グレースフル＋**mockモードで clip 記事が「動画・クリップ」カテゴリに生成・表示される**ことをPlaywright等で確認してPASS可（キー不在はFAIL根拠にしない）。riot(E15)・reddit(E16) の回帰が無いこと。
- 画面（新カテゴリ・clip記事のembed表示）が絡むので、mockモードで `npm run db:seed`＋`npm run pipeline`（or seed に clip 記事を含める）→ Playwright でカテゴリ「動画・クリップ」と clip 記事のembedプレースホルダー表示を確認し、プレビュー画像を保存。
