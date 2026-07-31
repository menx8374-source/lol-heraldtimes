---
tags: [sprint-evaluation]
sprint: x-reply-s2
result: PASS
---

# Sprint X-reply-S2 評価レポート

## 総合判定: PASS

## 検証モード: テスト＋静的確認（Playwright不適用）
- 本スプリントはUIを持たないデータ配管（取得・`Post.media`保存・candidate配線）で、表示（`composeXBody`）はS2で不変。ブラウザで観測できる画面変化が原理的に存在しないため、brief「評価基準」の記載どおり検証モードを「テスト＋静的確認」とした（Bash縮退ではなく変更の性質による選択）。
- 実行コマンドはすべて成功: `npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint`。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 取得失敗・キー無し・0件はいずれも空配列（`fetchTweetsForQuery`→`fetchJsonSafe`が例外を投げず`null`→`[]`）。DB読み出しは`isValidXReplyItem`で防御。表示経路は未接続で記事生成に影響しない |
| コンソール/ビルドエラー0件 | PASS | `npx tsc --noEmit` 終了コード0（出力なし）／`npm run build` 終了コード0（全ルート生成完了）／`npm run lint` 0 errors（warning 6件はすべて既存・本スプリント無関係のファイル: site-header.tsx, collection-fivech.test.ts, generation-generate-article.test.ts, generation-seo.test.ts, generation-title.test.ts） |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3を下記のとおり全て確認 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **Test Files 121 passed / Tests 1687 passed**（失敗0）。新規2ファイル単体でも28 passed（`collection-x-reply-s2.test.ts` / `generation-post-pipeline-x-reply-s2.test.ts`） |

## 受け入れ基準の個別確認
1. **vitest/tsc/build/lint 通過** — PASS（上表）。既存テストの回帰なし（121ファイル全Green）。
2. **リプライ/引用の取得・保存・candidate配線・表示不変・off/キー無しで$0** — PASS。
   - (a) `fetchTopReplies`（x.ts）: `buildRepliesQuery` = `conversation_id:<id> -filter:retweets`、`buildQuotesQuery` = `quoted_tweet_id:<id>`。quotesMode（既定`isXQuotesModeOn()`=on）時のみ引用を+1コールでマージ。`toXReplyItem`で`id===parentTweetId`（親自身）と`id/text/url/author.userName`欠落を除外。`likeCount`降順→同点`replyCount`降順→`slice(0, X_REPLIES_MAX既定8)`。`apiKey`/`parentTweetId`無しは即`[]`（fetch未発行）、例外はcatchして`[]`。テストで URL組み立て・quotesMode on/off のコール数・親除外・上限打切り・tie-break・非2xx/ネットワーク断/タイムアウト/0件を確認。
   - (b) `extractPostXReplies`（post-pipeline.ts）: media非オブジェクト/配列、`xReplies`非配列で`[]`。各要素は`id,text,author,likeCount,replyCount,quoteCount,url,isQuote`(+`lang?`)の型を`isValidXReplyItem`で検証し不正要素のみ捨てる。`X_REPLIES_MAX`で再度上限切り詰め。
   - (c) post-pipeline配線: `post.sourceType==="x" && isXRepliesModeOn() && apiKey && !mediaHasXRepliesKey(post.media)` の全成立時のみ`fetchTopReplies(post.externalId, apiKey)`（x由来Postの`externalId`は`buildXItem`で`tweet.id`＝親tweetId）。`prisma.post.update`で既存media（imageUrl/url/html/patchPreview）をスプレッド保持したまま`xReplies`をマージ保存し、`candidate.xReplies = extractPostXReplies(post.media)`に配線。fetch箇所は`targetPosts`（`selectTopHotPosts`後・`article: null`のみ）ループ内＝hot確定してAI記事化する親Xポストに限定。off/キー無し/保存済みで`fetch`が一切呼ばれないことをDB実書き込み結合テストで確認（`expect(fetchMock).not.toHaveBeenCalled()`＋DB再読み込みで`xReplies`未定義／既存値保持）。
   - (d) 表示回帰なし: `xReplies`の出現箇所は post-pipeline.ts / generate-article.ts（型定義のみ）/ x.ts / 新規テストの4ファイルのみ。`compose.ts`・`article-body-view` は一切参照せず（grep 0件）＝記事本文は不変。
3. **スキーマ変更なし・新規依存なし・コスト安全・逐語維持・hotness不変** — PASS。
   - `git diff --stat -- prisma/` 空（`schema.prisma`無変更、`Post.media` JSONへのキー追加のみ）。
   - `git diff -- package.json package-lock.json` 空（新規npm依存なし）。
   - 変更ファイルは`.env.example` / `x.ts` / `generate-article.ts` / `post-pipeline.ts` の4つのみ。hotness関連（`evaluateHotness`/`hotnessStrength`/`selectTopHotPosts`・`src/lib/hotness/`）は未変更。
   - 逐語維持: `toXReplyItem`はAPI値（text/likeCount等）をそのまま転記のみ（加工・生成なし）。
   - コスト安全: 1記事あたり最大2コール、opt-in（`X_API_KEY`無しで$0）、保存済みは再取得なし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- `fetchTopReplies` はリプライ集合と引用集合をマージする際に重複IDの排除を行わない。同一tweetが両クエリに現れると同じレスが2件並ぶ可能性がある（実運用では稀）。S3で表示する前に`id`でdedupeしておくと安全。
- 追加した`prisma.post.update`はループ内のtry/catchより前にあるため、DB書き込み失敗時は`generateArticlesFromHotPosts`全体が中断する（既存の`findMany`/`loadPublishedContentPool`と同じ扱いで新規リスクではないが、「1件の失敗で他を止めない」という関数のドキュメント方針とはややズレる）。
- `envIntLocal`が`x.ts`と`post-pipeline.ts`に重複定義されている（各1箇所・小さいが共通化余地あり）。
- 他のcandidate組み立て経路（`article-updater.ts` / `pipeline.ts` / `patch-preview-confirm.ts`）は`xReplies`を載せていない。S2のbrief範囲外だが、S3で「既存記事の更新時にもリプライを表示する」なら`article-updater.ts`の配線が必要になる点をS3で要検討。
- 自己評価の既知懸念どおり、fetch結果0件（API障害含む）でも`xReplies: []`を保存して「試行済み」マークにする設計のため、一時障害時は次回実行で再試行されない。briefの「任意の軽量ガード」の範囲内で妥当だが、S3で表示が空になるケースの許容として認識しておくとよい。

## 未検証項目（実機確認が必要）
- 実HTTPでのGetXAPI `conversation_id:` / `quoted_tweet_id:` の実レスポンス（テストは全てfixtureモック・実課金なし）。`X_API_KEY`設定下の本番実行時に、実際に`Post.media.xReplies`が非空で保存されるかは本番投入時の確認が必要。
- `conversation_id:` の「投稿から約7日で検索から落ちる」制約の実挙動（brief記載の既知制約・実装上の対応なし）。

## プレビュー画像
- 該当なし（UI変更を伴わないデータ配管スプリントのため、ブラウザ画面の撮影対象なし）。

## 関連ドキュメント
- [[x-reply-s2-selfeval]]（ジェネレーターの自己評価レポート）
- [[x-reply-s2-brief]]（本スプリントの仕様抜粋）
