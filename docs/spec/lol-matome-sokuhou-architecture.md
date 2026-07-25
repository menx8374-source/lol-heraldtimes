---
tags: [architecture]
status: active
---

# LoL まとめ速報サイト自動運営システム 技術ベースライン

## 対象プラットフォーム
`web`（閲覧者向け公開サイト＋自動運営バックエンド／バッチ）。スマホ(375px)・PC(1280px)のレスポンシブ表示前提。検索流入が収益の要のため SEO 適性（サーバーサイドレンダリング／構造化データ／サイトマップ）を最重視。

## 決定サマリー
| 領域 | 決定 | 理由（実行環境の制約 / 運用コスト） |
|---|---|---|
| 言語/ランタイム | TypeScript / Node.js 24（インストール済み: v24.18.0） | 閲覧サイトと収集・生成パイプラインを同一言語で共有でき、ロジックの型安全・テスト容易性が高い。追加ランタイム不要・無料。 |
| フレームワーク | Next.js（App Router）+ React + TypeScript | SSR/静的生成でメタ情報・OGP・JSON-LD を確実に出力でき F13(SEO) を素直に満たす。`sitemap.ts`/`robots.ts`/`generateMetadata` が標準。API Route で閲覧数カウント(F3)・ダッシュボード(F14) も同一アプリで賄える。Windows で無料・管理者権限不要。 |
| スタイリング | Tailwind CSS | レスポンシブ(375/1280)をユーティリティで確実に組める。ランタイムコストなし・無料。細かな見た目は generator 裁量。 |
| データ層 | SQLite（単一ファイル）+ Prisma ORM | 記事/収集アイテム/記事化候補/保留キュー/タグ/カテゴリ/閲覧数/実行ログと関連が多く、型付きスキーマ＋マイグレーションが有効。Prisma のクエリエンジンは**プリコンパイル済みバイナリ**でネイティブC++ビルド不要＝Windows/Node24 でも native-gyp の詰まりを回避。F4 検索は SQLite の LIKE で足りる。無料・ローカルファイル。 |
| バックエンド/API | 同一 Next.js アプリ内（Route Handlers）＋独立実行可能なパイプラインスクリプト（tsx） | 別サーバーを立てず単一アプリに集約。パイプライン本体は `lib/` の純ロジックとして UI から分離し、`npm run pipeline` で単独実行・テスト・cron 起動のいずれも可能にする。 |
| スケジューリング | node-cron（アプリ内・常駐時）／外部スケジューラからの `npm run pipeline` 起動（CI・OSタスク） | 常駐運用は in-process cron で無人化(F10)。CI/検証・手動実行のためスクリプト単独起動も必須にする。追加SaaS不要・無料。 |
| ホスティング/実行形態 | 単一 Next.js アプリを standalone ビルド（`next build`）した**デプロイ可能成果物**。検証・開発はローカル `next start`＋SQLite＋in-process cron | 最終デプロイ接続は Non-Goal だが「デプロイ可能成果物」までを担う。無料の無人運用パスは末尾「運用コスト」に明記。evaluator はローカル起動アプリを Playwright で操作検証できる。 |
| テスト基盤 | Vitest | TS/ESM ネイティブで設定が軽く高速。収集・重複排除・記事生成の構成分岐・逐語一致率・タイトル品質チェッカー・安全フィルタ・パイプライン統合の各ロジックを単体テスト。LLM/収集は下記アダプタ／クライアントをスタブ注入して**決定論的に Green** にする。無料。 |
| LLM プロバイダ/モデル | **Anthropic Claude**（`@anthropic-ai/sdk`）。既定モデル **Claude Haiku 4.5**（`claude-haiku-4-5`）、品質を上げたい記事は Sonnet 系(`claude-sonnet-4-5`)に env で切替可 | 本環境が Claude Code であり Claude を既定にする方針。継続大量生成のため**コスト効率優先で Haiku 4.5 を既定**。モデル ID は env で差し替え可能にし、将来の新モデルへコード変更なしで追随。 |
| 横断ライブラリ | LLM クライアント抽象（`LLMClient` IF）／収集アダプタ抽象（`SourceAdapter` IF）／広告差し込みコンポーネント | LLM・収集・広告はいずれも「後で本接続に差し替える」前提。IF で分離して切替点を1箇所に固定する（下記）。認証・決済・状態管理ライブラリは今回は不要（読み取り専用公開サイト＋管理ダッシュボードのみ、会員機能なし）。 |

