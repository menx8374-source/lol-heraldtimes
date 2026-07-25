# LoL まとめ速報サイト 自動運営システム

League of Legends（LoL）の情報を扱う日本語の「まとめ速報」型ゲーム情報サイトと、その記事の収集・生成・掲載・定期更新までを人手なしで回す自動運営システム。Reddit（r/leagueoflegends 等）や 5ch のスレッド反応をまとめた記事を主軸に、Riot 公式のパッチノート・大会結果・公式ニュース等の一次情報も記事化し、扇情的（好奇心ギャップ型）なまとめ速報タイトルで多数掲載してディスプレイ広告で収益化することを目指す。運営者の手動操作なしで日々の記事投稿を自動化し、恒久的な収入源にすることが目的。

- 製品仕様書: [docs/spec/lol-matome-sokuhou-spec.md](docs/spec/lol-matome-sokuhou-spec.md)
- 画面ワイヤーフレーム: [docs/spec/lol-matome-sokuhou-wireframes.html](docs/spec/lol-matome-sokuhou-wireframes.html)
- 進捗ダッシュボード: `docs/dashboard.html` をブラウザで開く（30秒ごとに自動更新）

## 対象プラットフォーム
`web`（閲覧者向けの公開サイト＋自動運営のバックエンド／バッチ処理）。スマートフォン・PC 双方のブラウザで崩れず読めるレスポンシブ表示。

## 起動方法

```bash
npm install                # 依存関係インストール（postinstall で prisma generate も実行）
npx prisma migrate dev     # 初回のみ: SQLite DB(prisma/dev.db) を作成・マイグレーション適用
npm run db:seed            # サンプル記事（12件）を投入
npm run dev                # 開発サーバー起動（http://localhost:3000）
```

- 本番相当で確認する場合: `npm run build && npm run start`
- テスト実行: `npm test`（Vitest）
- **収集パイプライン実行**: `npm run collect`（reddit/5ch/riot からの収集 → 重複排除 → 記事化候補キュー再構築を実行し、結果をコンソールに表示。DB は `npx prisma studio` でも閲覧できる）
  - 収集は各ソースとも fixture（`src/lib/collection/fixtures/*.json`）を読む **モック実装**（本番 API 未接続）。
  - ソースごとに実行間隔（既定: reddit/5ch 10分、riot 30分）を設けているため、直後に連続実行すると2回目以降は `skipped-rate-limited` になる（意図した挙動。上限・間隔の検証はこの動作で確認できる）。
- **AIまとめ記事生成パイプライン実行**: `npm run generate`（記事化候補キュー(status="queued")を1件ずつ処理し、Article(+ArticleSource)を作成。結果をコンソールに表示。`npm run collect` の後に実行する）
  - 生成LLMは決定論的な**モック実装**（テンプレート/ルールベース、API キー不要）。逐語一致率・引用の主従関係・最低文字数を満たさない候補は「生成失敗」(`CollectedItem.status="generation_failed"`、`generationError`にエラー内容を記録)として扱われ、他候補の生成は継続する。
  - 生成に成功した候補は `CollectedItem.articleId` と `status="articled"` が同一トランザクションで同期される（再実行しても二重記事化しない）。
  - **公開前コンテンツ安全フィルタ（F9）**: 生成した本文＋タイトルを NGワード／出典欠落／特定個人への中傷・晒し／重複の観点で判定し、通過した記事のみ `Article.status="published"` として公開される。通過しない記事は `status="held"`（保留）となり `heldReason`/`heldDetail` に理由が記録され、閲覧サイトの一覧・検索・個別ページのいずれにも表示されない（保留キューは `src/lib/moderation/queue.ts` の `listHeldArticles()` で参照できる）。未確定・噂レベルの表現を含む記事は保留にはせず `unconfirmed=true` として公開され、記事ページに「未確認情報」ラベルが表示される。
