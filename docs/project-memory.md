---
tags: [project-memory]
status: active
---

# プロジェクトメモリ

このファイルはspec-pipelineオーケストレーターがスプリント境界のたびに更新する、プロジェクト全体の要約ダッシュボードです。要約であっても**受け入れ基準・評価基準など判定に関わる原文は改変せず転記**し、意見や推測で薄めません。

- Obsidianでこのフォルダを開いている場合、[[Home]] から辿れます。
- ここに書かれた内容をNotebookLM等に手動でアップロードすれば、Claude Codeのトークンを使わずにQ&Aや要約が作れます（自動連携はしていません）。

## 概要
League of Legends（LoL）の日本語「まとめ速報」型サイトと、記事の収集→生成→掲載→定期更新を人手なしで回す自動運営システム。Reddit・5ch の反応まとめを主軸に、Riot 公式の一次情報も記事化し、好奇心ギャップ型の煽り速報タイトル（参考: 「Overwatch攻略まとめ速報@おばにゅー」）で多数掲載、ディスプレイ広告（AdSense 等）で収益化する。運営者の手動操作なしの完全自動運営で恒久的な収入源にすることが目的。閲覧は無料・読み取り専用。

- 仕様書: [[lol-matome-sokuhou-spec]]（`docs/spec/lol-matome-sokuhou-spec.md`）
- 画面ワイヤーフレーム: `docs/spec/lol-matome-sokuhou-wireframes.html`
- 機能: F1〜F15（15件） / スプリント: 10本

## 対象プラットフォーム / 技術選定
- **対象プラットフォーム**: `web`（閲覧者向け公開サイト＋自動運営バックエンド／バッチ処理。レスポンシブ）。
- **技術選定（architect 確定 2026-07-25）**: 技術ベースライン → [[lol-matome-sokuhou-architecture]]（`docs/spec/lol-matome-sokuhou-architecture.md`）
  - 言語/ランタイム: TypeScript / Node.js 24（導入済み v24.18.0・Windows・管理者権限不要）
  - FW: Next.js（App Router）+ React + Tailwind CSS（SSR/静的生成で SEO・OGP・JSON-LD・sitemap・robots を確実化）
  - データ層: SQLite 単一ファイル + Prisma ORM（プリコンパイル済みエンジンで native ビルド不要）
  - テスト基盤: Vitest（判定系は LLM 非依存の純関数で決定論的に Green）
  - LLM: `LLMClient` 抽象越し。**当面はモック実装**（下記）。将来の本接続候補は Anthropic Claude（既定モデル `claude-haiku-4-5`、env `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`）
  - 収集: `SourceAdapter`（reddit/5ch/riot）抽象。当面 fixture JSON のモック。設定で mock↔live 切替
  - 広告: 設定/env でタグ受け取り→枠に差し込み、未設定時プレースホルダー
  - 想定運用コスト: OSS・SQLite・ホスティングは無料枠。将来 LLM 本接続時のみ従量（Haiku 4.5 で 1記事1円未満想定）

## スプリント進捗
| Sprint | 目標 | 状態 | 備考 |
|---|---|---|---|
| 1 | 記事データモデルと閲覧サイトの土台（トップ一覧・個別記事） | pass | 記事12件シード・レスポンシブ実測・Vitest9件Green・依存脆弱性0 |
| 2 | カテゴリ・タグ・検索・サイドバー・人気ランキングで回遊 | pass | 試行2でPASS（日本語タグのdecodeURIComponent修正）・Vitest26件Green |
| 3 | ソース収集パイプラインと重複排除 | pass | 収集はモック（fixture）・67テストGreen・CollectedItem/SourceFetchLog追加 |
| 4 | AIまとめ記事本文の自動生成 | pass | LLMモック（決定論）・生成6件・逐語一致率0.06〜0.39・84テストGreen・候補状態を原子的同期 |
| 5 | 煽り速報タイトル生成と品質チェッカー（中核差別化） | pass | LLMモック（決定論）・10/10=100%合格・ラベル/フック分散・捏造防止・97テストGreen |
| 6 | 公開前コンテンツ安全フィルタ・モデレーション | pass | Article.status(published/held)導入・NGワード統合・保留記事はサイト非露出/直URL404・115テストGreen |
| 7 | 自動公開スケジューリング・エラー耐性・運営ログ | pass | 全モック・runFullPipeline統合・PipelineRunLog・3連続実行で0→5→7件・124テストGreen |
| 8 | 広告枠差し込み・SEO・構造化データ・サイトマップ | pass | 広告枠(env設定/プレースホルダー)・OGP/JSON-LD/sitemap(公開のみ)/robots・137テストGreen |
| 9 | 運営監視ダッシュボード | pending | |
| 10 | 出典表記・非公認ディスクレーマー・免責／オプトアウト（法務） | pending | |

