---
tags: [sprint-selfeval]
sprint: x-embed
---

# X-embed 自己評価レポート

## 実装した内容
- `src/lib/embed.ts`
  - `extractTweetStatusId(url)` を新設。`isValidTweetStatusUrl` と同じ検証（provider判定・許可URL検証・
    `/status/\d+` パス形式）を経由し、抽出した数値IDを `TWEET_STATUS_ID_RE`（数値のみ・最大20桁）で
    再検証してから返す（不正時は null）。
  - `embedIframeSrc("twitter", url, host)` が、`extractTweetStatusId` で抽出できた場合のみ
    `https://platform.twitter.com/embed/Tweet.html?id=<数値ID>` を返すよう変更（従来は常に null）。
    youtube/clipの既存ロジックは無変更。
- `src/components/article-body-view.tsx`
  - `EmbedBlockView`: `embedIframeSrc` が値を返せば twitter でも実iframeを描画するよう変更。
    - twitterのみ `aspect-video`（16:9）を使わず、`min-height:300px`＋`max-height:750px`＋`overflow-y-auto`の
      専用コンテナにする（youtube/clipは既存どおり16:9のまま、回帰なし）。
    - twitterのiframeにのみ `sandbox="allow-scripts allow-popups allow-same-origin"` を付与
      （実際に動く最小権限。allow-same-originはsrcがcross-origin(platform.twitter.com)のためTwitter側
      originの権限に閉じ、当サイトoriginの権限にはならない）。`allow`（autoplay等）はtwitterには付けない。
    - postMessageによるリサイズは実装しない選択をした（下記「技術選定」参照）。origin検証が必要になる
      追加のuseEffect/"use client"化を避け、静的なmin/max-heightで崩れを防ぐシンプルな方式にした。
    - カードフォールバック時の「※埋め込みは本番接続時に表示されます（現在はリンクのみの
      プレースホルダー表示です）」という誤解を招く文言を完全に削除。代わりにprovider別の中立な
      リンク文言（`Xで見る`/`YouTubeで見る`/`Twitchで見る`）に置き換え（hrefは従来どおり元URL）。
- `next.config.ts`
  - `frame-src` に `https://platform.twitter.com` を追加（syndication.twitter.comは今回不使用のため追加せず、
    最小追加の原則を優先）。
  - `img-src` を新規追加（従来は指定なし＝制限なし）。既存の画像ブロックは `isSafeImageUrl` により
    「ローカルパス／データURI／任意のhttps」を既に許可しており、Data Dragon (ddragon.leagueoflegends.com)
    等の任意httpsホストへの依存が実在するため、`img-src` 新設で既存画像を回帰させないよう `https:` を
    維持しつつ `https://pbs.twimg.com https://abs.twimg.com` を明記した（詳細は「技術選定」参照）。
  - `script-src` は変更なし（widgets.js等の外部スクリプトを一切読み込まないため広げる必要がない）。
- `src/__tests__/next-config-headers.test.ts` / `src/lib/__tests__/embed.test.ts` /
  `src/components/__tests__/article-body-view.test.tsx` を新CSP・新挙動に合わせて更新（後方互換が崩れる
  旧アサーション「twitterは実iframe対象外」「本番接続時に表示されます」は、brief指定の挙動変更に伴い
  書き換え）。

## 技術選定（該当する場合のみ）
- **postMessageリサイズを実装しない選択**: briefは「postMessage resizeもしくはmin-height+max-height+
  overflow:autoのどちらでも可（origin検証はpostMessageを使う場合のみ必須）」としており、後者を選択。
  理由: (a) `article-body-view.tsx`は現状「use client」を持たないサーバーコンポーネント前提のファイルで、
  postMessageリスナーの登録にはuseEffect（クライアントコンポーネント化）が必要になり、ファイル全体を
  クライアント化する影響範囲が本スプリントのスコープ（tweet埋め込みのセキュリティ）を超える。
  (b) 静的なmin/max-height+overflow-autoでも「崩れない」という受け入れ基準は満たせ、origin検証ロジック
  自体を実装しないことでその検証漏れ・バグの余地も無くせる（シンプルさ優先）。
- **img-src CSPを制限的にしなかった判断**: brief文言は「img-srcにpbs.twimg.com/abs.twimg.comを追加」だが、
  現行実装は`isSafeImageUrl`で任意httpsホストの画像（Data Dragon等）を既に許可しており、既存の
  `next.config.ts`にはimg-src自体が存在しなかった（＝ブラウザ側で画像読み込みは無制限だった）。
  ここで`img-src 'self' data: https://pbs.twimg.com https://abs.twimg.com`のように**限定的な**
  ディレクティブを新設すると、ddragon.leagueoflegends.com等の既存の記事内画像がCSP違反でブラウザに
  ブロックされる重大な回帰になる（「youtube/clip・他の埋め込み・既存記事表示は不変」に反する）。
  そのため`https:`（任意httpsホスト許可＝現状維持）を残しつつ`pbs.twimg.com`/`abs.twimg.com`を明記する
  形にした。なお、ツイート内の画像自体はplatform.twitter.com/embed/Tweet.htmlという別オリジンの
  ドキュメントが読み込むため、実際にはTwitter側の CSP が適用されており、当サイトのimg-srcはツイート内
  画像の表示可否には直接影響しない（当サイト自身がpbs.twimg.comの画像を直接<img>で使うことは無い）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（119ファイル / 1632件、既存含め全通過）。`tsc --noEmit`エラー0。
      `npm run build`成功。`npm run lint`エラー0（既存の無関係warning6件のみ、新規warningなし）。
