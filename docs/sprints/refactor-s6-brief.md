# リファクタリング S6 — 記事更新（伸びたら条件付き再AI・数値ルール・多重防止）

大規模リファクタ（docs/refactor-proposal.md）のS6。公開後もPostを監視し、**Scoreが大きく伸びた／コメントが急増した**
ときだけ記事を再AI更新する。通常は再実行しない。判定は数値ルール（AI不使用）、更新の多重実行は `ArticleUpdateHistory`
（S1）で防ぐ。対象: Web（生成・バッチ）。

## 背景（なぜ）
要件「公開後も一定時間監視。Scoreが大きく伸びた/コメント急増/Hot上位のときのみ記事更新（再AI）。通常は再実行しない」。
S4のメトリクス更新で `PostMetricsHistory` が伸びるので、その差分（数値）で「更新すべきか」を判定し、必要時のみ再生成する。

## 含まれる機能

### F-S6-1: 更新トリガの設定＋判定（純関数・数値ルール・AI不使用）
- `src/lib/hotness/config.ts` に更新トリガ設定を追加（env上書き可・ソース差吸収）:
  - `updateMinScoreDelta`（前回時点からのScore増加量の下限。既定100。reddit主体）
  - `updateMinCommentDelta`（コメント増加量の下限。既定30。5ch/reddit共通）
  - `updateCooldownHours`（前回更新からの最短間隔。既定6）
  - `updateMaxCount`（1記事あたりの最大更新回数。既定2）
  - `updateMaxAgeHours`（この経過時間を超えた投稿は更新対象外。既定 `maxMonitorHours` と整合＝48）
- 純関数 `shouldUpdateArticle(input, now, config): { shouldUpdate: boolean; reason: string | null }`:
  - `input`: `{ sourceType, postedAt, metricsHistory[], baselineScore, baselineComments, lastUpdatedAt, updateCount }`。
  - baseline＝記事化時点（または直近更新時点）のscore/comment。current＝最新メトリクス。
  - 条件（すべて満たす）: `updateCount < updateMaxCount` かつ `now - lastUpdatedAt >= updateCooldownHours` かつ
    投稿経過が `updateMaxAgeHours` 以内、かつ **「Score増加量 >= updateMinScoreDelta」または「コメント増加量 >= updateMinCommentDelta」**。
    5ch は score 常時0なのでコメント増加量のみで判定（config で吸収）。

### F-S6-2: 現在内容の再取得（SourceAdapter に任意メソッド）
- `SourceAdapter` に `fetchContent?(externalId): Promise<{ title: string; content: string; imageUrl?: string | null } | null>` を追加（任意）。
  - **Reddit**: 投稿idで上位コメントを再取得し、OP＋上位コメントのスレッドダンプを**現在の内容で作り直す**（既存の
    コメント取得・ダンプ構築ロジックを再利用）。
  - **5ch**: externalId(server/board/threadId)から dat を再取得しスレッドダンプを作り直す。
  - riot: 未対応（riotは免除ソース＝更新対象外）。失敗は null（例外を投げない）。

### F-S6-3: ArticleUpdaterサービス（`src/lib/generation/article-updater.ts`）
- `updateHotArticles({ now, llmClient?, adapters?, maxPostsPerRun?, sleep?, delayMs? }): Promise<{ checked, updated, skipped }>`:
  1. **対象**: `article` が紐付き（記事化済み）かつ `monitoring=true` の Post（免除ソース＝riotは除外）。`maxPostsPerRun`（既定20）で有界。
  2. 各Postについて、`PostMetricsHistory`＋`ArticleUpdateHistory` から baseline（記事化 or 直近更新時点のscore/comment）・
     `updateCount`・`lastUpdatedAt`（無ければ `Article.createdAt`）を求め、`shouldUpdateArticle` を判定。
  3. トリガしたら:
     - `adapter.fetchContent(externalId)` で現在の本文を再取得（取れなければskip）。
     - `generateArticleForCandidate`（既存・本文/タイトル/翻訳/SEO）で再生成 → `moderateArticleContent` 通過を確認。
     - 既存 **Article を in-place 更新**（body/title/thumbnailUrl/SEO列/tags を更新。**slug・id・postId・publishedAt は不変**）。
       moderation不通過なら更新しない（既存の公開内容を壊さない）。
     - `ArticleUpdateHistory` に1行追記（`reason`＝"score_surge"/"comment_surge"、`updatedAt`＝now）。
  4. **作法**: リクエスト間ディレイ（sleep注入可）・直列・1件失敗は握り潰しログ継続・全体も例外を投げない。
- 入口: `scripts/update-articles.ts`（cronから叩く用）＋ `package.json` に `update-articles` 追加。cron常駐は環境側（手順で案内）。

## 制約・非目標
- 更新は「伸びたときだけ」。通常は再実行しない（cooldown・delta閾値・maxCountで抑制）。判定はAI不使用（数値ルール）。
- 収集・hotness初回記事化（S5）・moderation・表示・DBスキーマ変更には触れない（S1のArticleUpdateHistory/SEO列を使う）。新規依存なし。
- riot（免除ソース）は更新対象外（パッチは"伸び"で測るものでない）。旧CollectedItem経路は不変。

## テスト（必須・専用テストDB＋スタブLLM／fetch・sleep・now注入・実ネット非依存）
1. `shouldUpdateArticle`（純関数）: Score増加量/コメント増加量がdelta超で更新、cooldown内・updateCount上限・maxAge超は更新しない。
   5chはコメント増加量のみで判定。各分岐とreason。
2. `getHotnessConfig`系: 更新トリガ設定の既定＋env上書き。
3. `fetchContent`: reddit(fixture/注入)で現在コメントからダンプ再構築、5ch(subject/dat fixture)でダンプ再構築。失敗→null。
4. `updateHotArticles`: トリガしたarticled Postのみ、fetchContent→再生成→Article in-place更新（slug/id/postId不変）＋ArticleUpdateHistory追記。
   非トリガ・riot・cooldown中はskip。moderation不通過は更新しない。maxPostsPerRun有界・sleep注入・1件失敗継続・例外なし。
5. 既存の生成/パイプライン/DBテストが回帰しない（S5の初回記事化・表示は不変）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. Scoreが大きく伸びた/コメント急増したPostの記事だけが、cooldown・回数上限を守って再AI更新され、ArticleUpdateHistoryに記録される。
   通常は再実行しない。slug/id不変・moderation維持・新規依存なし・グレースフル。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- 更新トリガ（delta/cooldown/maxCount/maxAge）・fetchContent・in-place更新＋履歴記録・riot除外がテストで確認できる。
- 受け入れ基準1〜3を満たす。
