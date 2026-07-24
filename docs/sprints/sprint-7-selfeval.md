---
tags: [sprint-selfeval]
sprint: 7
---

# Sprint 7 自己評価レポート

## 実装した内容
- 統合パイプラインオーケストレーション `src/lib/pipeline/run-pipeline.ts`（`runFullPipeline`）: Sprint3〜6の各工程（`runCollectionPipeline`→`rebuildCandidateQueue`→`generateArticlesForQueue`）を1本の関数としてつなぎ、1回の実行で人手介入なしに収集→重複排除→生成→タイトル→安全フィルタ→公開まで完走する。工程をまたぐ想定外の例外に対する最後の安全網（try/catch）を持ち、テスト用にDIフック（`runCollection`/`rebuildQueue`/`generateArticles`差し替え）を用意。
- `src/lib/pipeline/config.ts`: 公開本数上限(`PIPELINE_MAX_PUBLISH_PER_RUN`既定5)・実行間隔(`PIPELINE_INTERVAL_MS`既定4時間)の設定と`computeNextRunAt`純関数。
- `src/lib/generation/pipeline.ts`の`generateArticlesForQueue`に`maxCandidates`オプションを追加（既存呼び出しは後方互換・無制限のまま）。処理数を上限以下に抑えることで、公開数もその上限を超えない。上限超過分はDB状態を変更しないため次回実行で再度処理対象になる。
- `PipelineRunLog`テーブル（Prisma migration `20260724222728_add_pipeline_run_log`）: 実行ごとに開始/終了時刻・ステータス・収集件数・候補数・生成成功/失敗数・公開数・保留数・エラーメッセージを記録。ログ保存自体の失敗は実行結果に影響させない。
- `scripts/pipeline.ts`（`npm run pipeline`）: 単発実行コマンド。実行結果サマリと次回実行の目安時刻を表示。
- テストDB基盤（本スプリントで初めてPrisma連携の結合テストを追加したため新規導入）: `vitest.global-setup.ts`でテスト専用SQLiteファイル(`prisma/test.db`)を毎回まっさらに作り直し`DATABASE_URL`を差し替え、開発用`dev.db`を汚さない。
- README・.env.exampleに`npm run pipeline`と新規環境変数を追記。

## 技術選定
- 新規依存パッケージの追加なし（architecture.mdのnode-cronは、brief側で「実際のcron常駐は本スプリント不要」と明記されているため今回は導入せず、間隔設定(`PIPELINE_INTERVAL_MS`)と単発実行コマンドのみ実装。将来常駐運用する際にnode-cronでラップする余地は`scripts/pipeline.ts`をそのまま呼べる形にして残した）。
- Prisma結合テスト用に`vitest`の`globalSetup`で専用テストDBを都度再構築する方式を採用（`prisma db push --accept-data-loss`）。新規パッケージ不要・既存のPrisma CLIのみで完結。