- **統合パイプライン実行（F10・F11）**: `npm run pipeline`（収集→重複排除→記事生成→タイトル生成→安全フィルタ→公開までを1回の起動で人手介入なしで実行する。`npm run collect`+`npm run generate` を1本のオーケストレーションにまとめたもの）
  - 1回の実行で公開する記事本数の上限は `PIPELINE_MAX_PUBLISH_PER_RUN`（既定5件）。上限を超えた候補は次回実行に持ち越される（破棄されない）。
  - 実行間隔（スケジュール設定）は `PIPELINE_INTERVAL_MS`（既定4時間）。実際のcron常駐は本スプリントの対象外のため、`npm run pipeline` を間隔を空けて再実行する運用を想定する（実行結果に「次回実行の目安」を表示する）。
  - 収集ソース・生成・タイトル・安全フィルタのいずれか1件が失敗しても、パイプライン全体は停止せず他候補の処理を完走する。生成・タイトル付けに失敗した候補（`status="generation_failed"`）は破棄されず、次回実行時に再度候補として処理される。
  - 各実行の収集件数・記事化候補数・生成成功/失敗数・公開数・保留数は `PipelineRunLog` テーブルに記録される（Sprint 9 の運営ダッシュボードが参照する想定）。

## 環境変数

`.env`（gitignore 済み・コミットしない）に以下を設定する。値はキー名のみ `.env.example` に記載済み。いずれも秘密情報ではなく、収集はモックのため外部認証情報は不要。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `DATABASE_URL` | 必須 | SQLite ファイルの場所。既定値 `file:./dev.db`（秘密情報ではない） |
| `ANTHROPIC_API_KEY` | 後続スプリントで使用 | LLM 本接続用の Anthropic API キー（Sprint 1 時点では未使用） |
| `ANTHROPIC_MODEL` | 任意 | 使用モデル。既定 `claude-haiku-4-5`（Sprint 1 時点では未使用） |
| `COLLECTION_MODE` | 任意 | `mock`（既定）／`live`。`live` は本接続アダプタ未実装のためエラーになる |
| `COLLECTION_REDDIT_MAX_ITEMS` / `COLLECTION_5CH_MAX_ITEMS` / `COLLECTION_RIOT_MAX_ITEMS` | 任意 | ソースごとの1回の収集実行あたりの取得件数上限（既定: reddit/5ch=10, riot=20） |
| `COLLECTION_REDDIT_MIN_INTERVAL_MS` / `COLLECTION_5CH_MIN_INTERVAL_MS` / `COLLECTION_RIOT_MIN_INTERVAL_MS` | 任意 | ソースごとの最小実行間隔(ミリ秒)。既定: reddit/5ch=600000(10分), riot=1800000(30分) |
| `GENERATION_MODE` | 任意 | `mock`（既定、APIキー不要の決定論的モックLLM）／`live`。`live` は本接続実装未整備のためエラーになる |
| `PIPELINE_MAX_PUBLISH_PER_RUN` | 任意 | 統合パイプライン(`npm run pipeline`)1回の実行で処理・公開する記事本数の上限（既定5件） |
| `PIPELINE_INTERVAL_MS` | 任意 | 統合パイプラインの繰り返し実行の目安間隔(ミリ秒)。既定14400000(4時間) |
| `SITE_URL` | 任意 | サイトの絶対URLベース（既定 `http://localhost:3000`）。OGP／構造化データ／サイトマップ／robotsの絶対URL生成に使う |
| `AD_SLOT_ARTICLE_TOP` / `AD_SLOT_ARTICLE_IN_BODY` / `AD_SLOT_ARTICLE_BOTTOM` / `AD_SLOT_SIDEBAR` / `AD_SLOT_LISTING` | 任意 | 各広告枠（記事上部／本文中／記事末尾／サイドバー／一覧内）に差し込む広告タグ文字列（AdSense等）。未設定時はプレースホルダー枠を表示 |
| `CONTACT_EMAIL` | 任意 | `/contact`（お問い合わせ・掲載削除依頼ページ）に表示する連絡先メールアドレス。未設定時は `SITE_URL` のホスト名から `contact@<host>` を自動生成 |
| `SITE_NOTICE` | 任意 | 運営お知らせバー（拡張E1、サイト最上部）に表示する1行の文言。未設定時はバー自体を表示しない |
| `BLOG_RANKING_HTML` | 任意 | ブログランキング/外部集客枠（拡張E4、サイドバー）に差し込む外部ランキング（にほんブログ村等）のバナー/リンクHTML。未設定時はプレースホルダーを表示 |

