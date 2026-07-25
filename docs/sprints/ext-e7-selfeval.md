---
tags: [sprint-selfeval]
sprint: E7
---

# 拡張スプリント E7（運営CMS＋認証）自己評価レポート

## 実装した内容
- **/admin の認証**: Next.js Proxy（`src/proxy.ts`、旧middleware。Next 16でmiddleware→proxyに改称されたためproxy.tsで実装）による Basic 認証。`/admin`・`/admin/:path*` を保護。認証情報は `.env` の `ADMIN_USER`/`ADMIN_PASSWORD`（ハードコードなし）。未設定時は常に503で管理機能ごと無効化。誤/未認証は401（`WWW-Authenticate`付き）。
- **defense-in-depth**: 各管理系ライブラリ関数（`src/lib/admin/articles-admin.ts`・`comments-admin.ts`）は`AdminAuthContext`（Authorizationヘッダー値）を受け取り、実行前に独立して`requireAuthorized`で再チェック（UIを隠すだけにしない）。Server Actions（`src/app/admin/actions.ts`）が`next/headers`からヘッダーを取り出して渡す。
- **timing-safe比較**: `src/lib/auth/basic-auth.ts`に自前の定数時間比較(`timingSafeEqual`)を実装（Edge/Node両ランタイムで動く純JS実装。長さ不一致でも早期returnせず常に同じ回数比較）。
- **保留記事の承認/却下UI**: `/admin`の「保留キュー」セクションに承認（`status=published`+`publishedAt`更新）・却下（`status=rejected`。出典URLは残し同一話題の再生成を防止）ボタンを追加。
- **保留コメントのモデレーションUI**: 「保留コメント」セクションに承認（`status=published`+対象記事`commentCount`+1、二重承認防止のupdateManyガード付き）・削除（レコード削除）ボタンを追加。
- **記事編集**: `/admin/articles/[id]/edit`でタイトル・本文（ブロック配列JSONテキスト）を編集。保存時に本文JSONをパース検証し、既存の安全フィルタ（NGワード/出典欠落/個人中傷）を再チェック。公開中記事が編集後に不合格になった場合は自動的に保留(held)へ落とし、公開の不変条件を維持。
- **予約投稿（スケジュール公開）**: `Article`に`scheduledAt`（`DateTime?`）と`status="scheduled"`を追加。`/admin`から日時を設定すると`scheduled`になり公開限定クエリから除外される。`src/lib/generation/scheduled-publish.ts`の`promoteScheduledArticles`が`scheduledAt<=now`のscheduled記事を`published`へ昇格し、`runFullPipeline`（`npm run pipeline`実行のたび）に統合済み。予約解除ボタンで`held`へ戻せる。
- **ピン留め（注目記事固定）**: `Article.pinned`（`Boolean @default(false)`）を追加。`listArticles`/`listArticlesByCategory`/`listArticlesByTag`/月別アーカイブが使う共通クエリ（`paginatedFindMany`）と`listPopularArticles`（PickupCarousel用）のorderByを`[{pinned:"desc"}, ...]`に変更し、ピン留め記事を先頭に優先表示。ArticleCard/PickupCaroulselに📌バッジ表示を追加。既存記事は全てpinned=falseのため既存の並び順テストへの影響なし。

## 技術選定
- Basic認証 + Proxy(middleware): 仕様書の許容案2つ（Basic認証 or パスワードログイン+署名Cookie）のうちシンプルなBasic認証を選択。ブラウザネイティブの認証ダイアログで完結し、Cookie発行・CSRFトークン管理・セッションストアが不要（無料・追加依存なし）。
- timing-safe比較の自前実装: Node標準の`crypto.timingSafeEqual`はEdgeランタイムで使えず長さ不一致で例外を投げるため、Edge/Node両対応の純JS定数時間比較を実装（外部ライブラリ追加なし）。
- `src/middleware.ts`ではなく`src/proxy.ts`: ビルド時に"middleware file convention is deprecated"警告が出たため、Next.js 16の現行規約である`proxy.ts`（`export function proxy`）に合わせた（機能は同一、警告解消を確認済み）。
- 却下(reject)はハード削除ではなくstatus="rejected": `ArticleSource`のURLを残すことで、収集パイプラインの重複判定（`rebuildCandidateQueue`が既存記事の出典URL集合を参照）が却下済み話題を「既に記事化済み」として扱い続け、再生成を防げるため。

