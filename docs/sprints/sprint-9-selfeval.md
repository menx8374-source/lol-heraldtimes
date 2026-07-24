---
tags: [sprint-selfeval]
sprint: 9
---

# Sprint 9 自己評価レポート

## 実装した内容
- `src/lib/dashboard.ts`: ダッシュボード専用のデータ集約層（公開サイトの閲覧系クエリとは分離）。
  - `listRunHistory`: `PipelineRunLog` を新しい順に取得（収集/生成成功/生成失敗/公開/保留の5指標）。
  - `countPublishedArticles` / `getPopularArticlesForDashboard`: 公開記事総数・人気ランキング（既存 `lib/articles.ts` の `PUBLISHED_ONLY`・`listPopularArticles` を再利用）。
  - `getHeldArticlesForDashboard`: 既存 `moderation/queue.ts` の `listHeldArticles` をそのまま利用。
  - `mergeFailureLogs`（純関数）+ `listFailureLog`: `SourceFetchLog`(収集失敗)・`CollectedItem.generationError`(生成失敗)・`PipelineRunLog`(パイプライン全体の想定外失敗) の3種を「どの工程で何が失敗したか」が分かる1本の時系列に統合。
- `src/app/admin/page.tsx`: 管理ダッシュボードページ（`export const dynamic = "force-dynamic"` でキャッシュせず最新DB状態を反映。`metadata.robots = { index: false, follow: false }` も追加でnoindex）。実行結果テーブル・保留キュー一覧・公開総数/人気ランキング・失敗ログ一覧を表示。
- `src/components/site-chrome.tsx`（新規）+ `src/app/layout.tsx`（変更）: `usePathname` で `/admin` 配下かどうかを判定し、`/admin` では公開サイトのヘッダー（検索フォーム・カテゴリnav）・フッターを一切表示しない構造に分離。ルートlayout自体は1つのまま（route group分割はスコープに対して過剰と判断し不採用）。
- `src/app/robots.ts`: コメントを「Sprint 9で実装済み」に更新（Disallow設定自体は変更なし。既に `/admin` を含んでいた）。

## 技術選定
- ダッシュボードのnav非露出を「ヘッダー/フッターに`/admin`へのリンクを追加しない」だけでなく、`/admin`配下では公開サイトの共通ヘッダー/フッター自体を非表示にする方式（クライアントコンポーネント`SiteChrome`で`usePathname`判定）を採用。Next.jsの「複数root layout（route group分割）」より変更範囲が小さく、既存のsitemap.ts/robots.ts/not-found.tsの配置に影響を与えないためリスクが低い。

## 受け入れ基準チェック（自己申告）
- [x] 直近の実行結果（収集/生成/公開/保留/失敗件数）が時系列で表示される: `/admin` のテーブルで確認（`npm run pipeline`実行後、収集=8 生成成功=5 公開=5 保留=0 のログ行が表示された）。
- [x] 保留キューの記事が保留理由付きで一覧表示される: 手動で保留記事(heldReason="ng_word", heldDetail付き)を投入しダッシュボードに表示されることを確認（確認後にデータは削除済み）。
- [x] 公開記事の総数と人気記事ランキングが表示される: 総数17件、閲覧数降順トップ10が表示されることを確認。
- [x] エラー／失敗ログが確認でき、どの工程で何が失敗したかが分かる: `SourceFetchLog`(収集失敗)を手動投入し「収集」ラベル付きで表示されることを確認。生成失敗（`CollectedItem.generationError`）・パイプライン全体失敗（`PipelineRunLog.status=failure`）はDB結合テストで統合ロジックを検証済み（実運用データでは今回発生せず未再現、ロジックはテストで担保）。
- [x] ダッシュボードは公開サイトのナビゲーションから辿れず、robots でクロール対象外: トップページHTMLに`/admin`へのリンクなしを確認。`robots.txt`に`Disallow: /admin`があることを確認。`/admin`ページ自体もheader/footer非表示＋`noindex`メタタグ。
- [x] Sprint 7のパイプラインを1回実行した後、その実行結果がダッシュボードに反映されて確認できる: `npm run db:seed` → `npm run pipeline` 実行後、`/admin`に該当実行のログ行が即座に反映されることを確認（`force-dynamic`によりキャッシュされない）。

## アプリの起動方法
```
npm run build   # または npm run dev
npm run start -- -p 3100   # 本番相当で確認する場合
npm run db:seed
npm run pipeline
```
- 公開サイト: `http://localhost:3100/`
- 運営ダッシュボード: `http://localhost:3100/admin`
- robots: `http://localhost:3100/robots.txt`（`Disallow: /admin` を含む）

## 既知の問題・懸念点
- 認証は本スプリントのスコープ外（受け入れ基準にも含まれないため未実装）。ナビ非露出＋robots除外のみで「一般閲覧者に露出しない」を担保している。本番公開時にダッシュボードへの認証追加を検討する余地は残る（今後のスプリント/運用判断）。
- 実運用データでは「生成失敗」「パイプライン全体失敗」のケースが今回のパイプライン実行では発生しなかったため、実データでの目視確認は「収集失敗」「保留」のみ（いずれも手動投入して確認、確認後削除）。統合ロジック自体はDB結合テスト（`dashboard.test.ts`）で3種すべてを検証済み。
- `/security-review`・`/code-review`はローカル専用運用のため実行不可（`reference/learnings.md`記載の既知の制約。オーケストレーター側での手動レビューに委ねる）。

## 追加したテスト
- `src/lib/__tests__/dashboard.test.ts`
  - `mergeFailureLogs`（純関数）: 3種の失敗ログを日時降順で統合すること／メッセージ欠落時のデフォルト文言／空配列時の挙動。
  - DB結合テスト: `listRunHistory`（新しい順・件数指標）、`countPublishedArticles`（保留記事を含めない）、`listFailureLog`（3種統合をDB経由で検証）。
- 既存137件 + 新規6件 = 全143件 `npm test` でGreen（`vitest run`、fileParallelism:false設定のまま）。

## 関連ドキュメント
- [[sprint-9-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
