---
tags: [sprint-selfeval]
sprint: growth-g8
---

# 成長G8 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/reddit.ts` のみ変更（DBスキーマ・他ファイル・他ソース不変）。
- **F-G8-1（取得窓の前寄せ＋設定化）**: `computeFetchWindow(now, minAgeHours, maxAgeHours)` を日粒度→時間粒度に変更。既定を `min12h/max72h`（旧`min2日/max4日`）に前寄せ。env `REDDIT_MIN_AGE_HOURS`/`REDDIT_MAX_AGE_HOURS`で上書き可能（純関数のシグネチャ・境界テストは維持、値のみ時間粒度に変更）。
- **F-G8-2（監視のための足切り分離）**: 新関数 `selectPostsForCollection` を追加。投稿を経過時間で「新しい投稿（`monitorMaxAgeHours`＝既定24h以内）」と「古い投稿」に分け、
  - 古い投稿: 既存 `selectRelevantPosts`（score下限＋降順＋`maxThreads`）をそのまま再利用（不変・純関数の境界テストも維持）。
  - 新しい投稿: score足切りをせず、`num_comments >= monitorMinComments`（既定1）のみでノイズ抑制し、`maxMonitorCandidates`（既定5、env `REDDIT_MAX_MONITOR_CANDIDATES`）で頭打ち（監視対象の暴走防止＝監視上限）。
  - `fetchSubredditItems` は旧 `selectRelevantPosts` 単独呼び出しから `selectPostsForCollection` 呼び出しに変更。それ以外（コメント取得・整形・`buildRedditItem`・永続化経路）は無変更。
  - `persist-posts.ts`・`pipeline.ts`・`hotness/*`・記事生成ロジックは一切変更していない（収集が監視対象Postを増やすだけで、記事化ゲートは既存のまま既存 `Post.monitoring=true` 経路に乗る）。
- **F-G8-3（議論コメント取得、軽量）**: `RedditCommentData.num_replies?: number` を追加（Arctic Shiftが返す場合のみ想定）。`selectTopComments(comments, limit, { discussionSlots })` に第3引数を追加し、コメントのいずれかが`num_replies`を持つ場合のみ、score上位に加えて返信数上位の議論コメントを`discussionSlots`件（既定2、env `REDDIT_DISCUSSION_COMMENT_SLOTS`）確保する。誰も`num_replies`を持たない、または`discussionSlots`が0（未指定既定値）の場合は完全に現状(score降順のみ)のまま（回帰なし）。逐語は不変（選定のみ）。
- `.env.example` のreddit節を新旧env名に合わせて更新（`REDDIT_MIN_AGE_DAYS`/`MAX_AGE_DAYS`→`_HOURS`、新規4つのenvを追記）。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の純関数パターン（envIntLocal・pure selection function・pure test）を踏襲。
- 「監視上限」は収集時（`REDDIT_MAX_MONITOR_CANDIDATES`）に設けた。既存の `METRICS_MAX_POSTS_PER_RUN`（`metrics-schedule.ts`、per-run fetchMetrics件数上限）と合わせて二重に暴走を防ぐ設計（brief「既存の監視上限（あれば）の範囲に収める」に対応。既存の`maxPostsPerRun`はper-run処理数の上限であり、収集で新規に監視対象へ加わる件数自体の上限は無かったため、収集側に新設した）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（105ファイル/1327テスト、うち成長G8関連の`collection-reddit.test.ts`は47テストで全Green）。
- [x] `npx tsc --noEmit` エラー0。
- [x] `npm run build` 成功（Next.js standaloneビルド完走）。
- [x] `npm run lint` エラー0（既存の無関係な警告6件のみ、成長G8変更由来ではない）。
- [x] 取得窓が前寄せされ（既定`min12h/max72h`）、新しい投稿が監視対象（Post経由）として早期に取り込まれる: `selectPostsForCollection`のテストで、監視ウィンドウ内(2時間前)のscore=1投稿がscore足切りされず選抜されることを確認。アダプタ統合テスト(`fetchItems`)でも同様にscore=1の新規投稿が結果に含まれることを確認。
- [x] 記事化は既存Hotness（増加率・論争度含む）で判定される: `src/lib/hotness/config.ts`・`src/lib/hotness/evaluator.ts`・`persist-posts.ts`・`pipeline.ts`は本スプリントで一切変更していない（`git status`で無変更を確認済み）。既存のhotness関連テスト（`hotness-evaluator.test.ts`・`hotness-config.test.ts`・`hotness-update-trigger.test.ts`）も無変更のまま全Green。
- [x] ノイズ抑制: 新しい投稿にも`num_comments>=1`（既定、env調整可）の最低フィルタ＋既存のLoL関連キーワード一致・stickied/over_18除外を適用（テストで確認）。監視対象は`maxMonitorCandidates`で頭打ち（テストで確認）。
- [x] AI不使用・DBスキーマ変更なし・新規npm依存なし・他ソース（5ch/riot/riot-news/x）不変（`git status`上、変更ファイルは`reddit.ts`・そのテスト・`.env.example`のみ）・記事化の質ゲート(Hotness閾値)不変（`hotness/config.ts`無変更）。