- [x] Xの反応記事のツイートが本物の埋め込み（platform.twitter.com/embed/Tweet.html）として実iframe
      描画されるようになった（`embedIframeSrc`・`EmbedBlockView`のテストで確認）。誤解文言
      「※埋め込みは本番接続時に表示されます」は削除済み。ID抽出失敗（プロフィールURL等）はカードに
      フォールバックする。
- [x] セキュリティ: widgets.js等の外部スクリプトは一切読み込まない（サンドボックス化iframeのみ）。
      検証済み数値tweet IDのみをsrcに使用（`extractTweetStatusId`で厳格検証、生URLをsrcに使わない）。
      CSPは最小追加（frame-srcにplatform.twitter.comのみ追加、script-srcは無変更）。sandbox属性
      （allow-scripts allow-popups allow-same-origin）を付与。postMessageは使用しないため
      origin検証ロジック自体が存在しない（＝誤ったorigin検証によるバイパスの心配がない）。
      dangerouslySetInnerHTMLは不使用（既存テストで継続確認）。DBスキーマ変更なし・新規npm依存なし・
      youtube/clip・他の埋め込み・既存記事表示は不変（専用テストで回帰なしを確認）。

## アプリの起動方法
- `cd "C:\ClaudeProjects\lolまとめサイト自動運営"` の上で `npm run dev`（http://localhost:3000）または
  `npm run build && npm run start`。
- 検証はテストのみで行い（`npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint`）、
  自己確認用にサーバーは起動していない（起動していないため停止作業も不要）。
- Xの反応記事（provider: "twitter"のembedブロックを含む記事）を開くとツイート埋め込みが表示される
  想定。実際のブラウザでのPlaywright操作検証（コンソールエラー0・実iframeのDOM確認等）は未実施
  （evaluator側での実施を想定）。

## 既知の問題・懸念点
- ブラウザでの実機目視確認（platform.twitter.com/embed/Tweet.htmlが実際にネットワーク越しにレンダリング
  され、コンソールエラーが出ないか）は今回未実施。テスト環境はJSDOM/Node上の静的HTML検証
  （`renderToStaticMarkup`）にとどまるため、実ブラウザでのiframe内コンテンツ描画・CSP適用の目視確認は
  evaluator（Playwright）に委ねる。
- postMessageによる高さ自動調整は実装していない（min-height 300px〜max-height 750px＋
  overflow-y-autoの静的制約で対応）。tweetの実際の高さによっては、短いツイートで余白が大きい／
  長いツイート（複数画像・長文引用等）でスクロールが必要になるケースがあり得るが、レイアウト崩れ
  （はみ出し）自体は発生しない設計。
- `img-src`にCSPを新設したが`https:`を維持し任意httpsホストを許可し続けているため、CSPとしての
  制限強化効果は限定的（既存の任意ホスト画像の回帰を避けるためのトレードオフ、詳細は「技術選定」参照）。
  将来的に画像ソースを許可ドメインの明示リストに絞り込む場合は、既存の記事内画像ホスト
  （Data Dragon等）を洗い出した上で別スプリントとして対応するのが望ましい。

## 追加したテスト（任意）
- `src/lib/__tests__/embed.test.ts`: `extractTweetStatusId`（正規status URLからのID抽出／プロフィール等
  status形式でないURL・許可外ホスト・URL不正はnull）、`embedIframeSrc("twitter", ...)`
  （検証済みURLでplatform.twitter.com/embed/Tweet.html?id=を返す／不正URLはnull）。
- `src/components/__tests__/article-body-view.test.tsx`: twitterの実iframe描画（src・caption・
  誤解文言なし）、sandbox/referrerPolicy/loading/title属性、不正tweet URLのカードフォールバック
  （誤解文言なし・中立文言あり）、youtube/clipの非回帰（既存src・sandbox属性が付かないこと）、
  dangerouslySetInnerHTML不使用の継続確認。既存のyoutube系埋め込みテストも誤解文言撤廃後の文言に
  更新。
- `src/__tests__/next-config-headers.test.ts`: frame-srcにplatform.twitter.comが含まれること、
  img-srcにpbs.twimg.com/abs.twimg.comが含まれること、script-srcが一切追加されていないこと。

## 関連ドキュメント
- [[x-embed-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
