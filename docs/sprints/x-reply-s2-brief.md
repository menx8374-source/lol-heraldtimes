# X-reply-S2 — 親ポストのリプライ/引用を取得しPost.mediaに保存＋candidate配線（表示はS3・スキーマ変更なし）

Opus5設計のS2。S3の表示刷新（元ポスト埋め込み＋リプライ/引用をレス化）に必要な**データ配管**を作る。**この時点では記事の見た目は変えない**（データを保存・candidateへ載せるだけ）。**スキーマ変更なし**（既存 `Post.media` のJSONに格納）。**コスト安全設計必須**（hot確定してAI記事化する親Xポストだけ遅延取得・opt-in・キー無しで$0）。

ユーザー決定: **引用ツイートも取り込む**（X_QUOTES_MODE 既定on）／**X_REPLIES_MODE 既定on**。

## 背景（設計の要点）
- GetXAPI `advanced_search` の operator でリプライ/引用を取得できる（確証あり）:
  - リプライ: `conversation_id:<親tweetId>`（そのスレの返信）
  - 引用: `quoted_tweet_id:<親tweetId>`
  - `conversation_id:` は投稿から概ね7日で検索から落ちる制約あり（新着hotが対象なので実害小）。取得0件でも本体は止めない。
- 取得は**収集時に全ツイート分やらない**。post-pipelineで**hot判定を通ってAI記事化する親Xポストだけ**遅延fetchする（コスト最小）。
- 既存 `Post.media` は `{imageUrl,url,html,patchPreview}` を運ぶ確立パターンで、`extractPostImageUrl`/`extractPostHtml`/`extractPostPatchPreview` と同型の extractor を1つ足すだけで拡張できる。

## 含まれる機能

### F-XR2-1: リプライ/引用取得（x.ts）
- `x.ts` に **`fetchTopReplies(parentTweetId, apiKey, opts)`** を追加:
  - `advanced_search?q=conversation_id:<id> -filter:retweets&product=Top` で1ページ取得（既存 `fetchTweetsForQuery`/`buildAdvancedSearchUrl` を流用）。
  - **X_QUOTES_MODE on のとき**、`quoted_tweet_id:<id>` でも1ページ取得しマージ（+1コール）。off なら引用は取らない。
  - 取得したtweetを **`XReplyItem`** に変換: `{ id, text, author(＝userName), likeCount, replyCount, quoteCount, url, lang?, isQuote }`（`isQuote` はconversation由来=false / quoted_tweet_id由来=true）。親ツイート自身（id===parentId）は除外。空text/欠落は捨てる。
  - **評価順に整列し上限 `X_REPLIES_MAX`（既定8）件**で打ち切る（`likeCount` 降順、同点は `replyCount` 降順）。リプライと引用を合わせて上限8。
  - **失敗・タイムアウト・キー無し・0件は空配列**を返す（本体を止めない。既存 `fetchTweetsForQuery` のtry/catch・loggerを踏襲）。
  - URL/クエリ組み立ては純関数に切り出しテスト可能に（`buildRepliesQuery`/等）。

### F-XR2-2: Post.mediaへ保存＋extractor（post-pipeline.ts / persist）
- 既存の `Post.media`（JSON）に **`xReplies: XReplyItem[]`** を格納できるようにする（キー追加のみ・スキーマ変更なし）。
- `extractPostXReplies(media): XReplyItem[]` を追加（`extractPostImageUrl` 等と同ファイル/同型）。**DB読み出し時に防御的検証**（配列か・各要素の必須フィールド型・件数上限）。不正要素は捨てる（記事を壊さない）。
- **遅延fetch＆保存の配線（post-pipeline.ts）**: hot選定を通り**AI記事化する対象**の Post が `sourceType==="x"` のとき、次を全て満たせばリプライ/引用を取得して `Post.media.xReplies` に保存し、candidateにも載せる:
  - `X_REPLIES_MODE` が on（既定on）
  - `X_API_KEY` が設定されている（未設定ならfetchしない＝$0・xRepliesは空）
  - （任意の軽量ガード）既に `Post.media.xReplies` が保存済みならre-fetchしない（重複課金防止・in-place更新時）
- 取得結果を `prisma.post.update` で `media` にマージ保存（既存mediaの他キー: imageUrl/url/html/patchPreview を壊さない）。

### F-XR2-3: candidateへ配線（generate-article.ts / post-pipeline.ts）
- `GenerationCandidate`（`generate-article.ts`）に **`xReplies?: XReplyItem[]`** を追加（`author`/`html` と同じ任意フィールド）。
- post-pipeline の candidate 組み立てで `xReplies: extractPostXReplies(post.media)`（fetch直後は取得結果、既存記事更新時はmediaから）を配線。
- **S2では `composeXBody` は xReplies を使わない**（表示はS3）。candidateに載るだけで記事の見た目は不変（回帰ゼロ）。

## 制約・非目標
- **スキーマ変更なし**（`Post.media` JSONに格納）・**新規npm依存なし**。
- **表示は変えない**（composeXBody・article-body-view は不変。S3で刷新）。off/キー無しで完全に従来どおり（回帰ゼロ）。
- **コスト安全**: hot確定してAI記事化する親Xポストだけ・opt-in（既定onだが `X_API_KEY` 無しなら$0）・1〜2コール/記事・保存済みなら再取得しない。
- 逐語維持・捏造禁止（リプ本文・数値はAPI値そのまま。OCR/生成しない）。
- 著作権: 引用は逐語＋出典（@handle＋元URL）保持・件数上限。実際の本文への表示・主従配慮はS3で行う（S2は保存のみ）。

## テスト（必須・実HTTPを叩かない・fixtureモック）
1. `fetchTopReplies`: `conversation_id:<id>` のURLが正しく組まれる。X_QUOTES_MODE on で `quoted_tweet_id:<id>` も呼ぶ／off で呼ばない。親ツイート自身を除外。likeCount降順で `X_REPLIES_MAX` 件に打ち切り。失敗/キー無し/0件で空配列。
2. `extractPostXReplies`: 正常JSON→XReplyItem[]。不正（配列でない・要素欠落・型違い）は捨てて安全化。件数上限。
3. post-pipeline配線: `X_REPLIES_MODE` on＋`X_API_KEY`ありのhot X Postで、fetch結果が `Post.media.xReplies` に保存され（他mediaキー不変）、candidate.xReplies に載る。off/キー無しではfetchせずxReplies空・従来どおり。保存済みなら再fetchしない。
4. **表示回帰なし**: composeXBody の出力（本文ブロック）はS2で不変（xReplies未使用）。既存 x/compose/post-pipeline/collection テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. hot確定した親Xポストのリプライ（＋引用, quotes on時）が取得され `Post.media.xReplies` に保存・candidateに載る。表示は不変。off/キー無しで$0・回帰ゼロ。
3. スキーマ変更なし・新規依存なし・コスト安全設計・逐語維持・hotness不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。UIを持たないデータ配管のため検証モードは「テスト＋静的確認」で可（Playwright不適用）。
- fetchTopReplies（conversation_id/quoted_tweet_id・上限・失敗フォールバック）・extractPostXReplies（防御検証）・post-pipeline配線（保存＋candidate・opt-in/キー無しで$0・再取得防止）・表示回帰なし を確認。
- 受け入れ基準1〜3を満たす。
