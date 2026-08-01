---
tags: [sprint-selfeval]
sprint: admincms-S1
---

# admincms-S1 自己評価レポート

## 実装した内容
- **F1 カテゴリ別公開ポリシー**: 新規 `CategoryPublishPolicy`（`category @unique, autoPublish, updatedAt`）モデルを追加。`src/lib/admin/category-policy.ts` に純関数 `resolveAutoPublish`（未保存/未知カテゴリは既定 false=要レビュー）と DB 読み書き関数（`getCategoryPoliciesForDisplay`/`loadCategoryPolicyRows`/`setCategoryAutoPublish`、未認証は拒否）を実装。
- **F2 要レビュー状態とレビューキュー**: `Article.status` に `"review"` を追加（enumはString運用、既存4状態は不変）。`src/lib/admin/articles-admin.ts` に `listReviewQueue`/`countReviewQueue`/`approveReviewArticle`/`rejectReviewArticle` を追加。承認/却下は `status="review"` の記事のみ許可し、それ以外からの呼び出しは例外を投げて拒否（不正遷移防止）。承認は `revalidatePublishedListings`（機能B）も呼ぶ。
- **F3 パイプラインのポリシー尊重**: 純関数 `decidePublishState({moderationHeld, autoPublish}) => "held"|"published"|"review"`（`src/lib/generation/publish-decision.ts`、held優先）を新設し、`generation/pipeline.ts`（旧経路）・`generation/post-pipeline.ts`（既定の新経路）の両方に結線。カテゴリポリシーはrun開始時に1回だけ取得（championMapと同じ方針）。`PipelineRunLog`/`PipelineRunReport`/ダッシュボードの実行結果表に `reviewCount` 列を追加。
- **F4 管理画面プレビュー**: `src/app/admin/articles/[id]/preview/page.tsx` を新設。`getArticleByIdForAdminPreview`（`src/lib/articles.ts`、statusを問わず取得）＋既存 `ArticleBodyView`/`ArticleThumbnail` を再利用し公開ページと同一体裁で表示。`robots:{index:false,follow:false}`＋`dynamic="force-dynamic"`、状態は変更しない（GET相当）。承認/却下/編集/戻る導線あり。`/admin` 配下は既存の Proxy（旧middleware, `src/proxy.ts`）が Basic 認証で保護済みのため追加対応不要。
- **管理UI**: `src/app/admin/page.tsx` に「未レビュー N件」バッジ・「公開ポリシー」トグルパネル（6カテゴリ）・「レビューキュー（要レビュー）」セクションを追加。既存セクション（保留キュー・保留コメント・記事管理・実行結果・公開記事総数・人気記事・失敗ログ）は構成不変。`STATUS_LABELS` に `review: "要レビュー"` を追加。
- **既存テストの回帰対応**: `Article.status` の既定挙動が「全カテゴリ要レビュー」に変わったため、hotness/moderation/dedup等の既存ロジックを検証していた6テストファイル（generation-pipeline / generation-post-pipeline / 同x / 同x-reply-s2 / 同patch-preview / pipeline-run-pipeline）の `resetDb` に「全カテゴリ `autoPublish=true`」の明示的シードを追加し、それらのテストが引き続き"published"を検証できるようにした（ポリシー自体の検証は新規テストファイルで別途担当）。

## 技術選定（該当する場合のみ）
- 新規依存追加なし。architecture.md のベースライン（Next.js/Prisma/SQLite/Vitest）は不変。カテゴリ別ポリシーはbriefの指示どおり新規Prismaモデル1つで永続化。

