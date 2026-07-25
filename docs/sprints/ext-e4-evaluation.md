---
tags: [sprint-evaluation]
sprint: ext-e4
result: PASS
---

# Sprint E4（SEO/集客）評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）+ curl/Bash 併用
- feed.xml / archive / JSON-LD / ranking API は curl で、ランキングタブ切替・タグ遷移・パンくず・ダーク表示は実ブラウザで検証。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全観点で期待通り。ブロッカーなし |
| コンソールエラー0件 | PASS | home / 記事 / タグ / archive で `browser_console_messages` = 0 errors/0 warnings |
| 受け入れ基準充足率100% | PASS | 観点1〜7すべて確認（下記） |
| テストGreen（全テスト成功） | PASS | `npm test`（Vitest）= 43ファイル / 353件 全passed |

## 観点ごとの結果
1. RSS feed — PASS
   - `/feed.xml` HTTP 200, `content_type: application/rss+xml`。RSS2.0構造・item12件・`atom:link rel=self`・title/link/guid/pubDate/description あり。
   - 未エスケープ`&`=0、`</rss>`で閉じ整形式。記事`<head>`に`rel="alternate" type="application/rss+xml"`あり。
   - 保留記事（後述の held テスト記事）はfeedに出ない（grep 0件）。
2. 期間別ランキング — PASS
   - サイドバーに 累計/日間/週間/月間 タブ。閲覧イベント（記事を複数回curlで開封→`ArticleView`16行）を作成後、`/api/ranking?period=day|week|month` が閲覧回数順（patch-jungle=6→yasuo=4→worlds=3…）を返す。
   - ブラウザで「日間」クリックすると累計と異なる順に切替（fetch, HTTP200）。累計は従来通りSSR表示。`period=total`/不正値は400（累計はAPIを使わずSSRのため設計通り）。
3. タグクラウド — PASS
   - サイドバー「人気タグ」が記事数で文字サイズ変化（#eスポーツ3 が最大等）。`/tags/eスポーツ` へ遷移でき、該当3記事表示。
4. 月別アーカイブ — PASS
   - `/archive`（2026年7月（12件））・`/archive/2026-07`（記事一覧, articles/リンク）表示。`/archive/invalid`・`/archive/2026-13`・`/archive/2026-00` は404。`/archive/1999-05`（形式正・0件）は200で空状態（設計通り）。サイドバーに月別アーカイブウィジェットあり。保留記事はアーカイブ件数に含まれない（12件のまま）。
5. BreadcrumbList JSON-LD — PASS
   - 記事ページに JSON-LD 2ブロック（NewsArticle + BreadcrumbList）。BreadcrumbList = 1:トップ > 2:パッチ/メタ > 3:記事名。ブロック内に未エスケープ`<`なし。可視パンくず（トップ / パッチ/メタ / 記事名）と整合。
6. ブログランキング枠 — PASS
   - `BLOG_RANKING_HTML` 未設定時、サイドバーに「応援クリックお願いします / ブログランキング（未設定）」プレースホルダ表示（AdSlotと同方式・env駆動）。
7. 回帰・安全 — PASS
   - 記事ページのレス/引用/画像/出典/リアクション（😂😮😡👍 カウント動作）/コメント一覧・投稿フォーム/シェア/関連記事が正常。ダークモードで崩れなし（フルページスクショ確認）。`/admin`分離・法務フッター維持。
   - 保留記事の非露出を実検証: `status=held`＋20閲覧イベント付きテスト記事を投入 → feed/ranking(day)/archive/タグクラウド/タグページいずれにも出ず、直接URLは404。検証後に削除し `npm run db:seed` でDB復元。

## 発見したバグ・問題点（FAILの原因）
- なし

## 軽微な改善点（ブロッカーではない）
- `ArticleView` は物理削除されず増え続ける設計（selfeval記載の通り。cutoffで集計除外のみ）。長期運用で古い行の定期削除バッチの余地あり。今スプリントのスコープ外で妥当。
- 期間別タブ切替はクライアントfetch依存のためJS無効環境では切替不可（初期の累計はSSR表示されるため実害は限定的）。

## 未検証項目（実機確認が必要）
- `BLOG_RANKING_HTML` に実HTMLを設定した際の描画（`dangerouslySetInnerHTML`）は、既存AdSlotと同一機構のため未設定プレースホルダ経路のみ確認。設定値注入の実描画はサーバー再起動を要するため本検証では未実施。仕様上は「フッターまたはサイドバー」いずれか可で、サイドバー配置で充足。

## プレビュー画像
- `ext-e4-preview-1.png`（ホーム全体: 期間別ランキングタブ・人気タグ・月別アーカイブ・ブログランキング枠, ダーク）
- `ext-e4-preview-2.png`（`/archive/2026-07` 月別記事一覧）

## 関連ドキュメント
- [[ext-e4-selfeval]]（ジェネレーターの自己評価レポート）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
