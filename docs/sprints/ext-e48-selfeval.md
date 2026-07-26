---
tags: [sprint-selfeval]
sprint: E48
---

# 拡張E48 自己評価レポート

## 実装した内容
- F-E48-1: `listCandidateQueue(options)` に `sourceType?: SourceType` を追加(`src/lib/collection/queue.ts`)。指定時は`where`に`sourceType`を加える。既存の`status="queued"`/`orderBy fetchedAt desc`/`take`は不変。未指定時は従来どおり全ソース。
- F-E48-2: `GenerationRunOptions`に`maxPerCategory?: number`を追加(`src/lib/generation/pipeline.ts`)。指定時は`SOURCE_TYPES`(単一source of truth、`@/lib/collection/types`)の各ソース種別ごとに`listCandidateQueue({take:maxPerCategory, sourceType})`を並行取得し`.flat()`で連結。未指定時は従来どおり`maxCandidates`（総数上限、単一クエリ）で動作(後方互換)。ループ本体・重複判定プール・チャンピオンMap・held/failure状態同期は無変更。
- F-E48-3: `getPipelineConfig()`に`maxPublishPerCategory: envInt("PIPELINE_MAX_PUBLISH_PER_CATEGORY", 2)`を追加(`src/lib/pipeline/config.ts`)。`run-pipeline.ts`の`PipelineRunOptions`に`maxPerCategory?: number`を追加し、`options.maxPublishPerRun`が明示指定された場合のみ従来どおり`{maxCandidates: maxPublishPerRun}`(総数上限・後方互換)を渡し、未指定時は`{maxPerCategory: options.maxPerCategory ?? pipelineConfig.maxPublishPerCategory}`を渡すよう変更。`.env.example`に`PIPELINE_MAX_PUBLISH_PER_CATEGORY`(既定2・コメントアウト)を追記。既存`PIPELINE_MAX_PUBLISH_PER_RUN`は残置(後方互換)。

## 技術選定（該当する場合のみ）
- 新規依存なし。既存の`SOURCE_TYPES`定数(`["reddit","5ch","riot"] as const`、`src/lib/collection/types.ts`)を単一source of truthとしてそのまま再利用(ブリーフの推奨どおり)。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green(885 tests, 77 files)。新規テスト2ファイル(`collection-queue.test.ts`・`generation-pipeline.test.ts`)＋既存2ファイル更新(`pipeline-config.test.ts`・`pipeline-run-pipeline.test.ts`)含む。
- [x] `npx tsc --noEmit`・`npm run build`・`npm run lint` いずれも通過(lintは既存の無関係な警告5件のみ、エラー0)。
- [x] 1回の実行でパッチ/メタ・5chの反応・海外の反応がそれぞれ最大2本まで(独立)に制御される: `generateArticlesForQueue({maxPerCategory:2})`結合テストで5ch×5・reddit×3・riot×1→5ch2件・reddit2件・riot1件(独立)を確認。envで本数変更可(`PIPELINE_MAX_PUBLISH_PER_CATEGORY`、config結合テストで既定値2・上書き3を確認)。新規依存なし。既存の生成/保留/重複判定の不変条件は変更していない(ループ本体を触っていないため既存の`pipeline-run-pipeline.test.ts`の held/重複/失敗継続系テストが無修正のまま全Green)。

## アプリの起動方法
- 本スプリントはバックエンドのみの変更(UIなし)のため、起動確認はビルド/テストで代替。
- 開発起動: `npm run dev` (http://localhost:3000)。今回のUI変更なし。
- 検証コマンド: `npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint`（いずれも上記の通り実行し確認済み）。
- パイプライン単体実行: `npx tsx scripts/pipeline.ts`（既存スクリプト、今回変更なし）。

## 既知の問題・懸念点
- run-pipeline.tsの後方互換設計: `options.maxPublishPerRun`が明示指定された場合のみ総数上限(`maxCandidates`)を使い、未指定時は`maxPerCategory`(カテゴリ別上限)を主制御にする、という優先順位で実装した。ブリーフの記述は「generateArticlesの引数を`{maxPerCategory: ...}`に変更する」だが、そのまま単純に置き換えると既存の`pipeline-run-pipeline.test.ts`内「1回の実行で公開する記事本数の上限を超えて一度に公開しない」テスト(`maxPublishPerRun: 1`を明示指定して総数上限を検証)が回帰してしまうため、後方互換を優先し上記の分岐にした。「既存の pipeline/generation/queue テストが回帰しない」というテスト要件を優先した判断。
- `maxPerCategory`と`maxCandidates`の同時指定はブリーフどおり「両方指定は想定しない(maxPerCategory優先)」としてコード実装済み。

## 追加したテスト
- `src/lib/__tests__/collection-queue.test.ts`(新規): `listCandidateQueue`の`sourceType`フィルタ4件(単一ソース抽出/take併用/status絞り込み/未指定時全ソース回帰なし)。
- `src/lib/__tests__/generation-pipeline.test.ts`(新規): `generateArticlesForQueue`の`maxPerCategory`3件(5ch5+reddit3+riot1→2/2/1独立処理/`maxCandidates`後方互換/両方未指定時の全件処理回帰なし)。
- `src/lib/__tests__/pipeline-config.test.ts`(更新): `maxPublishPerCategory`既定値2・env上書きの2件追加。
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`(更新): run-pipelineが`generateArticlesForQueue`へ渡すオプションのスパイ検証2件(未指定時maxPerCategory・maxPublishPerRun明示指定時maxCandidates)追加。

## 関連ドキュメント
- [[ext-e48-brief]]（本スプリントの仕様抜粋）
