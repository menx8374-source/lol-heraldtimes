---
tags: [sprint-selfeval]
sprint: refactor-s1
---

# リファクタリング S1（DB基盤）自己評価レポート

## 実装した内容
- `prisma/schema.prisma` に新モデルを追加:
  - `Post`（sourceType/externalId/title/body/url/author?/flair?/media Json?/postedAt/firstSeenAt/lastCheckedAt?/monitoring/createdAt/updatedAt。`@@unique([sourceType, externalId])`・`@@index([sourceType])`・`@@index([monitoring])`・`metrics`/`article` relation）
  - `PostMetricsHistory`（postId/score/commentCount/capturedAt、`post` relation onDelete Cascade、`@@index([postId, capturedAt])`）
  - `ArticleUpdateHistory`（articleId/reason/detail/updatedAt、`article` relation onDelete Cascade、`@@index([articleId])`）
- `Article` に nullable 列を追加: `seoTitle?`/`metaDescription?`/`ogTitle?`/`ogDescription?`/`postId? @unique`/`post? @relation(onDelete SetNull)`/`articleUpdates ArticleUpdateHistory[]`。既存列・既存関連（sources/tags/collectedItems/reactions/comments/views・status等）は不変。
- マイグレーション作成・適用: `npx prisma migrate dev --name refactor-s1-db-foundation`（生成物: `prisma/migrations/20260727124253_refactor_s1_db_foundation/migration.sql`）＋ `npx prisma generate`。
  - Article テーブルはSQLiteの制約上「テーブル再作成＋INSERT SELECTで既存データ移行」の形になっているが、既存の全列を保持しており非破壊（データロス無し）。新テーブル2つ・列追加は素直なCREATE TABLE/ALTER。
- テストDB導線は変更不要と確認: `vitest.global-setup.ts` は毎回 `prisma db push --skip-generate --accept-data-loss` でスキーマをtest.dbに丸ごと適用する方式のため、新スキーマも自動的に反映される。
- 新規テスト `src/lib/__tests__/db-foundation.test.ts` を追加（下記「追加したテスト」参照）。
- 収集(adapters)・生成(compose/pipeline)・moderation・画面には一切結線していない（意図通りスキーマ追加のみ）。`CollectedItem` は無改変。新規npm依存なし。

## 技術選定
- 該当なし（既存のarchitecture.md記載どおりPrisma+SQLiteのまま。新規ライブラリ追加なし）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx prisma migrate dev` でスキーマ適用済み（マイグレーション名 `20260727124253_refactor_s1_db_foundation`）。`npx vitest run` は 78ファイル/900テスト全Green。
- [x] 基準2: `npx tsc --noEmit` 出力なし（エラー0）。`npm run build`（Next.js standalone向けturbopackビルド）成功。`npm run lint` はエラー0（既存由来の警告5件のみ、本スプリントの変更に起因するものではない）。
- [x] 基準3: Post/PostMetricsHistory/ArticleUpdateHistoryテーブルとArticleのSEO列/postIdが追加され、既存の収集/生成/公開の挙動・既存テスト(900件)は不変。新規依存追加なし（package.json変更なし）。

## アプリの起動方法
- テスト: `cd "c:\ClaudeProjects\lolまとめサイト自動運営" && npx vitest run`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- （本スプリントはDB層のみのためUI起動確認は対象外。開発サーバー起動は従来どおり `npm run dev`、本番同等は `npm run build && npm run start`）
- 本スプリント中にサーバーは起動していない（CLIコマンドのみ実行、いずれも完了して終了済み）。

## 既知の問題・懸念点
- `prisma migrate dev` 実行時にPrisma 6→7のメジャーアップデート通知が出るが、本スプリントの対象外（architectureのバージョン方針に従い据え置き）。
- Article テーブルはSQLiteの制約上マイグレーション内で再作成される（列追加にFK付き列を含むため）。移行SQLは既存全列をSELECTしてINSERTしており、データ欠落は生じない設計だが、本番dev.db規模でのマイグレーション所要時間の検証はローカル小規模データでのみ確認（大量データでの検証は未実施）。
- 新テーブル・新列はまだどこからも参照されない「死んだスキーマ」状態（意図通り。S2以降で結線）。

## 追加したテスト
- `src/lib/__tests__/db-foundation.test.ts`（新規）
  - Post: 全フィールド作成・取得、media JSON往復、`@@unique([sourceType, externalId])` 重複失敗、sourceType違いなら作成可
  - PostMetricsHistory: 同一Postへの複数追記＋capturedAt昇順取得、Post削除でCascade削除
  - ArticleUpdateHistory: 作成・articleIdで取得、Article削除でCascade削除
  - Article新SEO列（seoTitle/metaDescription/ogTitle/ogDescription）+postId設定・取得、postId @unique重複失敗、Post削除でpostIdがSetNull
  - 回帰: 新列を一切指定しない従来どおりのArticle作成で新列が全てnullになること
- 既存テスト900件（78ファイル）は全てGreenのまま（回帰確認済み）。

## 前回フィードバックへの対応
- 該当なし（本スプリントの初回実装）。

## 関連ドキュメント
- [[refactor-s1-brief]]（本スプリントの仕様抜粋）
- [[refactor-proposal]]（全体設計）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