## 外部サービス接続の方針（現時点）
当面はすべて **モック実装** で全スプリントを通し、将来の実運用時に順次本接続へ差し替える。いずれも差し替え可能な抽象越しに呼ぶ設計。
- **LLM 記事・タイトル生成（F7・F8）**: `LLMClient` 抽象越しの決定論的モック実装（API キー不要）。将来は Anthropic Claude（`ANTHROPIC_API_KEY`・既定 `claude-haiku-4-5`）へ差し替え可能。
- **ソース収集（Reddit／5ch／Riot 公式・F5）**: `SourceAdapter` 抽象越しの fixture モック。認証情報が揃い次第 本接続に切り替える。
- **AdSense 広告（F12）**: アカウント開設・審査は Non-Goal。広告タグを差し込める枠と、設定でタグ文字列を受け取る仕組みまで（未設定時はプレースホルダー枠）。

## 回遊・エンゲージメントUI（拡張E1）
公開サイト（トップ／カテゴリ／タグ／検索／個別記事）に以下を追加している（`/admin` には影響しない）。
- 一覧のページネーション（1ページ20件、`?page=` クエリ）
- 記事カードの本文抜粋・コメント数表示（`Article.commentCount`。拡張E2で実際のコメント投稿数に連動）
- 投稿日時の相対表示（「3時間前」等。30日以上前は絶対日時表記）
- 個別記事のSNSシェアボタン（X／LINE／はてなブックマーク／URLコピー）
- 個別記事の絵文字リアクション（😂😮😡👍。押下で加算、`ArticleReaction` テーブルに永続化）
- ヘッダーのダークモード切替（`prefers-color-scheme` 初期値＋localStorage保存）
- 運営お知らせバー（`SITE_NOTICE`、閉じるとlocalStorageで次回以降非表示）
- トップページ上部の注目記事(PICKUP)カード列（閲覧数上位）

## コメント欄（拡張E2）
ログイン機能は無い方針のため匿名で投稿できる（記名は任意、未入力は「名無しさん」）。
- 個別記事ページ下部にコメント一覧＋投稿フォーム。まとめ速報のレス形式（番号:名前＝緑、`>>N`アンカー＝オレンジ）に表示を揃える。
- 投稿は `POST /api/articles/[slug]/comments`（Route Handler）で受け、入力検証（本文必須・最大1000字／名前最大30字）→ 簡易スパム対策（ハニーポット隠しフィールド・直前と同一本文の10秒以内連投拒否）→ 安全フィルタ（F9のNGワード・個人中傷/晒し検出を再利用）の順に判定する。
- 安全フィルタを通過したコメントのみ `status="published"` として公開され、`Article.commentCount` に加算される。通過しないコメントは `status="held"` として記録だけ残し、公開サイトには一切表示しない（詳細な保留理由はユーザーに見せず、穏当なメッセージのみ返す）。
- サイドバーに全記事横断の「新着コメント」ウィジェットを表示する。
- コメント本文・名前は必ず React の子要素として描画し（自動エスケープ）、`dangerouslySetInnerHTML` は使用しない（XSS対策）。

## 法務コンプライアンス表示（F15）
全ページ共通のフッターに Riot 非公認ディスクレーマー・AI自動生成注記・以下の固定ページへの導線を常設している。
- `/disclaimer`（免責事項）: 非公認・AI生成・出典/外部リンクの責任範囲・法的助言でない旨
- `/privacy`（プライバシーポリシー）: アクセス解析・広告(Cookie)・個人情報の取り扱い方針
- `/contact`（お問い合わせ・掲載削除依頼）: 掲載内容の削除依頼（オプトアウト）の連絡先案内

## SEO/集客（拡張E4）
- `/feed.xml`: 公開記事のRSS 2.0フィード（直近30件、タイトル/リンク/抜粋/公開日時）。`<head>` に `<link rel="alternate" type="application/rss+xml">` を出力。
- 期間別人気ランキング: サイドバーの人気記事ランキングに累計/日間/週間/月間タブを追加（`ArticleView` テーブルの閲覧イベントを期間cutoffで集計。切替は `GET /api/ranking?period=day|week|month` をクライアント側から呼ぶ）。
- サイドバーに人気タグ（タグクラウド）・月別アーカイブウィジェットを追加。`/archive`（月一覧）・`/archive/[YYYY-MM]`（月別記事一覧）ページを新設。
- 個別記事・カテゴリ・タグ・アーカイブページにパンくずリスト（可視表示＋BreadcrumbList JSON-LD）を追加。
- サイトマップにタグページ・アーカイブページを追加（公開記事のみ）。

## 開発フロー
このプロジェクトは `planner` / `architect` / `generator` / `evaluator` の4サブエージェントを `spec-pipeline` スキルがオーケストレーションする自律開発フローで進める。詳細は [CLAUDE.md](CLAUDE.md) を参照。