## 既知の課題・要人手介入
- **外部接続の方針（ユーザー決定 2026-07-25、更新済み）**: **当面すべてモック実装で全スプリントを通す**（当初 LLM は本接続予定だったが、ユーザーが「LLM 本接続もスキップし、まずモックで全スプリントを通す」と再決定）。
  - **LLM 記事・タイトル生成（F7・F8 / Sprint 4・5・7）はモック／スタブ**。`LLMClient` 抽象越しに、API キー不要の決定論的モック実装（テンプレート／ルールベース）を既定にする。品質チェッカー等の判定ロジックは LLM 非依存で自動テスト Green。後日 Anthropic Claude（`ANTHROPIC_API_KEY`）へ差し替え可能な抽象を維持。**現時点でユーザーの手動キー準備は不要**。
  - **ソース収集（Reddit／5ch／Riot 公式・F5・F6 / Sprint 3・7）はモック／サンプル**。`SourceAdapter` 抽象で差し替え可能にし、認証情報が揃い次第 本接続に切り替える。evaluator はモック前提で判定する。
  - **AdSense 広告（F12 / Sprint 8）はプレースホルダー枠＋設定でタグ受け取り**まで（アカウント開設・審査は Non-Goal）。
  - → 将来、実運用（恒久収入化）に進む際は、これらモックを順に本接続へ差し替える（LLM: Anthropic キー、収集: 各ソースの取得実装、広告: AdSense 審査通過後のタグ、最終デプロイ接続）。
- **Sprint 4 への申し送り（Sprint 3 の設計から）**: 候補（`CollectedItem`, status=`queued`）から記事を生成したら、**その `CollectedItem` の `articleId` をセットし、`status` も `articled` に必ず同期する**こと。`rebuildCandidateQueue` は `articleId=null` の行のみ対象にし、`ArticleSource.url` 一致でも `articled` にするが、articleId と status が食い違うと `listCandidateQueue`（status=queued抽出）が同アイテムを再提示して**二重記事化**を招く。生成時に articleId と status を原子的に揃える（または articled 判定を articleId 由来の単一導出にする）実装にする。
- **将来の本接続時のセキュリティ注記**: live 収集アダプタ実装時は、外部URLフェッチのSSRF対策・取得した外部コンテンツ（掲示板/SNS本文）のサニタイズ（記事生成・表示前）を必須とする。現状モックでは外部通信なし。
- **Sprint 6 への申し送り（Sprint 4 の設計から）**: 現状、記事生成（`src/lib/generation/pipeline.ts`）は成功時に `Article` を `publishedAt=now` で**即時公開**する（`Article` に下書き/公開状態フラグは無く、`listArticles` 等は全件を公開扱いで表示）。Sprint 4 の受け入れ基準「生成記事はサイトに表示される」を満たすための仕様。**Sprint 6（安全フィルタ F9）で「フィルタ通過まで非公開（保留キュー）」を実装する際は、`Article` に公開状態（例: `status`: pending/published/held）を追加し、生成は「未公開ドラフト」で作成→安全フィルタ通過で公開、に変更する。同時に `listArticles`/カテゴリ/タグ/検索/人気/関連/サイトマップ等の閲覧系クエリを「公開済みのみ」に絞る**（現在は全件表示のため要修正）。この公開ゲートは Sprint 7 の自動公開パイプライン統合の要にもなる。
- **Sprint 6 への申し送り（Sprint 5 の設計から）**: (1) タイトル生成（`src/lib/generation/title.ts`）に暫定の `NG_WORDS`/`stripUnsafe` 安全フィルタが**タイトル経路のみ**に実装されている（F8要件）。本文経路（`compose.ts`）には無いので、**Sprint 6 の安全フィルタ F9 は本文＋タイトルの両方を対象にした一般化された安全層**として実装し、可能ならタイトル側の暫定フィルタと統合（NGワードリストの二重管理を解消）する。(2) 品質チェッカー `checkTitleQuality` は現在テストのみで使用され、生成パイプラインに配線されていない。安全フィルタ導入時に「生成→品質/安全検証→不合格は保留」の検証境界としてパイプラインに組み込むと、seam が一箇所に揃う。
- **技術的負債メモ**: 本文ブロック→テキスト連結が `src/lib/search.ts` の `bodyBlocksToText` と `generation/generate-article.ts`・`generation/pipeline.ts` に重複（3箇所）。本来は `src/lib/article-body.ts`（`ArticleBodyBlock` の定義元）に区切り文字パラメータ付きで集約し全箇所から呼ぶのが筋（差分外のため各スプリントでは見送り。着手時は search 側の挙動=空白区切りを壊さないよう注意）。
- **法的リスク（仕様書リスク欄より）**: 掲示板／SNS 転載の著作権・利用規約（要約再構成・主従引用・出典明記で緩和）、AdSense の自動生成／コピーコンテンツポリシー、Riot API／公式コンテンツ規約と非公認ディスクレーマー、無審査公開リスク（安全フィルタ→保留キューで緩和）。
