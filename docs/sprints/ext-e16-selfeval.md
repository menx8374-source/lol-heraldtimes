---
tags: [sprint-selfeval]
sprint: E16
---

# Sprint E16 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/reddit.ts`: `RedditAdapter implements SourceAdapter`（`sourceType:"reddit"`）を新設。
  - 認証: Application-only OAuth2（client_credentials）。`POST https://www.reddit.com/api/v1/access_token`（Basic認証=`client_id:client_secret`、body=`grant_type=client_credentials`、User-Agent必須）。
  - 読み取り: `https://oauth.reddit.com/r/<subreddit>/hot` に `Authorization: Bearer <token>` ＋ `User-Agent` を付与。既定サブレディットは `config.ts` の `DEFAULT_ALLOWED_SUBREDDITS`（`leagueoflegends`）。
  - 整形（純関数）: `extractPosts`（リスティングJSON→投稿データ配列、不正な子要素は無視）／`buildPostUrl`（permalink→絶対URL）／`buildRedditItem`（`sourceUrl`=permalink絶対URL、`title`=投稿タイトル、`content`=selftext優先・空ならタイトル、`fetchedAt`=`created_utc`秒→Date）。
  - アダプタ内で`sourceUrl`のSetによるローカル重複排除も実施（下流のnormalizedUrl一意制約と二重の安全網）。
  - 信頼境界: fetchはタイムアウト8秒。トークン取得失敗/HTTPエラー/不正JSON/ネットワーク断/クレデンシャル未設定は全て握り潰して空配列を返す（throwしない）。クレデンシャル未設定時は`console.log`で1回スキップログを出す（シークレットは出力しない）。
- `src/lib/collection/adapters/index.ts`: `LIVE_ADAPTER_FACTORIES`に`reddit: () => new RedditAdapter()`を追加。`getAllAdapters("live")`はriot＋redditを含み、5chは引き続きスキップ。mockモードは変更なし。
- 既存の`collection-adapters-registry.test.ts`（E15時点でreddit=未実装を前提にしていた回帰テスト）をreddit実装済み仕様に更新。
- `.env.example`/`README.md`に`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`（キー名のみ）を追記。
- `docs/spec/lol-matome-sokuhou-architecture.md`の「収集アダプタ構造」該当箇所を現状（riot/reddit実装済み・5ch未実装）に上書き更新。

## 技術選定（該当する場合のみ）
- 新規依存ライブラリは追加せず、Node標準の`fetch`と`Buffer`（Basic認証のbase64エンコード）のみを使用（既存E15riotアダプタと同方針）。

## 受け入れ基準チェック（自己申告）
- [x] `RedditAdapter`がapp-only OAuthでトークン取得→許可サブレディットのリスティング取得→`RawCollectionItem[]`を返す（fetchモックで検証、テストで2段呼び出しのヘッダ/bodyを検証済み）。
- [x] `sourceUrl`が投稿permalinkの絶対URLで一意・安定（同一投稿は重複排除されるテストあり）。`fetchedAt`が`created_utc`由来（秒→Date変換テストあり）。
- [x] トークン取得失敗/HTTPエラー/不正JSON/ネットワーク断/クレデンシャル未設定で例外を投げず空配列を返す（各ケースをテストで検証）。
- [x] `getAllAdapters("live")`がriot＋redditを含み、5chはスキップ。mockモードは全ソース従来どおり（回帰テスト更新・green）。
- [x] クレデンシャル・シークレットがコード/ログに出ていない（`.env`経由のみ、クレデンシャル未設定スキップログにclientSecretを含まないことをテストで検証）。
- [x] `npm test`全てGreen（後述）。tsc/build/eslint通過。新規依存なし（`package.json`変更なし）。

## アプリの起動方法
- テスト: `npm test`（vitest）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npx eslint .`
- （任意・実クレデンシャルがある場合のみ）: `.env`に`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`と`COLLECTION_MODE=live`を設定し `npm run collect` でreddit収集を確認できる（確認後は`npm run db:seed`等で復元推奨）。本スプリントでは実クレデンシャルが無いため未実施。

## 既知の問題・懸念点
- 実ライブ稼働（実際のRedditクレデンシャルでの疎通）は未検証。運営者がReddit Appクレデンシャルを`.env`に設定後、`COLLECTION_MODE=live npm run collect`で別途確認する必要がある。
- リスティングは`hot`のみを対象（ブリーフの「hot/new等」の例示に対しhotで実装。件数上限は既存の`COLLECTION_REDDIT_MAX_ITEMS`をpipeline側が適用するため、アダプタ自体はサブレディットあたり25件のRedditデフォルトlimitで取得）。
- 上位コメント抜粋の付加（ブリーフで「任意」とされている機能）は実装していない（selftext優先＋フォールバックのみ）。

## 追加したテスト（任意）
- `src/lib/__tests__/collection-reddit.test.ts`（新規、15テスト）: 純関数（buildPostUrl/buildRedditItem/extractPosts）の単体テスト＋`RedditAdapter.fetchItems`の結合テスト（成功系のヘッダ/body検証、重複排除、トークンHTTPエラー、リスティングHTTPエラー、不正JSON、ネットワーク断、クレデンシャル未設定＋ログ検証）。全てfetchモック、実ネットに出ない。
- `src/lib/__tests__/collection-adapters-registry.test.ts`（既存を更新）: reddit liveがRedditAdapterを返すこと・`getAllAdapters("live")`がriot+redditの2件を含むことを検証するよう更新。

### テスト結果（実数）
- `npm test`: 67 test files / 585 tests 全てpassed。
- `npx tsc --noEmit`: エラーなし。
- `npm run build`: 成功（Next.js本番ビルド）。
- `npx eslint .`: エラー0件（既存の無関係な警告1件のみ、本スプリント変更ファイルではない）。

## 関連ドキュメント
- [[ext-e16-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
