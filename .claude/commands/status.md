---
description: 現在のパイプライン進捗（スプリント状況・直近イベント・要対応事項）を要約表示する
allowed-tools: Read, Glob
---

`docs/pipeline-status.js` を読み、現在の spec-pipeline の状態を日本語で簡潔に要約してください。ファイルが存在しない、または `phase: "idle"` の場合は「まだパイプラインは開始されていません」と伝えます。

出力は以下を含める（該当がある項目だけ、箇条書きで簡潔に）:

- **プロジェクト名 / 対象プラットフォーム / フェーズ**
- **進捗**: 全スプリント数・PASS数・要人手介入数（例: 3/7 PASS、1件 要人手介入）
- **現在のアクティビティ**: `currentActivity` の agent とラベル（動いている場合）
- **各スプリントの状態**: 番号・目標・状態（pending/in_progress/fail_retry/human_intervention/pass）を1行ずつ。`lastIssue` があれば併記
- **要対応**: `human_intervention` のスプリントとその理由、Bash縮退で未検証のスプリント、未解決の既知課題（`docs/project-memory.md` の「既知の課題・要人手介入」も参照）
- **ダッシュボード**: 「`docs/dashboard.html` をブラウザで開くとリアルタイムに確認できます」と一言

レポート全文の垂れ流しはせず、状態の要約に徹してください。この確認自体は読み取りのみで、パイプラインの進行・状態ファイルの書き換えは行いません。