## LLM 接続方針（本接続・要 API キー）
- パッケージ: `@anthropic-ai/sdk`
- **環境変数（ユーザーが手動用意）**:
  - `ANTHROPIC_API_KEY` — Anthropic の API キー（**必須**）
  - `ANTHROPIC_MODEL` — 使用モデル。未設定時の既定は `claude-haiku-4-5`
- キーは `.env`（gitignore 済み）から読み込み、`.env.example` にはキー名のみ記載。ソースにハードコードしない。
- `LLMClient` インターフェース（`generate(messages)` 等）を定義し、本番実装は Anthropic SDK、テストは決定論スタブを注入。F7(本文)・F8(タイトル) はこの1つの抽象越しに呼ぶ。
- 逐語一致率(F7)・タイトル品質チェッカー(F8)・安全フィルタ(F9) の**判定ロジックは LLM に依存しない純関数**として実装し、スタブ出力に対してテストで検証する（LLM 応答の揺れとテストの決定性を分離）。

## 収集アダプタ構造（モックで進め、後日本接続へ差し替え）
- `SourceAdapter` インターフェース（`fetchItems(config): CollectionItem[]`）を定義。実装は `reddit` / `5ch` / `riot` の各アダプタ。
- 初期は各アダプタの**Mock/Sample 実装**（fixture JSON を読む）で受け入れ基準を満たす。設定（env/config）で mock ↔ live を選択。
- 差し替え点をアダプタ1層に閉じ込め、パイプライン本体（重複排除→生成→タイトル→安全→公開）は収集元に非依存。
- 取得件数上限・実行間隔（レート制限）は設定として各アダプタが保持（F5）。1ソース失敗が全体を止めない設計はパイプライン側で担保（F11）。

### 実装詳細（Sprint 3 確定）
- 実装場所: `src/lib/collection/`（`types.ts`/`normalize.ts`/`similarity.ts`/`filter.ts`/`rate-limit.ts`/`collect-source.ts`（DB非依存の純ロジック）/`dedupe.ts`（同）/`pipeline.ts`・`queue.ts`（DB連携）/`adapters/`）。単独実行は `scripts/collect.ts`（`npm run collect`）。
- データモデル: `CollectedItem`（`normalizedUrl` に unique 制約で同一URL取込みを自然に1件化）・`SourceFetchLog`（実行間隔判定・失敗記録）を Prisma に追加。`CollectedItem.status`: pending/queued/duplicate/articled。
- URL正規化: ホスト小文字化・トラッキングクエリ除去（`utm_*`/`ref`/`fbclid`等）・末尾スラッシュ除去・ハッシュ除去。
- 類似度判定（同一話題検出）: LLM非依存、文字bi-gramのJaccard係数（タイトル重み0.7・本文0.3、既定しきい値0.5）。日本語の分かち書きをしないため言語非依存だが、**言語をまたいだ類似判定はできない**（同一トピックでも日英で別候補として残る。実用上は許容）。
- 本接続への差し替え点は `adapters/index.ts`（`getAdapter`）1箇所。段階的にlive実装をレジストリへ追加する方式（拡張E15/E16確定）:
  - riot（拡張E15）: Riot Data Dragon（公式静的データCDN、APIキー不要）。
  - reddit（拡張E16）: Application-only OAuth2(client_credentials)。env `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`未設定時は空配列＋ログでグレースフルスキップ（他ソースを止めない）。運用コスト: Reddit API無料枠（OAuth app-only、個人開発規模なら無料）。
  - clip（拡張E17）: YouTube Data API v3（検索、env `YOUTUBE_API_KEY`）＋Twitch helix clips（client_credentials、env `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`）を1つの`ClipAdapter`が両方から取得。各社キーは独立に任意、未設定の社だけ空配列＋ログでスキップ。記事化は逐語転載ではなく「埋め込み紹介」形式（新カテゴリ「動画・クリップ」）。運用コスト: 両API無料枠内（個人開発規模・低頻度ポーリングなら無料）。
  - 5ch（拡張E18）: 公式APIが無く subject.txt/dat のスクレイピング（キー不要・env `FIVECH_BOARDS`/`FIVECH_USER_AGENT`で対象板・UAを設定）。HTML/dat仕様変更で壊れやすい**ベストエフォート**前提。取得失敗・板無効時は空配列＋ログでグレースフルスキップ（他ソースを止めない）。逐語転載は著作権・5ch転載規約に抵触し得る最大リスクのため削除依頼(`CONTACT_EMAIL`)への即応が唯一の実質的な安全弁（法的責任は運営者側に帰属）。運用コスト: 無料（追加費用なし。新規依存ライブラリも追加しない）。これでフェーズ2「実データ収集の本接続」が全4ソースで完了。