## アプリの起動方法
- テスト: `npx vitest run`（DBはテスト専用SQLite、実ネット非依存・fetchはモック）。
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- 収集パイプライン単独実行（本接続確認用、任意）: `npm run collect`（`COLLECTION_MODE=live`時のみArctic Shiftへ実際に接続。本スプリントの自己確認では行っていない＝fetchモックのテストのみで検証）。
- サーバー起動確認: 本スプリントはロジック変更のみ（UIなし）のため、`next dev`/`next start`は自己確認のために起動していない（起動不要）。

## 既知の問題・懸念点
- Arctic Shiftの`num_replies`（コメント返信数）フィールドが実際に存在するかは未確認（実APIを叩いていないため）。brief記載どおり「無ければ現状維持で回帰させない」設計にしており、`discussionSlots`はデフォルト0（未指定）扱いのためオプトインが必要。本番でこのフィールドが実際に返らない場合、F-G8-3の議論コメント機能は事実上無効（現状維持）のままになる。実データでの検証は本スプリントのスコープ外（実APIを叩かない制約のため）。
- 監視対象総数（`Post.monitoring=true`の累計行数）そのものの上限は設けておらず、収集1回あたりの新規追加数（`maxMonitorCandidates`）とメトリクス更新の`METRICS_MAX_MONITOR_HOURS`（既定48h、既存)による自然退場、および`METRICS_MAX_POSTS_PER_RUN`（既定50、既存）の組み合わせで暴走を抑える設計。極端に収集頻度が高い運用では監視対象が積み上がる可能性があるため、運用時は`REDDIT_MAX_MONITOR_CANDIDATES`と収集間隔(`COLLECTION_REDDIT_MIN_INTERVAL_MS`)のバランスに留意が必要（既存の設定項目で調整可能、コード変更は不要）。
- 本スプリントは実Arctic Shift APIを一切叩いていない（brief制約どおりfetchはモック）。実データでの速報性改善効果（伸びた投稿がどれだけ早く記事化されるか）は本番運用でのモニタリングでのみ確認可能。

## 追加したテスト
- `computeFetchWindow`: 時間粒度化後の境界計算（12h/72h）。
- `selectPostsForCollection`（新規、7ケース）: 新しい投稿のscore足切りバイパス、古い投稿の従来score足切り、num_comments下限による無反応投稿除外、`maxMonitorCandidates`による頭打ち、新旧混在時の結合、stickied/over_18/キーワード不一致の除外不変。
- `selectTopComments`の議論コメント枠（新規、3ケース）: `num_replies`ありでの議論コメント確保、`num_replies`無しでの現状維持、`discussionSlots`未指定時の現状維持。
- `RedditAdapter.fetchItems`統合テスト（新規1ケース）: 監視ウィンドウ内のscore=1投稿がfetchItems結果に含まれること（収集段階でのバイパスがアダプタ全体を通しても機能することを確認）。
- 既存の`selectRelevantPosts`（境界: sticky/nsfw/キーワード/score下限/降順/limit）テストは無変更のまま全Green（純関数の境界テスト維持）。

## 関連ドキュメント
- [[growth-g8-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