## 受け入れ基準チェック（自己申告）
- [x] スケジュール実行を1回起動すると収集→重複排除→生成→タイトル→安全フィルタ→公開まで人手介入なしで完走し、新しい公開記事が0件より多く増える: 自動テスト・`npm run pipeline`実運用確認（後述）の両方で確認。
- [x] 1回の実行で公開する記事本数の上限を設定でき、その本数を超えて一度に公開しない: `PIPELINE_MAX_PUBLISH_PER_RUN`（既定5）。自動テストで候補3件・上限1で公開が1件以下であることを確認、実運用確認でも候補7件→上限5件でぴったり5件公開を確認。
- [x] 実行間隔のスケジュール設定を持ち、繰り返し起動を模擬すると毎回新規記事が積み上がる: `PIPELINE_INTERVAL_MS`設定を実装。自動テスト（1回目→2回目で公開数が増分1増える）と実運用確認（1回目0→5件、2回目5→7件）の両方で確認。
- [x] 同じ実行を繰り返しても既公開記事が重複公開されない: 自動テストで同一URLアイテムを含む2回目実行後も公開総数が新規分のみの増分になることを確認。
- [x] 記事化候補が枯渇しているとき、エラーにならず「今回は新規公開なし」で正常終了する: 自動テスト＋実運用確認（3回目実行で候補0・公開0・status="success"）で確認。
- [x] 収集・生成・タイトル・フィルタのいずれか1件を意図的に失敗させても、パイプライン全体は停止せず他記事の処理を完走する: 自動テストで(a)1ソース収集失敗時に他ソース分が公開されること、(b)1候補の生成失敗(最低文字数未達)時に他候補が公開されることを確認。
- [x] 各実行ごとに、収集件数・記事化候補数・生成成功／失敗数・公開数・保留数を含む実行ログが記録される: `PipelineRunLog`に記録。自動テスト＋実運用確認（3回分のログをDBから直接取得し内容を確認、下記に実例記載）。
- [x] 生成・タイトル付けに失敗した候補は破棄されず、次回実行対象になる: 自動テストで`status="generation_failed"`のまま`articleId=null`であること、`rebuildCandidateQueue()`再実行で`status="queued"`に戻ることを確認。
- [x] 全ソースが応答しない最悪ケースでもクラッシュせず、ログにエラーを残して正常終了する: 自動テストで3ソース全てが例外を投げても`report.status==="success"`・`SourceFetchLog`に3件のfailureが記録されることを確認。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev   # 本スプリントのマイグレーション(add_pipeline_run_log)を含め適用
npm run pipeline         # 統合パイプラインを1回実行(収集→重複排除→生成→タイトル→安全フィルタ→公開)
npm run dev              # 閲覧サイト確認用(http://localhost:3000)
npm test                 # Vitest（Prisma結合テストはvitest.global-setup.tsが専用DB(prisma/test.db)を自動構築）
```

## 既知の問題・懸念点
- モック収集アダプタのfixtureは静的・有限（reddit/5ch/riot合計12件）のため、`npm run pipeline`を同一DBに対して繰り返し実行すると、いずれ全アイテムが記事化され尽くして新規公開0件で頭打ちになる（これは受け入れ基準「候補枯渇時は正常終了」そのものであり不具合ではない）。「繰り返し実行で積み上がる」ことは自動テスト（複数バッチを模擬した結合テスト）と、実運用確認で1回目(0→5件)→2回目(5→7件、公開上限で持ち越された候補の処理により増加)という形で実際に確認済み。将来ライブ収集に差し替えれば無制限に新規アイテムが供給される前提。
- 実際のcron常駐（node-cron等によるプロセス常駐スケジューリング）は未実装。brief記載どおり本スプリントの必須要件ではないため、`PIPELINE_INTERVAL_MS`設定と単発実行コマンドのみ用意した。常駐運用が必要になった場合は`scripts/pipeline.ts`の`runFullPipeline()`呼び出しをnode-cron等でラップするだけで対応可能。
- Prisma結合テストは本スプリントで初めて導入したパターン（`vitest.global-setup.ts`で専用DBを都度作り直し）。テストファイルを跨いだ並列実行時のSQLiteファイル競合は、DB結合テストが本ファイル1つのみのため現状問題なし。今後DB結合テストを増やす場合は同一ファイル競合に注意。

## 追加したテスト
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`（結合テスト、Prisma経由で実際にDBへ書き込み検証）:
  - 1回起動での完走・公開増加・実行ログ記録
  - 公開本数上限の遵守
  - 繰り返し実行での積み上がり・重複公開防止・候補枯渇時の正常終了（1テストで一気通貫に検証）
  - 1ソース収集失敗時の全体継続
  - 1候補生成失敗時の全体継続＋次回再処理対象への復帰
  - 全ソース失敗の最悪ケースでの正常終了・ログ記録
  - 工程をまたぐ想定外例外（DIフックで注入）に対する安全網・実行ログへのfailure記録
- `src/lib/__tests__/pipeline-config.test.ts`（純関数）: `getPipelineConfig`の既定値、`computeNextRunAt`の加算ロジック
- テスト結果: `npm test` で **124件全てGreen**（既存115件+本スプリント新規9件、退行なし）
- `npx tsc --noEmit`・`npm run build`・`npm run lint`（既存の無関係warning1件のみ、新規エラーなし）も確認済み

## 実行ログの実例（`npm run pipeline`を専用スクラッチDBで3回連続実行）
```json
[
  { "status": "success", "collectedCount": 8, "candidateCount": 7, "generationSucceeded": 5, "generationFailed": 0, "publishedCount": 5, "heldCount": 0 },
  { "status": "success", "collectedCount": 0, "candidateCount": 3, "generationSucceeded": 3, "generationFailed": 0, "publishedCount": 2, "heldCount": 1 },
  { "status": "success", "collectedCount": 0, "candidateCount": 0, "generationSucceeded": 0, "generationFailed": 0, "publishedCount": 0, "heldCount": 0 }
]
```
（1回目: 公開上限5件で頭打ち・7候補中2件は次回へ持ち越し／2回目: 収集はレート制限でスキップされたが持ち越し候補3件を処理し公開2+保留1(重複判定)で公開総数7件に増加／3回目: 候補枯渇でエラーなく0件公開のまま正常終了。プロセスは自己確認後に終了済み・常駐プロセスは残していない）

## 関連ドキュメント
- [[sprint-7-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