## 広告差し込み方式
- 広告コード（AdSense 等のタグ文字列）は**設定/env で受け取り**、記事上部・本文中(見出し間)・記事末尾・サイドバー・一覧内の各枠コンポーネントに差し込む。
- 未設定時はプレースホルダー枠を表示。枠にラベル/区切りを付け本文と視覚区別（AdSense ポリシー: コンテンツ誤認・クリック誘導配置をしない）。アカウント開設・審査は Non-Goal。

## 運用コストの見積り
- **ホスティング**: 無料枠で無人運用が可能。推奨パターン: (A) 単一 Next.js アプリを永続ディスクのある無料/低額ホスト（例: Oracle Cloud always-free VM 等）で常駐＋in-process cron、(B) パイプラインを CI の無料スケジュール実行（例: GitHub Actions 無料枠 ~2000分/月）で回し静的成果物を無料 CDN（Cloudflare Pages / GitHub Pages）へ配信。最終デプロイ接続は Non-Goal のため本番先は未確定だが、いずれも月額固定費ゼロで成立。
- **LLM（唯一の主要従量コスト）**: Claude Haiku 4.5 は低単価。1記事あたり概算「入力〜2k＋出力〜1k トークン」で **1記事 1円未満**。10記事/日（~300記事/月）で **概ね月 数百円〜$5 程度**。品質重視で Sonnet 系に切替えると数倍。個人運営として現実的。※Anthropic の最新価格・モデル ID は準備時に一次情報で確認すること（価格・ID は改定され得る）。
- **その他**: SQLite・Next.js・Vitest・各種 OSS はすべて無料。追加 SaaS 契約なし。
- 全体として、恒久的な自動運営の固定費は実質「LLM 従量のみ」で、個人開発の収益化前提として現実的。

## 環境上の注意点 / 前提
- **Mac 依存なし**。Windows 11 / Node 24 で完結。ネイティブC++ビルドを要する依存（better-sqlite3 等）は Node24×Windows でビルド詰まりの恐れがあるため**避け、Prisma+SQLite（プリコンパイル済みエンジン）を採用**。
- **管理者権限インストール不要**。すべて npm ローカル依存＋ Prisma エンジン/ Playwright ブラウザのユーザ領域ダウンロードのみ。
- **evaluator は Playwright で検証可能**: ローカル `next start`（または `next dev`）で公開サイト・404・レスポンシブ・ダッシュボードをブラウザ操作検証できる。パイプライン/ロジックは `npm run pipeline` と Vitest で検証。
- LLM は本接続だが、テスト・自動検証はスタブで決定論化するため API キー無しでも Green にできる（実生成の目視確認時のみキーが要る）。

## ジェネレーターへの指針
- 閲覧サイトの SEO 出力(F13) は Next.js の Metadata API / `sitemap.ts` / `robots.ts` を使い、管理・保留キュー領域は robots で除外する。
- パイプライン本体（収集→重複排除→生成→タイトル→安全→公開）は `lib/` の純ロジックとして UI から分離し、`SourceAdapter` と `LLMClient` を DI で受け取る。UI/フレームワーク層に業務ロジックを埋め込まない。
- LLM は必ず `LLMClient` 越しに呼ぶ。モデル ID・API キーは env 経由（ハードコード禁止、`.env.example` にキー名のみ）。
- 判定系ロジック（逐語一致率・タイトル品質・NGワード/中傷/出典欠落/未確認ラベル・重複排除）は**LLM 非依存の純関数**にし、Vitest で合格例・不合格例の両方をテスト（各スプリントの「自動テスト Green」基準を満たす）。
- 収集・広告は差し替え可能な抽象越しにのみ触る。fixture ベースのモックで受け入れ基準を満たしつつ、本接続への交換点を増やさない。
- データは SQLite 単一ファイル＋Prisma スキーマで管理し、マイグレーションを積み上げる。テストは専用テスト DB（またはインメモリ相当）で分離。
- 細部（コンポーネント分割・CSS 詳細・具体的な Prisma クエリ・プロンプト文言・ラベル/フック語彙）は generator 裁量。上記の骨格（言語/FW/データ層/テスト/LLM=Claude/アダプタ2抽象）は各スプリントで共有の土台として維持する。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
