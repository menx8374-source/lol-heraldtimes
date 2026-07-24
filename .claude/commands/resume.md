---
description: 中断した spec-pipeline を安全に再開する（多重起動チェック → 未完了スプリントから継続）
argument-hint: "[開始スプリント番号（省略可）]"
---

中断されていた spec-pipeline を安全に再開します。次の順で進めてください。

1. **多重起動の検知**: `docs/pipeline-status.js` の `phase` と `lastUpdated` を確認する。`phase` が `idle`/`completed` 以外で、かつ `lastUpdated` が現在からおおむね10分以内なら、別セッションが実行中の可能性がある。その場合はユーザーに確認を取ってから続行する（詳細は `spec-pipeline` スキルの「前提: 多重起動の検知」に従う）。
2. **文脈の復元**: `docs/project-memory.md` を読み、完了済みスプリント・直前のFAIL理由・未解決の既知課題を把握する。`docs/pipeline-status.js` の `sprints` 配列から、最初の `pass` でも `human_intervention` でもないスプリント（= 次に着手すべきスプリント）を特定する。
3. **spec の特定**: `specPath` から仕様書パスを取得する。`docs/sprints/sprint-<N>-brief.md` が無いスプリントがあれば、`spec-pipeline` スキルの手順に従って先に生成する。
4. **再開**: `spec-pipeline` スキルを、特定した spec.md パスと開始スプリント番号（引数 `$ARGUMENTS` があればそれを優先、無ければ 2 で特定した番号）で呼び出し、通常のスプリントループを続行する。

`human_intervention` で止まっていたスプリントを再挑戦したい場合は、その番号を引数で明示的に指定してください（`git stash list` に退避された変更があれば、再開前にユーザーへ復元の要否を確認する）。
