# 拡張E46 — Reddit収集をArctic Shiftに切替（OP＋上位コメントで海外の反応記事を実データ化）

運用フィードバック起点。対象: Web（バックエンド収集）。

## 背景（なぜ・検証経緯）
現行 `reddit.ts` は公式OAuth（`REDDIT_CLIENT_ID/SECRET/USER_AGENT`）依存でキー未設定＝常に空、かつ投稿本文のみ
でコメント無し＝弱い。無認証の公式JSONは403、RSSはレート制限が厳しく無人運用に不向き（検証済み）。
無料サードパーティを実検証した結果:
- **PullPush**: データが約14か月古く（最新投稿が433日前）→ 最近の反応に使えず**不採用**。
- **Arctic Shift**（`arctic-shift.photon-reddit.com`・無認証・無料）: **最新データあり**。ただしスコアはAPI側で
  ソート/絞込できず（`created_utc`順のみ）、かつ作成直後はスコアが未反映で**2日程度でバックフィル**される特性。
  → **「2〜4日前の投稿」を取得しクライアント側でスコア順に選抜**すれば、最近の人気スレ＋上位コメント（実際の反応）
  が取れることを実データで確認（人気スレ score 697/470、上位コメント score 54/25 等）。**Arctic Shift を採用**。

翻訳（日本語訳＋原文併記）は次スプリント(E47)。本スプリントは英語のまま実データ化する。

## Arctic Shift API（確認済みの実仕様）
- 投稿検索: `GET https://arctic-shift.photon-reddit.com/api/posts/search`
  パラメータ: `subreddit`, `after`(ISO日時 or epoch), `before`, `limit`(1-100), `sort`(asc|desc＝created_utc順のみ)。
  レスポンス: `{ data: [ { id, title, selftext, permalink, created_utc, score, num_comments, stickied, over_18, thumbnail, preview, url, author } ] }`
- コメント検索: `GET .../api/comments/search?link_id=<id>&limit=100&sort=desc`
  レスポンス: `{ data: [ { id, body, score, author, created_utc, link_id } ] }`
- レート: 「1秒に数回程度なら問題なし」。User-Agent を付ける。スコア順・min_score は無いのでクライアント側で行う。

## 含まれる機能

### F-E46-1: Arctic Shift データソースへの切替（reddit.ts の全面書き換え）
- 公式OAuth（TOKEN_URL/oauth.reddit.com/クレデンシャル分岐）を廃し、**Arctic Shift REST（キー不要）**を使う。
- **投稿取得と選抜**（純関数でテスト可能に）:
  - 取得窓: `after = now - REDDIT_MAX_AGE_DAYS日`（既定4）、`before = now - REDDIT_MIN_AGE_DAYS日`（既定2）。
    ISO日時文字列で渡す。`now` はテスト注入可能に。`limit=100&sort=desc`。
  - 選抜（純関数）: `stickied`除外・`over_18`除外・タイトルが関連キーワード一致（`config`のreddit keywords）・
    `score >= REDDIT_MIN_SCORE`（既定50）。**score 降順**にソートし上位 `REDDIT_MAX_THREADS`（既定5）件。
- **コメント取得と整形**（純関数）:
  - `link_id=<投稿id>&limit=100&sort=desc` で取得し、`[deleted]`/`[removed]`/空/`AutoModerator` を除外、
    **score 降順**で上位 `REDDIT_MAX_COMMENTS`（既定20）件。
- **スレッドダンプ content の構築**（純関数・`parseThreadReses` が解釈する `N: 本文\n\n…` 形式）:
  - レス1 = OP（`title` ＋ `selftext` があれば冒頭抜粋。長すぎる場合は有界化）。
  - レス2.. = 上位コメント（`body` を逐語。改行保持）。
  - reddit は 5ch の `>>N` アンカーが無いためフラット一覧でよい（E43クラスタfallbackはアンカー皆無→全件上限付き、E41はno-op）。
