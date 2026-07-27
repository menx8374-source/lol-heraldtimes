# リファクタリング S1 — DB基盤（Post / PostMetricsHistory / ArticleUpdateHistory ＋ Article SEO列）

大規模リファクタ（docs/refactor-proposal.md）の第1歩。**スキーマの並行追加のみ**で、現行の収集/生成/公開パイプラインの
挙動は一切変えない（破壊なし）。対象: Web（DB層）。

## 背景（なぜ）
話題性を「Score/コメントの時系列・増加率」で数値判定し、記事更新やSEOを扱うための**責務分離したDB基盤**を先に用意する。
既存 `CollectedItem`（スナップショット1行・旧経路）は**比較用にそのまま残す**。新テーブルは空で追加し、S2以降で埋める。

## 含まれる機能（スキーマ追加のみ）

### F-S1-1: `Post`（収集した生投稿・ソース非依存）
- フィールド:
  - `id String @id @default(cuid())`
  - `sourceType String`（"reddit" | "5ch" | "riot" | 将来 "x" 等）
  - `externalId String`（投稿の外部ID: reddit id / 5ch threadId / 記事キー等）
  - `title String`、`body String`、`url String`
  - `author String?`、`flair String?`、`media Json?`（画像/動画等のメディア情報）
  - `postedAt DateTime`（ソース側の投稿日時）
  - `firstSeenAt DateTime @default(now())`、`lastCheckedAt DateTime?`
  - `monitoring Boolean @default(true)`（メトリクス監視中フラグ・S4で使用）
  - `createdAt @default(now())`、`updatedAt @updatedAt`
- 制約/関連: `@@unique([sourceType, externalId])`、`@@index([sourceType])`、`@@index([monitoring])`
  - `metrics PostMetricsHistory[]`、`article Article?`（Article.postId 経由の1対1・任意）

### F-S1-2: `PostMetricsHistory`（時系列メトリクス）
- フィールド: `id`、`postId String`、`score Int`、`commentCount Int`、`capturedAt DateTime @default(now())`
- 関連: `post Post @relation(fields:[postId], references:[id], onDelete: Cascade)`
- インデックス: `@@index([postId, capturedAt])`

### F-S1-3: `ArticleUpdateHistory`（記事更新の記録・再AI多重防止）
- フィールド: `id`、`articleId String`、`reason String`（"score_surge" | "comment_surge" | "hot_rank" 等）、
  `detail String?`、`updatedAt DateTime @default(now())`
- 関連: `article Article @relation(fields:[articleId], references:[id], onDelete: Cascade)`
- インデックス: `@@index([articleId])`

### F-S1-4: `Article` にSEO列＋Post関連を追加（すべて nullable＝破壊なし）
- 追加フィールド:
  - `seoTitle String?`、`metaDescription String?`、`ogTitle String?`、`ogDescription String?`
  - `postId String? @unique`、`post Post? @relation(fields:[postId], references:[id], onDelete: SetNull)`
  - `articleUpdates ArticleUpdateHistory[]`
- 既存の列・関連（sources/tags/collectedItems/reactions/comments/views・status等）は一切変更しない。

### F-S1-5: マイグレーションとクライアント再生成
- `npx prisma migrate dev --name refactor-s1-db-foundation`（dev.db にマイグレーション作成＋適用）＋ `npx prisma generate`。
- **テストDB・CIでマイグレーションが適用される導線を確認/更新**（既存の vitest global-setup が test.db にスキーマを適用する仕組みに合わせる。既存テストが緑のままになること）。
- SQLiteで「新テーブル追加＋nullable列追加」は非破壊。既存データ・現行パイプラインに影響しないこと。

## 制約・非目標
- **スキーマ追加のみ**。収集(adapters)・生成(compose/pipeline)・moderation・画面には**一切結線しない**（S2以降）。
- `CollectedItem` は削除も改変もしない（旧経路＝比較用に残す）。
- 設定ファイル化（閾値/間隔）・メトリクス更新・ルール判定・SEO生成は**このスプリントでは実装しない**（S3〜S5）。
- 新規npm依存なし（Prismaのみ）。

## テスト（必須・専用テストDB・実ネット非依存）
1. `Post` を作成・取得できる（全フィールド・`media` JSON往復・`@@unique([sourceType, externalId])` の重複で失敗する）。
2. `PostMetricsHistory` を同一Postに複数追記でき、`postId, capturedAt` で時系列に取得できる。Post削除でCascade削除。
3. `ArticleUpdateHistory` を作成でき、Article削除でCascade削除。
4. `Article` に新SEO列（seoTitle等）と `postId` を設定して作成・取得できる。`postId` は @unique（重複で失敗）。
   Post 削除で Article.postId が SetNull される。
5. **回帰（最重要）**: 新列を一切指定しない従来どおりの Article 作成・既存の sitemap/生成/パイプライン系テストが緑のまま
   （nullable追加・新テーブルが既存挙動を壊さない）。

## 受け入れ基準
1. `npx prisma migrate dev`（またはCI相当のmigrate）でスキーマが適用され、`npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過（Prismaクライアント再生成後）。
3. Post/PostMetricsHistory/ArticleUpdateHistory と Article のSEO列/postId が追加され、既存の収集/生成/公開の挙動・
   既存テストは不変。新規依存なし。

## 評価基準（evaluator向け）
- マイグレーション適用済み・テスト全Green・build/tsc/lint通過。現行パイプライン（mock収集→生成→公開）が回帰しない
  （コンソールエラー0）。
- 新テーブル・新列・関連・Cascade/SetNullがテストで確認できる。
- 受け入れ基準1〜3を満たす。