## 受け入れ基準チェック（自己申告）
- [x] `/admin`が認証で保護され、未認証は401/管理機能無効時503、公開サイトは認証不要のまま — curl実機確認済み（後述）。
- [x] 認証情報はenv経由・ハードコードなし・timing-safe比較 — `src/lib/auth/basic-auth.ts`、Vitestで検証。
- [x] 管理系サーバーアクションも認証チェック（UIを隠すだけにしない） — `AdminAuthContext`を各lib関数の入口で再検証、未認証テストあり。
- [x] 保留記事の承認/却下UI — 実機確認済み（承認で公開反映、公開限定クエリから却下記事が除外されることをVitestで確認）。
- [x] 保留コメントのモデレーションUI — 実機確認済み（承認でcommentCount加算、削除でレコード消去）。
- [x] 記事編集（タイトル+本文） — 実機確認済み。編集後の安全フィルタ再チェックはVitestで確認（NGワード編集で公開中記事がheldへ落ちることを検証）。
- [x] 予約投稿（時刻到来まで非公開、到来で公開、公開限定クエリはscheduled除外） — Vitestで到来/未到来の両方を検証、`npm run pipeline`実機実行でも昇格を確認。
- [x] ピン留め（注目記事・一覧先頭に優先表示） — 実機確認済み（HTMLでピン留め記事が最初のカードとして描画、📌バッジ表示を確認）。
- [x] 公開限定クエリ(PUBLISHED_ONLY)がheld/scheduled/rejectedを除外 — Vitest専用テストで4状態を作り、publishedのみ返ることを確認。直URLは404のまま（実機確認済み）。
- [x] `/admin`のrobots除外・公開nav非露出・chrome分離を維持 — `robots.ts`・`site-header.tsx`は無変更。

## アプリの起動方法
```
npm install
npx prisma migrate dev      # 初回のみ（本スプリントで新規マイグレーション追加済み: 20260725083143_add_admin_cms_e7）
npm run db:seed
```
`.env` に以下を追加（`.env.example`にキー名のみ記載済み・**秘密情報のためコミットしない**）:
```
ADMIN_USER=<任意のユーザー名>
ADMIN_PASSWORD=<任意のパスワード>
```
- 開発: `npm run dev` → `http://localhost:3000`
- 本番相当: `npm run build && npm run start`
- `/admin` はブラウザでアクセスすると認証ダイアログが出る（`ADMIN_USER`/`ADMIN_PASSWORD`を入力）。または `curl -u <user>:<password> http://localhost:3000/admin`。
- 予約公開の昇格は `npm run pipeline` 実行時に自動で走る（無人cron運用を想定）。
- テスト: `npm test`

## 既知の問題・懸念点
- 予約公開の昇格は「`npm run pipeline`（またはcron等での定期実行）が動くこと」に依存する。本スプリントではSprint7同様、常駐cronの自動起動自体は対象外（既存方針を踏襲）。無人運用で厳密な時刻通り公開したい場合はOSタスクスケジューラ/cron等で`npm run pipeline`を定期実行する運用が必要（README記載済み、Sprint7からの既存注記と同じ）。
- 記事編集フォームの本文は「ブロック配列JSONのテキスト編集」という最低限の実装（リッチなブロックエディタUIではない）。仕様上「本文はブロックJSONのテキスト編集 or 主要フィールドの編集でよい」と明記されており許容範囲内だが、JSON構文を運営者が理解している前提のUX。
- ピン留めの優先表示は`paginatedFindMany`（listArticles/カテゴリ/タグ/月別アーカイブ共通）に適用したため、カテゴリ・タグ・アーカイブページでも古いピン留め記事が先頭に来る（トップページ限定ではなく全一覧に一貫して効く仕様として実装）。既存記事はpinned=falseなので既存表示順への影響はない。
- Server Actionsの実機検証はcurlで`multipart/form-data`＋`$ACTION_ID_*`隠しフィールドを再現する形で行った（ブラウザの実クリックではない）。フォーム送信のHTTPプロトコルレベルでは実際に動作を確認済みだが、ブラウザでのクリック操作自体はPlaywrightを持つevaluatorでの検証を推奨。

## 追加したテスト
- `src/lib/__tests__/basic-auth.test.ts`: env読み取り・timing-safe比較・Basicヘッダーのパース・正誤資格情報の検証・未設定時の拒否・`assertAuthorizedHeader`の例外送出（純関数、DB非依存）。
- `src/lib/__tests__/admin-articles.test.ts`（DB結合）: 未認証拒否（approve/reject/schedule/pin）、承認→公開反映、却下→非公開化、編集（正常/NGワード検出でheldへ降格/不正JSON拒否）、ピン留めの並び順優先、予約設定→公開限定クエリ除外、予約解除、`getArticleForEdit`、公開限定クエリがheld/scheduled/rejectedを除外する統合確認。
- `src/lib/__tests__/admin-comments.test.ts`（DB結合）: 未認証拒否、承認→commentCount加算、二重承認でも1回のみ加算、削除→一覧から消える、一覧取得の記事タイトル/slug紐付け。
- `src/lib/__tests__/scheduled-publish.test.ts`: `isScheduleDue`の境界値（到来/未到来/ちょうど）、`promoteScheduledArticles`の到来/未到来判定とpublishedAt反映、`runFullPipeline`統合による自動昇格。
- 実行結果: `npm test` で55ファイル458テスト全てGreen（既存401テスト＋新規57テスト）。`npx tsc --noEmit`エラー0件。`npm run build`成功。`npm run lint`は既存の無関係な警告1件のみ（新規コードに起因するものではない）。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
