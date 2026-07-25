# 拡張スプリント E16: Reddit 収集の本接続（OAuth・要APIキー）

対象プラットフォーム: web（既存アーキテクチャに従う）／フェーズ2「実データ収集の本接続」第2弾。

## 背景・スコープ
E15 で段階的 live レジストリ（`LIVE_ADAPTER_FACTORIES`）が整った。次は **Reddit（海外の反応）** の live 実装を追加する。
Reddit は API キーが必要だが、**コードとオフラインテスト（fetchモック）は本スプリントで完成**させ、実ライブ稼働は運営者が
Reddit アプリのクレデンシャルを `.env` に設定して行う。

## 認証方式（キー不要のパスワード方式は使わない）
- **Application-only OAuth2（client_credentials）** を使う（Redditアカウントのパスワード不要・公開読み取り用）。
  - トークン取得: `POST https://www.reddit.com/api/v1/access_token`（Basic認証= `client_id:client_secret`、body `grant_type=client_credentials`）。
  - 以降の読み取りは `https://oauth.reddit.com/...` に `Authorization: Bearer <token>` ＋ **必須の `User-Agent`** を付与。
- 必要な env（`.env` のみ・秘密。`.env.example` にはキー名のみ追記）:
  - `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`（秘密）
  - `REDDIT_USER_AGENT`（Reddit規約で必須の説明的UA。例 `lol-matome/1.0 by <運用者>`。秘密ではない）

## 含まれる機能

### F-E16-1: Reddit live アダプタ
- `RedditAdapter implements SourceAdapter`（`sourceType:"reddit"`）を新設。
- 手順: (1) app-only トークン取得 → (2) 許可サブレディット（`config.ts` の `DEFAULT_ALLOWED_SUBREDDITS`＝`leagueoflegends`）の hot/new 等のリスティングを取得 → (3) 各投稿を `RawCollectionItem`（`{sourceUrl,title,content,fetchedAt}`）へ整形。
  - `sourceUrl` = 投稿の **permalink 絶対URL**（`https://www.reddit.com<permalink>`）。**投稿ごとに一意**（normalizedUrl一意制約で重複排除）。
  - `title` = 投稿タイトル。`content` = `selftext`（本文）、無ければタイトル＋（任意で上位コメント抜粋）。※逐語転載方針のため原文（英語）をそのまま content にしてよい。日本語訳・整形は下流の生成（compose/LLM）に委ねる。
  - `fetchedAt` = 投稿の `created_utc`（UNIX秒→Date）。
- 件数上限は呼び出し側(pipeline)が `COLLECTION_REDDIT_MAX_ITEMS` で適用。relevance（許可サブレディット＋キーワード）は既存 pipeline/filter が適用するので、アダプタは許可サブレディットから取得して候補を返すだけでよい。
- **信頼境界(外部API)**: fetch はタイムアウト付き。トークン取得失敗・HTTPエラー・不正JSON・ネットワーク断・**クレデンシャル未設定**はいずれも**握り潰して空配列を返す**（throwせずパイプライン全体を止めない＝E15と同方針）。クレデンシャル未設定時は「未設定のためReddit収集をスキップ」等のログを一度残す。
- Reddit の返すユーザー生成テキストは信頼できない入力として扱う（後段の安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保するので、アダプタは生テキストを content に入れるだけでよい。HTMLとして解釈させる経路に入れない）。

### F-E16-2: live レジストリへ Reddit を追加
- `LIVE_ADAPTER_FACTORIES` に `reddit: () => new RedditAdapter()` を追加。これで `COLLECTION_MODE=live` の `getAllAdapters("live")` は **riot＋reddit** を含む（5ch は引き続き未実装スキップ）。
- クレデンシャル未設定でも `getAllAdapters("live")` は reddit を含むが、`fetchItems()` が空配列＋ログでグレースフルに動く（キー未設定＝収集0件で、他ソースを止めない）。
- mock モードは全ソース従来どおり（変更しない）。

## 実装原則（CLAUDE.md）
- テスト必須(TDD-lite): **`global.fetch` を vitest でモック**し、(a) トークンエンドポイント→リスティングの2段呼び出しの成功系（Basic認証ヘッダ・grant_type・Bearer・User-Agent が正しく付く）、(b) リスティングJSON→`RawCollectionItem`整形（permalink絶対URL・created_utc→Date・selftext優先）、(c) `sourceUrl` の一意性（dedupが効く）、(d) トークン取得失敗/HTTPエラー/不正JSON/ネットワーク断→空配列（throwしない）、(e) **クレデンシャル未設定→空配列＋スキップログ**、を検証（実ネットに出ない）。整形は純関数に切り出す。
- **新規依存を追加しない**（Node標準 `fetch`）。**シークレット（client_secret等）をハードコードしない**・ログに出さない。`.env.example` に `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT` をキー名のみ追記、README最小限追記。
- 既存パイプライン（dedupe/queue/filter/rate-limit）の契約を壊さず、**mockの全テストGreenを維持**。E15のriot live・段階的レジストリを壊さない。
- 自己確認で起動したスクリプトは自己評価レポート作成前に停止。

## 受け入れ基準（検証可能・原文）
- [ ] `RedditAdapter` が app-only OAuth でトークン取得→許可サブレディットのリスティング取得→`RawCollectionItem[]` を返す（fetchモックで検証）。
- [ ] `sourceUrl` が投稿permalinkの絶対URLで一意・安定（同一投稿は重複排除される）。`fetchedAt` が `created_utc` 由来。
- [ ] トークン取得失敗/HTTPエラー/不正JSON/ネットワーク断/**クレデンシャル未設定**で例外を投げず空配列を返し、パイプライン全体を止めない。
- [ ] `getAllAdapters("live")` が riot＋reddit を含み、5ch はスキップ。mockモードは全ソース従来どおり（回帰なし）。
- [ ] クレデンシャル・シークレットがコード/ログに出ていない（`.env` 経由のみ）。
- [ ] `npm test` 全てGreen（fetchモックのオフラインテスト。実ネットに出ない）。tsc/build/eslint通過。新規依存なし。

## 評価基準（evaluator向け）
- 致命的バグ0件／コンソール・実行エラー0件／上記受け入れ基準の充足率100%／テストGreen。1つでも下回れば全体FAIL。
- **実ネット確認は任意**（Redditクレデンシャルが評価環境に無いのが通常）。無い場合は「検証モード: フィクスチャテストのみ（実ライブは運営者のReddit APIキーで別途確認）」と明記し、fetchモックのテストGreen＋クレデンシャル未設定時のグレースフル動作＋mock回帰でPASS可（キー不在はFAIL根拠にしない）。もしダミー/実クレデンシャルが使えるなら `COLLECTION_MODE=live npm run collect` でreddit収集を確認してよい（検証後 `npm run db:seed` で復元）。
- 既存の収集(mock)・記事生成・サイト表示・E15 riot に回帰が無いこと。
