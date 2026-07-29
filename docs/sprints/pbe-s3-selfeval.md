---
tags: [sprint-selfeval]
sprint: pbe-s3
---

# PBE-S3 自己評価レポート

（`docs/sprints/pbe-s3-brief.md` は生成時点で存在しなかったため、オーケストレーターからのタスク指示文
＝ F-PBE3-1〜F-PBE3-3・制約・テスト・受け入れ基準を原文どおりのbrief相当として実装した。
`docs/pbe-research.md` §1.2・§2、および流用元 `src/lib/collection/adapters/x.ts` を参照した。）

## 実装した内容
- 新規 `src/lib/collection/adapters/pbe-x-source.ts`:
  - `fetchPbeSourceTweets(options?)`: PBE関連ツイート取得のエントリポイント。`X_API_KEY`（`options.apiKey`優先、既定 env）未設定ならmock(fixture)、設定時のみGetXAPIへlive接続。
  - `buildPbeSourceTweet(tweet)`: GetXAPIのtweet1件→`PbeSourceTweet`（author/authorHandle/text逐語/url/createdAt/mediaUrls/direction?）への純関数変換。id/url/text/author欠落・isReply=trueはnull。
  - `detectPbeDirection(text)`: 強化/弱体/buff/nerf/バフ/ナーフ等のキーワードのみで方向性を軽くタグ付けする純ルール関数。両方/どちらも無しは未設定（曖昧を確定させない）。
  - `parsePbeQueries(raw)`: env `PBE_X_QUERIES`（`|||`区切り）のパース。既定クエリ1件 `(from:Spideraxe30 OR from:RiotPhroxzon) (PBE OR patch OR パッチ) -filter:retweets`。
- 既存 `src/lib/collection/adapters/x.ts` を最小限拡張（**重複実装回避のためのリファクタ**）:
  - `fetchTweetsForQuery(query, apiKey, options)` を新規export。GetXAPI advanced_searchの1クエリ分呼び出し（Bearer認証・タイムアウト・空配列フォールバック）を`XAdapter`とPBE-S3の両方で共有する共通実装として抽出。`XAdapter.fetchQuery`もこの関数を呼ぶよう置き換え（挙動不変、既存テスト全Green確認済み）。
  - `parseSearchQueries(raw, defaultQueries?)` に第2引数（既定クエリ配列）を追加し汎用化。既存呼び出し（引数省略）は既定値不変のため後方互換。PBE-S3の`parsePbeQueries`はこれをPBE用既定クエリで呼ぶだけ。
- 新規fixture `src/lib/collection/fixtures/pbe-x.json`（Spideraxe/Phroxzonのmockツイート3件、うち1件は画像なし・direction判定不可のケースを含む）。
- 新規テスト `src/lib/__tests__/collection-pbe-x-source.test.ts`（29ケース）。

## 技術選定
- 新規npm依存なし。X_API_KEY・GetXAPIの構成は成長G7既存のものをそのまま流用（追加コストなし、キー未設定時は完全無課金）。

## 受け入れ基準チェック（自己申告）
- [x] F-PBE3-1: PBE用クエリ(Spideraxe/Phroxzon限定・PBE/patch関連・-filter:retweets)でGetXAPIから取得。`PBE_X_QUERIES`で上書き可。G7のx.tsの`fetchTweetsForQuery`（新規共有関数）・`parseSearchQueries`（汎用化）を流用し重複実装していない。X_API_KEY設定時のみlive、未設定はmock(fixture)。失敗・非2xx・タイムアウトは空配列（テストで確認）。
- [x] F-PBE3-2: `PbeSourceTweet`(author/authorHandle/text逐語/url/createdAt/mediaUrls/direction?)を返す。textは逐語保持（要約・数値抽出・OCR・改変なし、テストで原文完全一致を確認）。mediaUrlsにツイート画像URLを保持。direction はキーワードのみの軽いタグ付け（数値の抽出・解釈はしない、テストで確認）。
- [x] F-PBE3-3: 取得層＋出典データ＋mock＋テストのみ。compose/pipeline/表示は一切変更していない（新規ファイル2件＋x.tsへの内部リファクタのみ）。記事化・埋め込み・opt-in env・人手キュレーションは実装していない（PBE-S5送り）。
- [x] `npx vitest run` 全Green（117ファイル/1573テスト）。
- [x] `npx tsc --noEmit` エラー0。
- [x] `npm run build` 成功。
- [x] `npm run lint` エラー0（既存の無関係な警告6件のみ、本スプリントの変更に起因するものなし）。

## アプリの起動方法
- 本スプリントはUI/APIルートを持たないバックエンド取得層の追加のみ（既存の起動フローに変更なし）。
- 動作確認は自動テストで実施: `npx vitest run src/lib/__tests__/collection-pbe-x-source.test.ts`
- アプリ全体の起動確認が必要な場合は既存どおり: `npm run dev`（http://localhost:3000）。本スプリントでは追加確認のためのサーバー起動は行っていない（起動不要なため）。

## 既知の問題・懸念点
- `X_API_KEY`本接続の実ページ・実クエリでの動作は未検証（brief/pbe-research.md自身も「X本文の実ページは未取得・自動スクレイプは非現実的」と明記しており、本スプリントはfixtureモックとGetXAPI仕様（G7で導入済み）に基づく実装。実クレデンシャルでの疎通確認はスコープ外）。
- `direction`はキーワード一致のみの粗い判定（例:「buffing junglers, nerfing bruisers」のように1ツイートに両方の意味が混在する場合は未設定になる。ラベルの意味的な文分割はしない、誤帰属回避を優先）。
- `docs/sprints/pbe-s3-brief.md`は生成時点で存在しなかった。タスク指示文に記載された仕様（F-PBE3-1〜3・制約・テスト・受け入れ基準）をそのまま実装根拠とした。オーケストレーター側でbrief未作成のケースと思われる。

## 追加したテスト
- `src/lib/__tests__/collection-pbe-x-source.test.ts`: `buildPbeSourceTweet`（逐語text保持・mediaUrls抽出・isReply除外・欠落フィールド除外・不正日付フォールバック）、`detectPbeDirection`（buff/nerf/曖昧/数値非依存）、`parsePbeQueries`（既定・`|||`区切りカスタム）、`fetchPbeSourceTweets`（mock/live切替・Bearer認証・複数クエリ直列＋重複排除・非2xx/ネットワーク断/タイムアウト/不正JSONで空配列・isReply除外）を網羅。
- 既存 `src/lib/__tests__/collection-x.test.ts`（G7 XAdapter）も全Green（x.tsのリファクタが既存挙動を壊していないことを確認）。

## 関連ドキュメント
- [[pbe-s1-brief]]（PBE-S1: CDragon PBEクライアント・アイテムdiff）
- [[pbe-s2-brief]]（PBE-S2: チャンピオン基本/cost/cooldown diff）
- [[pbe-s4-brief]]（PBE-S4: PBE記事枠。X収集を当時「保留」としていたが本スプリントで取得層を追加）
