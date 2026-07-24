---
tags: [sprint-evaluation]
sprint: 8
result: PASS
---

# Sprint 8 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機） + Bash/curl（HTML出力・DB直接確認）
- ブラウザ実機操作（記事ページ・トップページ）＋ `curl` によるHTML/head出力確認＋ Prisma でのDB直接確認を併用。
- Bash縮退なし。未検証のネイティブ機能なし（対象プラットフォームは `web`）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全受け入れ基準の操作を再現、破綻・エラーなし |
| コンソールエラー0件 | PASS | 記事ページ・トップページとも `browser_console_messages` で Errors:0 / Warnings:0 |
| 受け入れ基準充足率100% | PASS | F12・F13 の全項目を実機/curl/DBで確認（下記） |
| テストGreen（全テスト成功） | PASS | `npm test`（Vitest）= 22ファイル 137件すべて pass |

## F12 広告枠（受け入れ基準）
- 個別記事ページに4枠存在（article-top / article-in-body / article-bottom / sidebar）: PASS。`data-ad-slot` 4種すべて出力、スナップショットでも4枠を確認。
- 未設定枠のプレースホルダー表示: PASS。`AD_SLOT_ARTICLE_IN_BODY`/`_BOTTOM` 未設定 → 「広告枠（未設定）」表示。
- トップ一覧に一定間隔で広告枠: PASS。`adInterval=4`、公開12件で listing 枠が2箇所（4件目・8件目後、最終グループ後は出さない）。スクリーンショットで視認。
- 広告タグ設定→各枠に出力: PASS。`AD_SLOT_ARTICLE_TOP`/`_SIDEBAR`（記事=動的、起動時env）と `AD_SLOT_LISTING`（トップ=静的、ビルド時env）に注入文字列を設定し、各枠にそのまま出力されることを curl とスナップショットで確認。
- ラベル/区切りで本文と区別: PASS。全枠に「広告 / PR」ラベル＋破線枠＋背景色。`aria-label`（例「記事上部広告」）も付与。
- 広告枠込みでレイアウト崩れなし: PASS。フルページスクリーンショットで本文・サイドバー・一覧が正常表示、崩れなし。既存Tailwindレスポンシブ（`lg:flex-row`）維持。

## F13 SEO（受け入れ基準）
- 記事ごとの `<title>`・description・OGP: PASS。記事タイトル反映の `<title>`、`<meta name=description>`、`og:title`/`og:description`/`og:url`/`og:image`/`og:type` を curl で確認。
- 構造化データ（記事メタ）: PASS。`<script type=application/ld+json>` に `NewsArticle`（headline/datePublished/articleSection/mainEntityOfPage/image/publisher）出力。`toSafeJsonLd` で `<` エスケープ済み。
- サイトマップ（公開記事のみ＋カテゴリ）: PASS。`/sitemap.xml` = トップ1＋カテゴリ5＋公開記事12＝18件。DBは published 12件のみ（`groupBy` で確認）。保留記事除外は `seo-output.test.ts` でも検証（Green）。
- robots 除外: PASS。`/robots.txt` で `/admin`・`/dashboard`・`/api/` を Disallow、`Sitemap:` 明記。
- title のページ固有性: PASS。トップ「LoLまとめ速報」／カテゴリ「パッチ/メタ の記事一覧 | LoLまとめ速報」／記事「(記事名) | LoLまとめ速報」で相互に固有。自動テストでも非重複を検証。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- サイトマップの記事 `<loc>` に `lastmod` はあるが、トップ・カテゴリには `lastmod`/`changefreq`/`priority` 未指定（必須ではない）。
- トップページ自体は静的化のままで、パイプライン公開直後の一覧反映には再ビルドが必要（self-eval に申し送り済み。sitemap は `force-dynamic` で対応済み）。
- robots の Disallow パスは Sprint 9 の実ダッシュボードURL確定時に要見直し（コードコメントに明記済み）。

## 未検証項目（実機確認が必要）
- 該当なし（対象は `web`、ネイティブ専用機能なし）。
- 注: レスポンシブは lg 未満幅のフルページ描画でサイドバー縦積み・崩れなしを確認済み。真の物理端末での確認は不要と判断。

## プレビュー画像
- `sprint-8-preview-1.png`（個別記事ページ: 4広告枠＋SEO反映）
- `sprint-8-preview-2.png`（トップ一覧: 一定間隔の listing 広告枠＋サイドバー枠）

## 関連ドキュメント
- [[sprint-8-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-8-brief]]（本スプリントの仕様抜粋）
