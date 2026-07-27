# リファクタリング S4 — メトリクス定期更新＋監視ライフサイクル（バックオフ・スケジューラ）

大規模リファクタ（docs/refactor-proposal.md）の第4歩。監視中の `Post` の Score/コメント数を経過時間に応じた間隔で
再取得し `PostMetricsHistory` に追記する。これで S3 の HotnessEvaluator が実データの増加率で判定できるようになる（結線はS5）。
対象: Web（収集/バッチ層）。

## 背景（なぜ）
要件「投稿ごとに 初回/10分後/20分後/30分後/1h/2h… と数値を更新し履歴化」。監視は無限に続けず、経過時間で間隔を広げ、
一定時間で終了する（API/コスト最小）。**バックオフ方式**（cronのゆらぎに強い）を採用する。

## 含まれる機能

### F-S4-1: `SourceAdapter` に任意メソッド `fetchMetrics` を追加
- インターフェースに `fetchMetrics?(externalId: string): Promise<{ score: number; commentCount: number } | null>` を追加（任意）。
  失敗・非対応は null（例外を投げない）。
- 実装:
  - **Reddit(Arctic Shift)**: 投稿ID指定で現在値取得。**確認済み: `GET https://arctic-shift.photon-reddit.com/api/posts/ids?ids=<externalId>`**
    → `{ data: [ { score, num_comments } ] }`（200で現在値が返る。実検証済み）。取得失敗/空は null。
  - **5ch**: 対象板の `subject.txt` を取得し threadId 行の**レス数**を返す（`score:0, commentCount:resCount`）。板は externalId
    `"server/board/threadId"` から復元。subject.txt はキャッシュ的に1板1回で足りるよう配慮（同板の複数threadを1取得で賄えると良いが、
    まずは正しく取れれば可）。
  - **Riot**: `fetchMetrics` 未実装（メトリクス監視対象外）。
- 既存 `fetchItems` は不変。

### F-S4-2: メトリクス更新スケジュール設定（バックオフ・env上書き可）
- `src/lib/hotness/config.ts`（または新規 `metrics-schedule.ts`）に更新スケジュールを追加:
  - `earlyIntervalMinutes`（既定10）・`earlyPhaseHours`（既定1）
  - `midIntervalMinutes`（既定30）・`midPhaseHours`（既定6）
  - `lateIntervalMinutes`（既定120）・`latePhaseHours`（既定24）
  - `tailIntervalMinutes`（既定360）
  - `maxMonitorHours`（既定48）＝これを超えたら監視終了
  - `maxPostsPerRun`（既定50）＝1回のupdater実行で更新する最大Post数（API有界化）
- **due判定（純関数）** `metricsCaptureIntervalMinutes(ageHours, config)`:
  ageが early/mid/late/tail のどの帯かで間隔を返す。`isMetricsDue(post, now, config)` = `(now - lastCheckedAt) >= interval`。
- 秘密でないため `.env.example` にキー名/既定値を記載。

### F-S4-3: MetricsUpdaterService（`src/lib/collection/metrics-updater.ts`）
- `updateDueMetrics({ now, adapters?, ... }): Promise<{ checked: number; updated: number; retired: number }>`:
  1. `monitoring=true` の Post を取得（`maxPostsPerRun` で有界化・古い順 or lastChecked古い順）。
  2. 各Postについて:
     - `ageHours = (now - postedAt)`。`ageHours > maxMonitorHours` → `monitoring=false` に更新して監視終了（retired++）。
     - でなく `isMetricsDue` なら、sourceType のアダプタ `fetchMetrics(externalId)` を呼び、取れたら
       `PostMetricsHistory` に1行追記＋`Post.lastCheckedAt = now`（updated++）。取得 null は lastCheckedAt のみ更新（次回に回す）でよい。
  3. **作法**: リクエスト間ディレイ（`REDDIT_REQUEST_DELAY_MS`/`FIVECH_REQUEST_DELAY_MS` を流用 or 専用）・直列・sleep注入可。
     1件失敗は握り潰しログ継続・全体も例外を投げない（本体を止めない）。
- アダプタは `getAllAdapters()` から sourceType→adapter を引く（テストは注入）。

### F-S4-4: 実行の入口
- `scripts/update-metrics.ts`（cronから叩く用・`updateDueMetrics(new Date())` を実行しサマリをログ）。`package.json` に `update-metrics` を追加。
- cron常駐の登録自体は環境側（別途手順で案内）。ここでは「1回実行で due な Post だけ更新する」関数＋スクリプトを用意。
- 収集・生成・公開の既存挙動は不変（メトリクス更新は独立ジョブ）。**HotnessEvaluator への結線はS5**（本スプリントは履歴を増やすところまで）。

## 制約・非目標
- メトリクス更新のみ。記事化・公開・moderation・画面・DBスキーマ変更には触れない。新規npm依存なし。
- cron常駐の設定は本スプリント対象外（スクリプト＋関数まで）。HotnessEvaluatorの結線はS5。
- 監視対象は S2 で `monitoring=true` を付けた Post。Riot は fetchMetrics 非対応で自然に更新されない（問題なし）。

## テスト（必須・実API/実ネット非依存＝fixture/注入・sleep/now注入）
1. `metricsCaptureIntervalMinutes`/`isMetricsDue`（純関数）: age 帯ごとに正しい間隔・due判定（境界含む）。
2. `fetchMetrics`: Reddit(fixture/注入)で score/num_comments を返す。5ch(subject.txt fixture)で resСount を commentCount に。失敗→null。
3. `updateDueMetrics`: monitoring=true の Post のうち due のものだけ `PostMetricsHistory` に追記＋lastCheckedAt更新。
   age>maxMonitorHours の Post は monitoring=false（retired）。maxPostsPerRun で件数上限。1件失敗でも他継続・例外を投げない。
   sleep注入で連続fetch間にディレイ・delayMs0で実待機なし。
4. 既存の収集/生成/パイプライン/DBテストが回帰しない（メトリクス更新は独立・既存挙動不変）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. `updateDueMetrics` 実行で監視中Postの数値がバックオフ間隔で `PostMetricsHistory` に追記され、48h超で監視終了する。
   閾値/スケジュールは設定で変更可。既存挙動・既存テストは不変。新規依存なし・グレースフル失敗・作法（ディレイ/直列/有界）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- due判定のバックオフ・fetchMetrics・updateの追記/監視終了/有界化/グレースフルがテストで確認できる。
- 受け入れ基準1〜3を満たす。
