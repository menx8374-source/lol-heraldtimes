---
tags: [home, moc]
---

# Home

spec-pipelineの全ドキュメントへの入口(MOC)です。プロジェクトフォルダ(または`docs/`)をObsidianのVaultとして開くと、ここから全スプリントのレポート・仕様書・進捗ダイジェストへwikilinkで辿れます。チャットでClaude Codeに「スプリント3は何をやった?」のように聞き直す代わりに、ここを見れば無料で(トークンを使わずに)確認できます。

## ダイジェスト
- [[project-memory]] — プロジェクト全体の進捗・技術選定の要約(常に最新化)
- [横断学習メモリ](../reference/learnings.md) — 案件をまたぐ教訓(planner/architect/generatorが着手前に参照。プロジェクトルートをVaultとして開いた場合は [[learnings]] でも辿れる)

## 仕様
- [[lol-matome-sokuhou-spec]] — 製品仕様書（機能15件・スプリント10本）
- [画面ワイヤーフレーム](spec/lol-matome-sokuhou-wireframes.html)（HTMLファイルはObsidianのwikilink対象外のため通常のMarkdownリンクで参照）
- [[lol-matome-sokuhou-architecture]] — 技術選定メモ（TypeScript / Next.js / SQLite+Prisma / Vitest、LLM・収集は差し替え可能な抽象で当面モック）

## スプリント
- **Sprint 1** ✅ PASS — 記事データモデルと閲覧サイトの土台
  - brief: [[sprint-1-brief]] ／ 自己評価: [[sprint-1-selfeval]] ／ 評価: [[sprint-1-evaluation]]
  - プレビュー: [トップ一覧](sprints/sprint-1-preview-1.png) ／ [個別記事](sprints/sprint-1-preview-2.png)
- **Sprint 2** ✅ PASS（試行2） — カテゴリ・タグ・検索・サイドバー・人気ランキング・関連記事
  - brief: [[sprint-2-brief]] ／ 自己評価: [[sprint-2-selfeval]] ／ 評価: [[sprint-2-evaluation]]
  - プレビュー: [タグ一覧(#ヤスオ)](sprints/sprint-2-preview-1.png) ／ [トップページ](sprints/sprint-2-preview-2.png)
- **Sprint 3** ✅ PASS — ソース収集パイプライン（収集はモック）と重複排除
  - brief: [[sprint-3-brief]] ／ 自己評価: [[sprint-3-selfeval]] ／ 評価: [[sprint-3-evaluation]]
  - バックエンド/バッチ（新規画面なし）。`npm run collect` で収集→重複排除→候補キュー再構築
- **Sprint 4** ✅ PASS — AIまとめ記事本文の自動生成（LLMはモック）
  - brief: [[sprint-4-brief]] ／ 自己評価: [[sprint-4-selfeval]] ／ 評価: [[sprint-4-evaluation]]
  - プレビュー: [生成記事(riot)](sprints/sprint-4-preview-1.png) ／ [生成記事(reddit)](sprints/sprint-4-preview-2.png)。`npm run generate` で候補→記事化
- **Sprint 5** ✅ PASS — 煽り速報タイトル生成と品質チェッカー（中核差別化・LLMはモック）
  - brief: [[sprint-5-brief]] ／ 自己評価: [[sprint-5-selfeval]] ／ 評価: [[sprint-5-evaluation]]
  - プレビュー: [トップ(煽りタイトル)](sprints/sprint-5-preview-1.png) ／ [個別記事](sprints/sprint-5-preview-2.png)。10件サンプル合格率100%
- **Sprint 6** ✅ PASS — 公開前コンテンツ安全フィルタ・モデレーション
  - brief: [[sprint-6-brief]] ／ 自己評価: [[sprint-6-selfeval]] ／ 評価: [[sprint-6-evaluation]]
  - プレビュー: [未確認ラベル付き記事](sprints/sprint-6-preview-1.png) ／ [保留記事非表示のトップ](sprints/sprint-6-preview-2.png)。公開状態(published/held)導入

## 実行状況
- [dashboard.html](./dashboard.html) — リアルタイム進捗ダッシュボード（ブラウザで開く。30秒ごとに自動更新、「今すぐ更新」で即時更新も可能）

## 補足: NotebookLMで使う場合
このVault配下のMarkdown(特に[[project-memory]])をNotebookLMに手動でアップロードすると、Claude Codeのトークンを使わずに自然言語でQ&Aや音声概要を作れます。NotebookLMへの自動連携はしていません(公開APIが無いため)。
