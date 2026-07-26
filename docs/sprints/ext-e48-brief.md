# 拡張E48 — 1回の実行の公開本数上限をカテゴリ別（ソース別）に2本ずつにする

運用フィードバック起点（ユーザー決定）。対象: Web（バックエンド）。

## 背景（なぜ）
現在の公開本数制御は `PIPELINE_MAX_PUBLISH_PER_RUN`（既定5）＝**全カテゴリ合計**の「1回の実行で処理する候補数」上限
1つだけ。ユーザー要望は「**パッチ/メタ・5chの反応・海外の反応をそれぞれ単独で最大2本ずつ**」。カテゴリは
ソースと1:1対応（`CATEGORY_BY_SOURCE`: riot→パッチ/メタ、5ch→5chの反応、reddit→海外の反応）なので、
**ソース別に1回2件まで処理（＝最大2本公開）**にする。

「最大」＝上限の意味。処理した候補が保留(held)・失敗になればそのカテゴリの公開は2本未満になり得るが、
**公開本数の上限は各カテゴリ2本**になる（処理数の上限＝公開数の上限。既存の maxCandidates の考え方と同じ）。

## 含まれる機能

### F-E48-1: 候補キューにソース種別フィルタを追加（queue.ts）
- `listCandidateQueue(options)` に `sourceType?: SourceType` を追加し、指定時は `where` に `sourceType` を加える
  （既存の `status="queued"`・`orderBy fetchedAt desc`・`take` はそのまま）。未指定時は従来どおり全ソース。

### F-E48-2: 生成をソース別上限で行う（generation/pipeline.ts）
- `GenerationRunOptions` に `maxPerCategory?: number` を追加する。
- `generateArticlesForQueue` で `maxPerCategory` が指定された場合:
  - **ソース種別ごとに** `listCandidateQueue({ take: maxPerCategory, sourceType })` で最大 `maxPerCategory` 件ずつ取得し、
    連結して処理対象にする（ソース種別の一覧は単一の source of truth を使う。無ければ定数
    `["riot","5ch","reddit"] as const` 等を用意。将来ソース追加時はここを更新）。
  - これにより各ソース（＝各カテゴリ）で処理される候補は最大 `maxPerCategory` 件＝**公開も最大 `maxPerCategory` 本**。
- `maxPerCategory` 未指定時は従来どおり `maxCandidates`（総数上限）で動く（後方互換・既存テストを壊さない）。
  両方指定は想定しない（`maxPerCategory` を優先）。
- 重複判定プール・チャンピオンMap取得・held/failure時の状態同期など、既存のループ本体・不変条件は一切変えない
  （取得する候補集合の決め方だけを変える）。同一実行内の重複判定（contentPool）は全ソース横断で従来どおり効く。

### F-E48-3: 設定と結線（pipeline/config.ts・run-pipeline.ts・.env.example）
- `getPipelineConfig()` に `maxPublishPerCategory: envInt("PIPELINE_MAX_PUBLISH_PER_CATEGORY", 2)` を追加する。
  既存の `maxPublishPerRun` は残してよい（後方互換）が、run-pipeline は per-category を主制御にする。
- `run-pipeline.ts` の `generateArticles(llmClient, { maxCandidates: maxPublishPerRun, championMap })` を、
  `{ maxPerCategory: pipelineConfig.maxPublishPerCategory, championMap }` を渡すよう変更する
  （`PipelineRunOptions` に `maxPerCategory` を通す口を追加）。
- `.env.example` に `PIPELINE_MAX_PUBLISH_PER_CATEGORY`（既定2・カテゴリ別の1回あたり公開上限）を追記。

## 制約・非目標
- 収集(5ch/reddit/riot)・生成本文・NG・強調色・サムネ・翻訳には触れない。新規依存なし。
- 「保留を避けて2本公開まで粘る」挙動にはしない（＝処理上限2件でよい。上限＝最大2本の意味）。
- スケジュール自体（cron常駐）は本スプリント対象外（別途）。ここは1回の実行あたりのカテゴリ別上限のみ。

## テスト（必須・DB結合テストは専用テストDB・実ネット非依存）
1. `listCandidateQueue({ sourceType })`: 指定ソースの queued のみ返す。`take` と併用で件数も絞れる。未指定は全ソース（回帰なし）。
2. `generateArticlesForQueue({ maxPerCategory: 2 })`: 例）queued が 5ch×5・reddit×3・riot×1 のとき、処理されるのは
   5ch 2件・reddit 2件・riot 1件（各ソース最大2件）。他ソースの多寡が別ソースの取得を圧迫しない（独立2本ずつ）。
3. `maxPerCategory` 未指定＋`maxCandidates` 指定は従来どおり総数上限で動く（後方互換）。
4. `getPipelineConfig()` が `maxPublishPerCategory`（既定2・env上書き可）を返す。`run-pipeline` が per-category を
   generateArticles に渡す（スタブ/スパイで確認）。
5. 既存の pipeline/generation/queue テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 1回の実行で パッチ/メタ・5chの反応・海外の反応 がそれぞれ最大2本まで（独立）に制御される。env で本数変更可。
   新規依存なし・既存の生成/保留/重複判定の不変条件は不変。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。パイプラインが回帰しない（コンソールエラー0）。
- ソース別上限2本が結合テストで確認できる（あるソースが多くても各カテゴリ独立に最大2本）。
- 受け入れ基準1〜3を満たす。
