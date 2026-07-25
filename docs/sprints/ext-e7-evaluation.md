---
tags: [sprint-evaluation]
sprint: E7
result: PASS
---

# Sprint E7（運営CMS＋認証）評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機） + curl（認証/API直叩き）
- Basic認証はブラウザにダミー資格情報をキャッシュさせ、以降はクリーンURL（資格情報を含まないURL）で `/admin` を操作。curl は `-u` で検証。資格情報の平文は本レポートに記載しない。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 9観点すべて期待どおり動作 |
| コンソールエラー0件 | PASS | クリーンURLでの全管理操作（承認/却下/編集/ピン/削除）でエラー0。唯一のエラーは検証手法起因（下記） |
| 受け入れ基準充足率100% | PASS | 観点1〜9すべてPASS |
| テストGreen（全テスト成功） | PASS | `npm test` → 55ファイル458テスト全Green |

補足（コンソールエラーについて）: セッション中に1件だけ `TypeError: Failed to execute 'fetch' ... URL that includes credentials: /admin` が出たが、これは評価者がBasic認証を通すため一時的にURLへ資格情報を埋め込んで遷移した検証手法の副作用（fetch APIは資格情報入りURLを拒否する仕様）。実運用のブラウザ認証ダイアログ経由ではURLはクリーンでこのエラーは発生せず、クリーンURLに切り替えた後の全操作でエラー0を確認済み。アプリのJSバグではない。

## 観点ごとの結果
- 1. /admin認証: PASS — 資格情報無し=401（`WWW-Authenticate: Basic`付）、誤資格情報=401、正資格情報=200（`運営監視ダッシュボード`表示）。公開サイト（トップ/記事）は認証不要で200。
- 2. 未認証での管理操作拒否: PASS — 未認証で `POST /admin`・`POST /admin/articles/x/edit`・偽Next-Actionヘッダ付きPOSTすべて401（proxyでブロック）。加えて各lib関数が `AdminAuthContext` を入口で再検証（defense-in-depth、Vitestの未認証拒否テストGreen）。
- 3. 保留記事の承認/却下: PASS — [承認して公開]で status=published＋publishedAt更新、公開直URL200。[却下]で status=rejected、直URL404、公開件数不変。
- 4. 保留コメントのモデレーション: PASS — 公開フォームにNGワード投稿→held(422)。[承認]で status=published＋対象記事commentCount 7→8＋記事ページに表示。[削除]でレコード消去（held残0）。
- 5. 記事編集: PASS — /adminからタイトル変更→保存→公開ページに新タイトル反映、status維持。
- 6. 予約公開: PASS — 未来予約は404（scheduled）、過去日時予約は `npm run pipeline`（予約公開昇格=1）で published へ昇格し直URL200、未来予約は404のまま。
- 7. ピン留め: PASS — [ピン留めする]で pinned=true、一覧/ランキング先頭へ移動＋トップに📌バッジ、adminに「📌 注目」表示と「ピン留め解除」ボタン。
- 8. 公開限定の維持: PASS — held/scheduled/rejected は直URL404、sitemap.xml/feed.xml/トップにタイトル露出0。
- 9. 回帰・分離: PASS — robots.txtが `Disallow: /admin`、sitemapに/admin露出0、公開記事のコメント投稿/出典表示、champions/tier/glossary/patches/archive 全200、ranking API は period=day/week/month で200（パラメータ無し400は入力検証の正しい挙動）。ダーク表示のレイアウト崩れなし（プレビュー参照）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 記事編集の本文は「ブロック配列JSONのテキスト編集」で、JSON構文理解を運営者に要求する（仕様上許容範囲）。
- 予約公開の昇格は `npm run pipeline` 実行契機に依存（常駐cronはE7対象外・README記載済み）。

## 未検証項目（実機確認が必要）
- 該当なし（Web/curlで全観点を検証済み）。

## プレビュー画像
- `ext-e7-preview-1.png`（認証後の管理画面: 保留キュー承認/却下・保留コメント承認/削除・記事管理のボタン群、ダーク表示）
- `ext-e7-preview-2.png`（管理画面フルページ）

## 関連ドキュメント
- [[ext-e7-selfeval]]（ジェネレーターの自己評価レポート）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