## 受け入れ基準チェック（自己申告）
- [x] `/admin` に「未レビュー N件」バッジ表示: 実機確認済み（`http://localhost:3100/admin`、0件→1件で増減も確認）。
- [x] 「公開ポリシー」パネルに6カテゴリが1行ずつ、初期状態は全行「要レビュー」: 実機HTML確認済み。
- [x] カテゴリを「自動公開」に切替→保存→他カテゴリ不変→再読み込み後も保持: `category-policy.test.ts` で自動テスト済み（DB結合）。
- [x] アプリ再起動後も設定保持: DB永続化（`prisma migrate dev`実行・SQLiteファイル）のため保持される。テストでも別プロセス相当のDB結合テストで検証。
- [x] 「要レビュー」に戻すと全カテゴリ要レビューに戻る: `category-policy.test.ts`（上書きテスト）で確認。
- [x] 全カテゴリ要レビューでパイプライン実行→公開記事総数不変・レビューキューに積まれる: `generation-post-pipeline-category-policy.test.ts` で確認。
- [x] 特定カテゴリのみ自動公開でパイプライン実行→そのカテゴリのみ公開・他はレビューキュー: 同上テストで確認。
- [x] 安全フィルタ該当は自動公開カテゴリでも公開されず保留キューへ（レビューキューに入らない）: `generation-pipeline.test.ts`/`generation-post-pipeline-category-policy.test.ts` の重複(duplicate)ケースで確認（held優先）。
- [x] レビューキュー記事の個別URL直叩きは404相当: 実機確認済み（`curl`でHTTP 404）。`review-status-exclusion.test.ts`でも`getArticleBySlug`がnullを返すことを確認。
- [x] 検索でレビューキュー記事がヒットしない: 実機確認済み・`review-status-exclusion.test.ts`で自動テスト済み。
- [x] トップ/カテゴリ/タグ/アーカイブ/ランキング/関連記事/サイトマップにレビューキュー記事が出ない: `review-status-exclusion.test.ts`で全経路を自動テスト済み（トップ実機確認も実施）。
- [x] プレビュー画面で公開ページと同じ構造（見出し/段落/引用/レス枠/埋め込み/パッチ表/目次）: 既存`ArticleBodyView`をそのまま再利用のため構造は同一。実機で本文表示を確認（見出し/段落ブロックのレンダリングを確認。反応/パッチ等の全ブロック型を含む記事での目視は未実施＝下記懸念点に記載）。
- [x] プレビュー後もレビューキューに残る（状態変更なし）: プレビューはGET専用read関数のみで状態変更コードなし（設計上不変）。
- [x] プレビューはBasic認証必須・robots非インデックス: 実機確認済み（未認証401、`<meta name="robots" content="noindex, nofollow">`確認）。
- [x] 承認して公開→レビューキューから消え未レビュー件数-1・公開一覧に反映: `admin-articles.test.ts`（新規describeブロック）で自動テスト済み。
- [x] 却下→レビューキューから消え公開サイトに出ない: 同上テストで確認。
- [x] 既存セクション（保留キュー/保留コメント/記事管理/実行結果/公開記事総数/人気記事/失敗ログ）は従来どおり: UIの既存部分は無変更（追記のみ）。既存テスト1911件が全てGreenのまま。
- [x] 記事管理の状態ラベルに「要レビュー」が追加され区別表示: `STATUS_LABELS`に追加、既存ラベルは不変。
- [x] 予約公開記事は従来どおり公開される（要レビューに差し戻されない）: `promoteScheduledArticles`は本スプリントで一切変更していない（`scheduled-publish.test.ts`既存テストがGreenのまま）。
- [x] レビューキュー0件時「要レビューの記事はありません」・バッジ「未レビュー 0件」: `admin-articles.test.ts`で確認、実機でも初期状態で確認済み。
- [x] ポリシー設定・承認・却下は未認証だとDBが変わらない: `category-policy.test.ts`/`admin-articles.test.ts`で`UnauthorizedError`を確認。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev   # 本スプリントの新マイグレーション(20260801101440_admincms_s1_review_policy)を含め適用
npm run db:seed          # 初回のみ
ADMIN_USER=<任意> ADMIN_PASSWORD=<任意> npm run dev   # または npm run build && npm run start
```
- `/admin` は Basic 認証必須（`ADMIN_USER`/`ADMIN_PASSWORD` を `.env` または環境変数で設定。未設定時は503で保護）。
- プレビュー: `/admin/articles/<articleId>/preview`
- テスト: `npx vitest run`（1911件、本スプリントで+8ファイル・+40テスト前後を追加）
- 型チェック: `npx tsc --noEmit` / Lint: `npm run lint` / ビルド: `npm run build`（いずれもエラー0件で確認済み）

## 既知の問題・懸念点
- サーバーアクション（承認/却下/ポリシー切替のボタン押下）は、Next.js Server Actions の内部エンコーディングが `curl` での素朴な模擬に向かないため、**ボタンのブラウザ実クリックまでは未検証**。ライブラリ関数（`approveReviewArticle`/`rejectReviewArticle`/`setCategoryAutoPublish`）自体はDB結合テストで検証済みで、既存の`approveArticleAction`等と同一パターンで配線しているため動作する見込みは高いが、evaluatorのPlaywright実機操作での最終確認を推奨。
- プレビュー画面の「公開ページと完全同一の構造」は、見出し・段落ブロックを含む記事では実機確認済みだが、レス（reaction）ブロックの強調色・アンカーや埋め込みカード・パッチ表・目次を含む記事での目視確認は今回行っていない（`ArticleBodyView`をそのまま再利用しているため公開記事ページと描画コードが完全に同一であり、構造的には保証されるが、evaluatorでの実機目視確認を推奨）。
- 管理画面（`/admin`）はダークテーマ固定(`bg-neutral-950`)で、再利用した`ArticleBodyView`の各ブロックはTailwindの`dark:`バリアント（`dark`クラス未付与時は既定＝ライトモード配色）で描画されるため、プレビュー内の一部要素（レス枠・引用等）はライトモード配色のカードとして表示される。公開ページの見た目（構造・クラス）とは完全一致するが、管理画面全体のダーク基調とは配色が混在する（機能・構造には影響なし、見た目の一貫性のみの軽微な観点）。
- 既存6テストファイルの`resetDb`に「全カテゴリ自動公開」のシードを追加する対応を行った（本スプリントでの必然的な既定値変更に伴う既存回帰防止）。これは実装上のバグではなく、F1導入に伴う意図した既定値変更（「全カテゴリ要レビュー」）が既存の生成ロジック検証テストの前提と衝突したための調整である。

## 追加したテスト
- `src/lib/__tests__/publish-decision.test.ts`: `decidePublishState`の4分岐（held優先を含む）。
- `src/lib/__tests__/category-policy.test.ts`: `resolveAutoPublish`純関数（既定値/該当行あり/未知カテゴリ）＋DB結合（未保存時の既定値・1カテゴリ変更時の他カテゴリ不変・上書き・未認証拒否・未知カテゴリ保存の無害性）。
- `src/lib/__tests__/review-status-exclusion.test.ts`: review状態記事が一覧/カテゴリ/タグ/検索/累計人気/期間別人気/サイトマップ/ニュースサイトマップ/個別記事取得/月別・日別アーカイブ/カテゴリ露出判定/関連記事のいずれからも除外されることを網羅。
- `src/lib/__tests__/admin-articles.test.ts`（追記）: レビューキューの取得・件数・承認/却下の状態遷移（review→published/rejected）・不正遷移の拒否（review以外からの承認/却下）・未認証拒否。
- `src/lib/__tests__/generation-pipeline.test.ts`（追記）: 旧経路でのカテゴリポリシー分岐（要レビュー保存・held優先=重複判定）。
- `src/lib/__tests__/generation-post-pipeline-category-policy.test.ts`（新規）: 既定の新経路でのポリシー未設定時review・autoPublish時published・複数カテゴリ混在・held優先。
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`（追記）: `report.reviewCount`/`PipelineRunLog.reviewCount`の記録確認。
- 既存6テストファイル（generation-pipeline / generation-post-pipeline / 同x / 同x-reply-s2 / 同patch-preview / pipeline-run-pipeline）の`resetDb`にカテゴリポリシーの明示シードを追加（回帰防止、新規アサーション追加ではない）。

