# リファクタリング S2 — 収集の履歴化（Post＋PostMetricsHistory を並行保存）

大規模リファクタ（docs/refactor-proposal.md）の第2歩。各アダプタが取得した投稿を `Post` に保存し、取得のたびに
`PostMetricsHistory`（Score・コメント数）を追記する。**現行の `CollectedItem`→記事化パイプラインはそのまま並行稼働**
（旧経路＝比較用に残す）。対象: Web（収集層）。

## 背景（なぜ）
S3で「Score/コメントの増加率による話題性判定（数値ルール・AI不使用）」を実装するには、時系列メトリクスが必要。
S2で `Post`／`PostMetricsHistory` にデータが溜まり始める状態を作る（まだ判定・記事化には使わない＝挙動は不変）。

## 含まれる機能

### F-S2-1: アダプタ取得結果に構造化メタを追加（RawCollectionItem 拡張・後方互換）
- `src/lib/collection/types.ts` の `RawCollectionItem` に**任意フィールド**を追加（未設定でも既存動作を壊さない）:
  - `externalId?: string`（Post の一意キー用。ソース内で安定・一意）
  - `score?: number`、`commentCount?: number`（メトリクス）
  - `author?: string | null`、`flair?: string | null`
  - `media?: unknown`（画像/動画等のメディア情報。JSONとして保存）
- 各アダプタで設定:
  - **Reddit(Arctic Shift, reddit.ts)**: `externalId`=投稿id、`score`=score、`commentCount`=num_comments、
    `author`、`flair`=link_flair_text、`media`={ imageUrl, url }（あるもの）。
  - **5ch(fivech.ts)**: `externalId`=`"<server>/<board>/<threadId>"`、`commentCount`=レス数(resCount)、
    `score`=0（5chはupvote概念なし。勢いはコメント数の時系列で見る）、author/flair/media は null/未設定。
  - **Riot(riot-datadragon.ts)**: `externalId`=パッチ識別子（例 publicPatchNumber）。score/commentCount は未設定（0扱い）。
    ※Riotはhotness対象外だが、後で記事とPostを紐付けられるようPostは作る。
  - **mock**: 既存fixtureは externalId 等未設定のままでよい（Post未作成＝回帰なし）。

### F-S2-2: Post 永続化サービス（CollectorService）
- 新規 `src/lib/collection/persist-posts.ts`（純粋にPrismaを使う関数群・テスト可能に）:
  - `persistPosts(items: RawCollectionItem[], sourceType: SourceType, now: Date): Promise<{ postCount: number; metricsCount: number }>`
  - `externalId` を持つ item のみ対象。`Post` を **`@@unique([sourceType, externalId])`** で upsert:
    - create: sourceType/externalId/title/body(=item.content)/url(=item.sourceUrl)/author/flair/media/postedAt(=fetchedAt)/
      firstSeenAt(=now)/lastCheckedAt(=now)/monitoring(true)。
    - update: title/body/url/author/flair/media/lastCheckedAt(=now)（firstSeenAt/postedAt は保持）。
  - 続けて `PostMetricsHistory` を1行追記: `{ postId, score: item.score ?? 0, commentCount: item.commentCount ?? 0, capturedAt: now }`。
  - **信頼境界**: 1 item の保存失敗は握り潰してログし、他 item を継続（本体＝収集を止めない）。全体失敗も例外を投げない。
  - `Post.body` は現状 item.content（ダンプ）を格納しておく（S5でPostを記事化ソースにする際に見直す想定。今回はデータ蓄積が目的）。

### F-S2-3: 収集実行に並行差し込み（既存 CollectedItem 経路は不変）
- `src/lib/collection/pipeline.ts`（`runCollectionPipeline`）で、各ソースの `fetchItems()` 結果を **CollectedItem に保存する
  既存処理はそのまま**にし、その後（または並行で）`persistPosts(items, sourceType, now)` を呼ぶ。
  - Post保存の失敗・例外は収集結果（SourceRunSummary）に影響させない（補助処理は本体を止めない）。
  - `now` は既存の実行時刻を渡す（テスト注入と整合）。
- `scripts/collect.ts`/`pipeline.ts` は `runCollectionPipeline` 経由なので追加改修は基本不要（必要なら最小限）。

## 制約・非目標
- **Post/メトリクスはまだ判定・記事化に使わない**（S3で数値ルール判定、S4でメトリクス定期更新、S5で記事化のPost移行）。
  よって公開サイト・生成物・既存パイプラインの挙動は**不変**。
- `CollectedItem` は削除も改変もしない（旧経路＝比較用）。moderation・生成・画面には触れない。新規npm依存なし。
- メトリクスの「再取得（定期ポーリング）」はS4。S2では収集実行のたびに（同一投稿が再取得されれば）履歴が1行増える起点のみ。

## テスト（必須・専用テストDB／fixture・実ネット非依存）
1. アダプタ: Reddit fixtureから externalId/score/commentCount/author/flair/media が RawCollectionItem に載る。5ch fixtureから
   externalId(server/board/threadId)/commentCount(resCount)/score=0 が載る。既存の sourceUrl/title/content/imageUrl は不変。
2. `persistPosts`: externalId ありの items で Post が upsert され、PostMetricsHistory が1行ずつ追記される。**同一 externalId を
   2回 persist すると Post は1行のまま（updateされ lastCheckedAt 更新）で、PostMetricsHistory は2行**（時系列）。externalId 無しは無視。
3. `persistPosts`: 1件の保存が失敗（不正データ等）しても他は保存され、例外を投げない（グレースフル）。
4. `runCollectionPipeline`: 既存の CollectedItem 保存・SourceRunSummary が回帰しない。加えて externalId を持つソースで Post が作られる。
   Post保存を失敗させても収集結果は success のまま（本体を止めない）。
5. 既存の collection/pipeline/生成/sitemap テストが緑のまま（挙動不変）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 収集実行で Reddit/5ch の投稿が `Post` に保存され、取得のたびに `PostMetricsHistory` に時系列が追記される。
   現行の収集/生成/公開の挙動・既存テストは不変。新規依存なし・Post保存失敗は本体を止めない。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock収集→生成→公開が回帰しない（コンソールエラー0）。
- Post upsert（同一externalIdで1行）＋メトリクス時系列追記（複数行）がテストで確認できる。
- 受け入れ基準1〜3を満たす。
