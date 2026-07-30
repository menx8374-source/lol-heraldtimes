# X-embed — Twitter反応記事で本物のツイート埋め込み（サンドボックス化iframe・最大限のセキュリティ）

ユーザー要望: Xの反応記事で、参考サイト（overwatch2-news…）のように**本物のツイート埋め込み**（本文＋画像が表示される）を、**考えられる限りのセキュリティ対策**で実装する。**AI不使用**。対象: Web（表示）。

## 背景（現状）
- 現状 `src/lib/embed.ts` の `embedIframeSrc` は **twitter で null を返し**、`article-body-view.tsx` の `EmbedBlockView` が**リンクのみのプレースホルダーカード**にフォールバックしている（「※埋め込みは本番接続時に表示されます」という**誤解を招く文言**付き）。実際は本番でも埋め込まれない。
- youtube/clip は `platform.twitter.com` 等ではなく `youtube-nocookie.com`/`clips.twitch.tv` の**実iframe**を描画済み。twitter も同じ「実iframe」方式に載せる。
- CSPは `next.config.ts`（テスト `src/__tests__/next-config-headers.test.ts`）。埋め込み許可判定は `embed.ts`（`isValidTweetStatusUrl`・`embedProviderForUrl`・`isAllowedEmbedUrl`）。

## セキュリティ方針（最重要・最大限）
**外部スクリプト（platform.twitter.com/widgets.js）を自サイト上で実行しない。** 代わりに**Twitter公式のサンドボックス化iframe**（`https://platform.twitter.com/embed/Tweet.html?id=<数値ID>`）を使う＝**サードパーティJSが当サイトのDOM/originで動かない**（widgets.jsを読み込む方式より安全）。加えて:
1. **検証済みツイートIDのみ**: `isValidTweetStatusUrl` で x.com/twitter.com の `/<user>/status/<id>` を厳格検証し、**数値のtweet IDのみ**を抽出してiframe srcに使う（生URLをsrcに使わない）。
2. **CSP厳格化**（next.config.ts）: `frame-src` に `https://platform.twitter.com` を追加（必要なら `https://syndication.twitter.com`）。`img-src` に `https://pbs.twimg.com https://abs.twimg.com` を追加。**`script-src` は広げない**（widgets.jsを読まないため不要）。他のディレクティブは現状維持で最小追加。
3. **iframe属性**: `sandbox`（Twitter埋め込みが機能する最小権限＝`allow-scripts allow-popups allow-same-origin` 等、実際に動く最小に絞る。cross-originのためallow-same-originはtwitter側originに閉じる）、`referrerPolicy="strict-origin-when-cross-origin"`、`loading="lazy"`、`allow` は最小（camera/microphone等は付けない）、`title` 付与。
4. **dangerouslySetInnerHTML は使わない**（現行方針踏襲）。生HTML・oEmbed HTMLの注入はしない。
5. **高さ調整**: Twitter埋め込みは高さが可変。`window.postMessage` の resize を **`event.origin` が `https://platform.twitter.com` のときだけ**受けて高さを更新する（他originは無視）。postMessageを使わない場合は、妥当な `max-height` ＋ `overflow:auto` で崩れないようにする（どちらでも可。origin検証は必須）。
6. **フォールバック**: ID抽出に失敗した/不正なURLは埋め込まず、従来のリンクカードにフォールバック（記事は壊れない）。

## 含まれる機能

### F-XE-1: twitterを実iframe対象に（embed.ts）
- `embedIframeSrc(provider, url, hostname)` が `twitter` のとき、`isValidTweetStatusUrl(url)` 検証＋数値ID抽出のうえ `https://platform.twitter.com/embed/Tweet.html?id=<id>`（＋テーマ等の安全なクエリのみ）を返す。不正時は null（→カードフォールバック）。
- 既存の youtube/clip の抽出・許可判定の設計を踏襲（純関数・ホワイトリスト）。

### F-XE-2: 表示（article-body-view.tsx EmbedBlockView）
- twitter の src が返るようになるので、実iframeを描画する。ただし**tweetは16:9でない**ため、youtube/clipの `aspect-video` とは別の**twitter専用コンテナ**（可変高さ：postMessage resize もしくは `min-height`＋`max-height`＋`overflow:auto`）にする。枠・角丸は既存意匠に合わせる。
- 「※埋め込みは本番接続時に表示されます」の**誤解を招く文言を削除**（カードフォールバック時は「Xで見る」等の中立な文言＋リンクにする）。
- postMessage resize を使う場合は `event.origin === "https://platform.twitter.com"` を必須チェック（それ以外は無視）。useEffectでリスナ登録・アンマウントで解除。

### F-XE-3: CSP更新（next.config.ts）＋テスト更新
- `frame-src` に `https://platform.twitter.com`（必要なら `https://syndication.twitter.com`）、`img-src` に `https://pbs.twimg.com https://abs.twimg.com` を**最小追加**。script-srcは変更しない。
- `src/__tests__/next-config-headers.test.ts` を新CSPに合わせて更新（他のディレクティブが緩んでいないことも検証）。

## 制約・非目標
- **AIは使わない**。埋め込み対象は既存の「Xの反応」記事（G7）やツイートembedブロック全般。**PBE記事は別途停止方針**のため対象外でよい（embed共通実装なので自然に効くが、PBE生成自体を止める）。
- **セキュリティ最優先**: 外部スクリプトを自ページで実行しない・検証済みIDのみ・CSP最小追加・sandbox・origin検証・dangerouslySetInnerHTML不使用。
- 著作権: Twitter公式埋め込み（oEmbed/公式iframe）＝規約準拠の引用。出典（作者・リンク）は保持。
- **DBスキーマ変更なし・新規npm依存なし**。youtube/clip・他の埋め込み・既存記事表示は不変（回帰なし）。

## テスト（必須・実HTTPを叩かない）
1. `embedIframeSrc("twitter", 有効なstatus URL, host)` が `platform.twitter.com/embed/Tweet.html?id=<数値>` を返す。無効URL（プロフィール等・別ドメイン）は null。
2. EmbedBlockView: twitter で実iframe（platform.twitter.com/embed）が描画され、sandbox/referrerPolicy/loading属性が付く。誤解文言が無い。ID抽出失敗時はカードフォールバック。
3. postMessage resize（実装する場合）: origin が platform.twitter.com 以外のメッセージを無視する。
4. CSP: next-config-headers テストで frame-src に platform.twitter.com・img-src に pbs.twimg.com が入り、script-src が広がっていないこと。
5. youtube/clip・他ブロック・既存記事表示が回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. Xの反応記事のツイートが**本物の埋め込み（本文＋画像）**として表示される（サンドボックス化iframe）。誤解文言が消える。ID抽出失敗はカードにフォールバック。
3. セキュリティ: 外部スクリプトを自ページで実行しない・検証済みIDのみ・CSP最小追加・sandbox・origin検証・dangerouslySetInnerHTML不使用。DBスキーマ変更なし・新規依存なし・youtube/clip等は不変。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0（CSP違反エラーが出ないこと）。
- 実際にツイート埋め込みiframeが描画される（Playwrightで platform.twitter.com/embed のiframe存在を確認できればなお良い）。誤解文言が無い。youtube/clip・既存表示が崩れない。
- セキュリティ要件（外部スクリプト不実行・CSP最小・sandbox・origin検証）を満たす。
- 受け入れ基準1〜3を満たす。