- **RawCollectionItem**: sourceUrl = `https://www.reddit.com<permalink>`（permalink無ければ `.../comments/<id>`）、
  title = 投稿タイトル、content = スレッドダンプ、imageUrl = 既存 `extractRedditImageUrl` 相当
  （`preview.images[0].source.url`(&amp;復号)→`thumbnail`(http実画像)→ null）、fetchedAt = `created_utc*1000`。
- **信頼境界・作法**: `fetchJsonSafe`（タイムアウト付き）。全失敗（HTTP/JSON/ネット断）は例外を投げず空配列。
  リクエスト間に**ディレイ**（`REDDIT_REQUEST_DELAY_MS` 既定1000・最初のfetch前は省略）、投稿一覧→各スレのコメント順に直列。
  `delayMs`/`sleep` はテスト注入可能に（実待機しない）。**キー不要**（OAuth未設定スキップは撤去、常に試行）。
  User-Agent（説明的な既定・`REDDIT_USER_AGENT` で上書き可）を付ける。
- **可観測性**: `[reddit] sub=leagueoflegends fetched=.. relevant=.. selected=.. collected=..` を1行ログ。

### F-E46-2: 設定・env の更新（config.ts / .env.example）
- `config.ts` の reddit 設定（allowedSubreddits=leagueoflegends・keywords）はそのまま。件数/期間/スコアの調整用に
  `REDDIT_MIN_AGE_DAYS`/`REDDIT_MAX_AGE_DAYS`/`REDDIT_MIN_SCORE`/`REDDIT_MAX_THREADS`/`REDDIT_MAX_COMMENTS`/
  `REDDIT_REQUEST_DELAY_MS`/`REDDIT_USER_AGENT` を env で上書き可能に（無ければ既定）。
- `.env.example` から旧 `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`（OAuth用・不要）を削除。Arctic Shift はキー不要である旨と
  上記チューニングenv（任意）をコメントで記載。

## 制約・非目標
- **翻訳はE47**（本スプリントは英語のまま逐語ダンプ＝実データでreddit反応記事が出ることが目標）。
- 5ch/riot・NG・強調色・サムネ表示・埋め込み（反応本文中URL→embedは従来どおり効く）には触れない。新規npm依存なし。
- reddit content は信頼できないユーザー生成テキストとして content 文字列に入れるのみ（HTML解釈経路に入れない）。逐語維持。

## テスト（必須・実API/実ネット非依存＝fixture/注入）
1. 投稿選抜（純関数）: fixtureのposts配列から、キーワード一致・score下限・sticky/NSFW除外・score降順・件数上限が効く。
2. コメント整形（純関数）: `[deleted]`/`[removed]`/空/AutoModerator除外・score降順・件数上限。
3. スレッドダンプ構築（純関数）: OP(res1)＋コメント(res2..)が `N: 本文` 形式で `parseThreadReses` により正しくレス配列に戻る。逐語維持。
4. RawCollectionItem生成: sourceUrl(絶対URL)/title/content(ダンプ)/imageUrl(preview→thumbnail→null)/fetchedAt を正しく生成。
5. 取得窓: `now`注入で after/before が「2〜4日前」相当のISO日時になる（境界の計算が正しい）。
6. ディレイ: `sleep`注入で連続fetch間に呼ばれる（`delayMs:0`+noopで実待機なし）。
7. アダプタ全体（fetch注入/fixture）: posts→comments→RawCollectionItem[] を生成。全失敗時は空配列（例外なし）。
8. 既存 reddit テスト（OAuth前提）は Arctic Shift 前提に更新。パイプライン/生成テストが回帰しない（reddit反応記事が5ch同様に組める）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. Reddit収集がArctic Shift（キー不要）で「最近の人気スレOP＋上位コメント」の反応まとめ記事を実データで生成できる
   （英語のまま・翻訳はE47）。逐語維持・新規依存なし・作法（ディレイ/直列）・可観測性ログ・グレースフル失敗。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- Arctic Shift由来のRawCollectionItem（OP＋コメントのダンプ）が反応記事(5ch同様)として組めることがテスト/データで確認できる。
- 受け入れ基準1〜3を満たす。
