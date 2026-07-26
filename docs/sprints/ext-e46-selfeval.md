---
tags: [sprint-selfeval]
sprint: E46
---

# 拡張E46 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/reddit.ts` を全面書き換え。公式OAuth（TOKEN_URL/oauth.reddit.com/クレデンシャル分岐）を廃し、Arctic Shift REST（`arctic-shift.photon-reddit.com`・キー不要）に切替。
  - 取得窓計算 `computeFetchWindow(now, minAgeDays, maxAgeDays)`（純関数・`now`注入可）: after=now-maxAgeDays日、before=now-minAgeDays日をISO文字列で算出。
  - 投稿選抜 `selectRelevantPosts`/`matchKeywordPosts`（純関数）: stickied/over_18除外→タイトルkeyword一致→score下限→score降順→上位N件。
  - コメント整形 `selectTopComments`（純関数）: `[deleted]`/`[removed]`/空/AutoModerator除外→score降順→上位N件。
  - スレッドダンプ構築 `buildRedditThreadDump`（純関数）: レス1=OP（title＋selftext冒頭抜粋・500文字で有界化）、レス2..=上位コメントbody逐語。`parseThreadReses`が正しく解釈できることをテストで確認。
  - `buildRedditItem`: RawCollectionItem生成（sourceUrl=`buildPostUrl`（permalink優先・無ければ`.../comments/<id>`）、imageUrl=既存`extractRedditImageUrl`ロジックを踏襲、fetchedAt=`created_utc*1000`）。
  - `RedditAdapter`: 投稿検索→(選抜した各投稿の)コメント検索の順に直列。`fetchJsonSafe`によるタイムアウト付き取得・全失敗は例外を投げず空配列。リクエスト間ディレイ（既定1000ms・`delayMs`/`sleep`注入可・最初のfetch前は省略、5chアダプタと同型）。User-Agent付与（既定UA・`REDDIT_USER_AGENT`で上書き可）。キー不要（クレデンシャル分岐を撤去し常に試行）。per-subreddit可観測性ログ `[reddit] sub=.. fetched=.. relevant=.. selected=.. collected=..` を1行出力。
- `.env.example`: 旧`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`（OAuth用）を削除。Arctic Shiftはキー不要である旨と`REDDIT_USER_AGENT`/`REDDIT_MIN_AGE_DAYS`/`REDDIT_MAX_AGE_DAYS`/`REDDIT_MIN_SCORE`/`REDDIT_MAX_THREADS`/`REDDIT_MAX_COMMENTS`/`REDDIT_REQUEST_DELAY_MS`（すべて任意・既定値あり）をコメント記載。
- `docs/spec/lol-matome-sokuhou-architecture.md`: reddit本接続の技術選定行を「E16 OAuth」から「E46 Arctic Shift」の決定に上書き（追記ではなく置換）。
- `src/lib/__tests__/collection-reddit.test.ts`: OAuth前提のテストをArctic Shift前提に全面更新（下記「追加したテスト」参照）。

## 技術選定
- Arctic Shift（無認証サードパーティREST）を採用。ブリーフに記載の検証経緯（公式OAuth=常に空/コメント無し、無認証公式JSON=403、RSS=レート制限厳、PullPush=データ約14か月古く不採用）に基づく既定路線。新規npm依存なし（既存`fetchJsonSafe`を再利用）。運用コスト: 無料（追加費用なし）。`config.ts`の`getDefaultSourceConfigs`は既存のreddit設定（allowedSubreddits/keywords）をそのまま流用し変更なし。チューニングenv（`REDDIT_MIN_AGE_DAYS`等）は5chアダプタ（`FIVECH_MIN_RES_COUNT`等）と同じ流儀でアダプタ内に直接実装し、`config.ts`には追加していない（既存の設計パターンに合わせた）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（865 tests / 75 files、reddit関連21件含む）。実API/実ネット非依存（fetch/sleep/nowをすべて注入したfixtureベース）。
- [x] 基準2: `npx tsc --noEmit` エラーなし。`npm run build` 成功（Next.js 16、全ルート生成成功）。`npm run lint` エラー0（既存の無関係な警告5件のみ、reddit変更由来の警告なし）。
- [x] 基準3: Reddit収集はArctic Shift（キー不要）の投稿検索→コメント検索の2段構成で「OP＋上位コメント」のスレッドダンプ（英語のまま。翻訳はE47未着手）を生成する。逐語維持（コメントbodyは書き換えず選定・整形のみ）・新規依存なし・ディレイ/直列の作法・可観測性ログ・グレースフル失敗（HTTPエラー/不正JSON/ネット断いずれも空配列）をテストで確認済み。実Arctic Shift APIに対する実ネット疎通は本スプリントでは未実施（テストはすべてfetch注入のfixtureベース）。

## アプリの起動方法
- 本スプリントは収集ロジック（`src/lib/collection/adapters/reddit.ts`）のみの変更で、UI/サーバー起動は不要。
- 検証コマンド: `npx vitest run`（テスト）／`npx tsc --noEmit`（型チェック）／`npm run build`（ビルド）／`npm run lint`（lint）。
- 実際のArctic Shift接続を試す場合（任意・本スプリントでは未実施）: `COLLECTION_MODE=live` を設定し `npm run collect` 等の既存収集スクリプトを実行（`adapters/index.ts`の`getAdapter("reddit","live")`が本アダプタを返す）。

## 既知の問題・懸念点
- 実Arctic Shiftエンドポイントへの実ネット疎通確認は今回未実施（ブリーフ記載の検証はplanner/architect側の事前検証として実施済みとされているものを踏襲し、本スプリントはfixture/fetch注入によるロジック検証のみ）。本番運用開始前に一度 `COLLECTION_MODE=live` での実疎通確認を推奨。
- OP本文の抜粋長（500文字）・取得窓（2〜4日）・スコア閾値（50）等の既定値はブリーフの検証結果に基づく初期値。実運用データを見て`REDDIT_MIN_SCORE`等のenvで調整の余地あり。
- 翻訳（日本語訳＋原文併記）は次スプリントE47のスコープのため未実装（本スプリントは意図的に英語のまま）。

## 追加したテスト
- `computeFetchWindow`: nowから2〜4日前相当のISO日時算出（境界計算）。
- `selectRelevantPosts`/`matchKeywordPosts`: stickied/over_18除外・キーワード一致・score下限・score降順・件数上限。
- `selectTopComments`: [deleted]/[removed]/空/AutoModerator除外・score降順・件数上限。
- `buildRedditThreadDump`: OP(res1)+コメント(res2..)が`parseThreadReses`で正しくレス配列に戻ることを検証（逐語維持含む）。
- `buildRedditItem`/`buildPostUrl`/`extractRedditImageUrl`: sourceUrl(permalink優先/フォールバック)・title・content(ダンプ)・imageUrl(preview→thumbnail→null)・fetchedAtの生成。
- `RedditAdapter.fetchItems`: 投稿検索→コメント検索の直列呼び出し・ディレイ(sleep注入)・HTTPエラー/不正JSON/ネット断時の空配列グレースフル・コメント検索のみ失敗時はOPのみのアイテム生成・重複排除・対象サブレディット無し時のスキップログ。

## 関連ドキュメント
- [[ext-e46-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