## 前回フィードバックへの対応（試行2・バグ修正）
- 指摘: `scripts/pipeline.ts` の非網羅ternary（`held`以外を全て`"published"`と表示）により、`publicationStatus="review"`（本スプリントで追加）と`"scheduled"`が「published」と誤表示される。実行サマリにも要レビュー件数（`report.reviewCount`）が出ておらず、`status=published`と`公開=0 保留=0`が矛盾する。
  → 対応:
  - `src/lib/pipeline/cli-format.ts`を新設し、CLI表示ロジックを純関数として切り出し。
    - `formatPublicationStatus`: `publicationStatus`の4値（published/held/review/scheduled）を switch で網羅し、default節で`never`型チェック（将来値追加時にコンパイルエラーで気づける）。review→`review(要レビュー)`、scheduled→`scheduled(予約)`、held→従来どおり`held(理由:...)`。
    - `formatRunSummaryLine`: 実行サマリ文字列に既存項目（収集/候補/生成成功/生成失敗/公開/保留/予約公開昇格）はそのまま維持しつつ「要レビュー=N」を追加（`report.reviewCount`。既に`PipelineRunReport`/`PipelineRunLog`に配線済みだった値をCLI表示に反映しただけで型追加は不要だった）。
  - `scripts/pipeline.ts`はこの2関数を呼ぶだけに変更（ロジック自体は`cli-format.ts`に移動）。
  - 変更範囲は`scripts/pipeline.ts`＋新設`src/lib/pipeline/cli-format.ts`のみ。`post-pipeline.ts`/`publish-decision.ts`/`category-policy.ts`/管理UI/DBスキーマは一切変更していない（指示どおり不変条件維持）。
  - テスト追加: `src/lib/__tests__/pipeline-cli-format.test.ts`（新規5件）。`formatPublicationStatus`の4分岐（review/scheduledが誤ってpublishedにならないことを明示的にアサート）＋`formatRunSummaryLine`が「要レビュー=」を含むことを確認。
  - 検証: `npx vitest run`（139ファイル・1916件、全Green）／`npx tsc --noEmit`（エラー0）／`npm run build`（成功）／`npm run lint`（既存の警告7件のみ、エラー0、本修正由来の新規警告なし）。

## 関連ドキュメント
- [[admincms-s1-brief]]（本スプリントの仕様抜粋）
- [[admin-cms-v2-spec]]（製品仕様書）
