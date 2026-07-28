# 成長G7 — X（旧Twitter）からの情報収集（GetXAPIアダプタ・PoC）＋oEmbed表示・法務配慮

成長提案書(docs/growth-research.md 観点⑦・G7)。5ch/Redditに無い**リアルタイムの国内話題（LJL・配信者・炎上）**をXから最速で拾う。
**発見はAPI（数値operator）、記事化は既存Hotness（数値ルール）**、表示は公式oEmbed埋め込み＋独自論評で著作権の主従を確保。対象: Web。

## 背景・前提
- X収集は未実装。既存の `SourceAdapter` 抽象・`Post`/`PostMetricsHistory`/`HotnessEvaluator`（論争度含むG1）・`persist-posts`・翻訳(reddit経路)を流用できる。
- 低額サードパーティ **GetXAPI** を採用（$0.05/1,000tweets、min_faves対応、$0.10無料クレジット）。フェイルオーバー(TwitterAPI.io)・カレンダートリガは**本スプリントでは非目標**（PoC後）。
- **APIキーは実運用時にユーザーが用意**。本スプリントは **mock/live 切替でキー未設定時はmock（fixture）**で動く形にし、キー取得後に実データ検証する（既存 adapters/index.ts の mock↔live 構造と同じ）。

### GetXAPI 実仕様（Web確認済み・これに従う）
- `GET https://api.getxapi.com/twitter/tweet/advanced_search`
- 認証ヘッダー: `Authorization: Bearer <API_KEY>`
- クエリパラメータ: `q`（検索クエリ。`min_faves:`/`lang:`/`since:`/`until:`/`-filter:retweets` 等のoperatorを**qの中に含める**）・`product`（`Latest`既定 or `Top`）・`cursor`（ページネーション）
- レスポンス: `{ query, tweet_count, has_more, next_cursor, tweets: [ ... ] }`。1ページ最大~20件。
- 各 tweet: `id`, `text`, `url`, `createdAt`, `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `viewCount`, `bookmarkCount`, `isReply`, `inReplyToId`, `conversationId`, `media`(配列), `author`{ `userName`, `id`, `name`, `followers`, `isVerified`, `isBlueVerified` }

## 含まれる機能

### F-G7-1: ソース種別 "x" とカテゴリの追加
- `src/lib/collection/types.ts` の `SOURCE_TYPES` に `"x"` を追加。これに依存する `Record<SourceType, …>`（config・mock登録・`CATEGORY_BY_SOURCE`・hotness既定 `getHotnessConfig`・免除ソース判定など）の**網羅漏れをコンパイラ指摘に従って順に埋める**。
- カテゴリ「**Xの反応**」を新設（`src/lib/categories.ts` の `CategoryLabel`・スラッグ対応 `categorySlugFor`・`CATEGORY_BY_SOURCE` で `x → "Xの反応"`）。既存の空カテゴリ非表示（category-visibility）・nav・sitemap は既存の仕組みに自動で乗る（記事が無ければ非表示）。
- hotness既定（`getHotnessConfig("x")`）: reddit相当を基準に、`min_faves` で発見段階を絞る前提で `minScore`/`minComments` を設定（例: minScore=いいね数の下限、minComments=リプライ数の下限。G1論争度＝replyCount/likeCount比が効く）。**xは論争度に upvote_ratio を持たない**ため comment(=reply)比のみで判定（G1の仕組みに自然に乗る。5chのような無効化はしない＝xはscoreを持つので比が発散しない）。

### F-G7-2: XAdapter（GetXAPI live 実装）
`src/lib/collection/adapters/x.ts`（新規）に `XAdapter implements SourceAdapter`（`sourceType="x"`）:
- `fetchItems()`: env の検索クエリ設定（下記）で `advanced_search` を呼び、`tweets` を `RawCollectionItem` に変換して返す。
  - `externalId = tweet.id`、`sourceUrl = tweet.url`、`content = tweet.text`、`score = tweet.likeCount`、`commentCount = tweet.replyCount`、`author = tweet.author.userName`、`postedAt/fetchedAt = new Date(tweet.createdAt)`、`media = tweet.media`（画像/動画あれば）、`category = "Xの反応"`。
  - `title`: tweet に表題は無いため、**text から先頭一文/要約的な短いタイトルを純ルールで生成**（既存の `gistOf`/`text-utils` があれば流用。捏造しない・textの一部をそのまま短縮）。最終的な記事見出しは既存の `generateHookTitleLLM`（reactionと同じ）に委ねてよい。
  - **リツイート/リプライ由来の薄い投稿を除外**（`-filter:retweets` はクエリ側、`isReply` は変換側でも落とせる）。
- 認証・HTTP: `Authorization: Bearer ${X_API_KEY}`。`fetch`（Node標準）。タイムアウト（AbortSignal, 例: 10s）。**失敗・非2xx・タイムアウトは例外を投げず空配列を返す**（既存アダプタと同方針・本体を止めない）。
- env（`.env.example` にキー名のみ・値は書かない）: `X_API_KEY`（GetXAPIキー）、`X_API_PROVIDER`（既定 `getxapi`。将来 twitterapi.io 追加用）、`X_SEARCH_QUERIES`（省略時は既定クエリ配列を使用）。
- 既定検索クエリ（コスト最小＝当たりだけ・min_favesで課金制御。設定でも上書き可）:
  - 国内: `(LoL OR LJL OR "リーグ・オブ・レジェンド" OR リグオブ) min_faves:100 lang:ja -filter:retweets -filter:replies`
  - 海外パッチ反応: `("League of Legends" OR #LeagueOfLegends OR LoL) min_faves:1000 lang:en -filter:retweets`
  - 重複取得防止に `since:`（前回実行以降）を付けられる形にする（無理なら日次窓でよい。既存のrate-limit/lastRunで足りる範囲で）。
- `fetchMetrics()`（任意）: tweet id からいいね/リプライ再取得（対応が簡単なら。難しければ未実装でよい＝riotと同じく任意）。

### F-G7-3: mock/live 切替と fixture
- `src/lib/collection/adapters/index.ts` の `getAdapter`（mock↔live 切替の1箇所）に `x` を登録。
- **live は `X_API_KEY` 設定時のみ**。未設定なら mock（fixture）にフォールバック（LLMクライアントの mock フォールバックと同思想・無課金で本体を止めない）。
- mock fixture（`src/lib/collection/adapters/__fixtures__` 等の既存慣行に合わせる）は**上記 GetXAPI レスポンス形式に忠実**なサンプル数件（いいね/リプライ数・author・media・日本語/英語tweet）。これで実キー無しでも収集→Post→Hotness→記事化のE2Eがmockで通る。

### F-G7-4: X投稿の表示 — 公式oEmbed埋め込み（著作権の主従確保）
- `src/lib/embed.ts`（既存の埋め込み許可・E22の動画埋め込み基盤）に **X provider** を追加。tweet URL（`x.com`/`twitter.com` の `/status/<id>`）を許可URLとして検証（既存 `isAllowedEmbedUrl` 等に寄せる）し、記事本文に**tweet埋め込みブロック**として出せるようにする。
  - 埋め込みは公式の X 埋め込み（`https://platform.twitter.com/widgets.js` によるblockquote、または oEmbed の HTML）。**CSP/iframe許可**を既存の埋め込み方針の範囲で（外部スクリプト許可が難しければ、`blockquote.twitter-tweet` + widgets.js の遅延読み込み、もしくは最小限「tweet引用（本文短縮）＋出典リンク＋原文へのリンク」で代替してよい。過度に複雑化しない）。
- **著作権・法務（重要）**: tweet全文コピペ・スクショ多用はしない。**独自の見出し・導入・要約を「主」**にし、tweetは**埋め込み or 短い引用＋出典（tweet URL・作者名）明記**を「従」にする（著作権法32条の適法引用＝明瞭区別・主従関係・出典明記）。個人晒し・中傷は既存 `moderation`（NG語・personal-attack）で除去（x経路も必ず moderation を通す）。

## 制約・非目標
- **話題性・記事化判定はAIを使わない数値ルール**（min_favesで発見、Hotness＝likeCount/replyCount/論争度で記事化）。AIは既存どおり本文生成・翻訳・SEOのみ。
- **翻訳は既存reddit経路に合流**（lang:en tweetは既存の反応翻訳、lang:jaは翻訳不要でそのまま扱う）。追加のAI呼び出し種別は増やさない。
- フェイルオーバー(TwitterAPI.io)・2系統冗長化・カレンダートリガ・`fetchContent`（伸び再AI）は**非目標**（PoC後）。新規npm依存なし（fetch標準）。**DBスキーマ変更なし**（既存 Post/PostMetricsHistory・sourceType文字列・category を使う）。
- 秘密（API_KEY）はハードコードせず env 経由。`.env.example` にキー名のみ。live はキー設定時のみ・未設定は mock で無課金。
- 既存ソース（reddit/5ch/riot/riot-news）の挙動は不変。x を足すことで既存の網羅 Record にコンパイルエラーが出たら**既存の意味を壊さず**埋める。

## テスト（必須・実ネット非依存・実APIを叩かない）
1. XAdapter変換: GetXAPIレスポンス（fixture）→ `RawCollectionItem` のマッピング（id/url/text/likeCount→score/replyCount→commentCount/author/createdAt/media/category="Xの反応"）。isReply/リツイートの除外。`fetch` はモック。
2. 失敗系: 非2xx・タイムアウト・不正JSONで例外を投げず空配列を返す。
3. mock/live切替: `X_API_KEY` 未設定で mock（fixture）にフォールバック、設定時に live（fetchモックで検証）。
4. カテゴリ/種別: `SOURCE_TYPES` に x があり、`CATEGORY_BY_SOURCE` が `x→"Xの反応"`、`getHotnessConfig("x")` が妥当な既定を返す。x経路のPostが Hotness（論争度含む）で評価される。
5. oEmbed/埋め込み: tweet URLの許可検証（`x.com`/`twitter.com` の status URL を許可、無関係URLを拒否）。moderation を通ること。
6. 既存の収集/生成/パイプライン/カテゴリ/sitemap テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. `X_API_KEY` 未設定で mock 収集が動き、x投稿が Post 化 → Hotness 判定 → 記事化（カテゴリ「Xの反応」）→ 表示まで mock でE2Eが通る。
3. live 実装が GetXAPI 仕様（GET advanced_search・Bearer・q/product/cursor・tweetsフィールド）に忠実で、失敗時に空配列で本体を止めない。表示はoEmbed埋め込み or 引用＋出典で著作権の主従を確保。
4. 発見・記事化判定にAIを使わない・翻訳は既存経路合流・新規依存なし・DBスキーマ変更なし・秘密はenv経由・既存ソース挙動不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- mockでx収集→Post→Hotness→記事化→表示（埋め込み/引用＋出典）のE2Eが確認できる。実APIは叩かない（キー未設定でmock）。
- X投稿表示が著作権の主従（独自論評が主・埋め込み/短い引用＋出典が従）を満たし、moderationを通る。
- 受け入れ基準1〜4を満たす。実キーでの本番PoC検証は本スプリント後にユーザーのキー設定を待って別途行う（本スプリントの合否には含めない）。
