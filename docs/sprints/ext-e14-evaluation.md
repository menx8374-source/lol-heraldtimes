---
tags: [sprint-evaluation]
sprint: E14
result: PASS
---

# Sprint E14 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・production build `npm run build && npm run start`）
- テスト: `npm test`（Vitest）→ 64 files / 553 tests 全Green
- production build 成功、no-flash/字体/4通り/機能回帰を実機で検証

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | トグル切替・永続化・4通り表示・記事機能すべて正常 |
| コンソールエラー0件 | PASS | news再訪トップ・記事ページ通常フローで 0 errors/0 warnings（`/admin` の 401 は未認証アクセス時の Basic認証応答で想定内・アプリ不具合ではない） |
| 受け入れ基準充足率100% | PASS | brief受け入れ基準7項目すべて充足（下記観点） |
| テストGreen（全テスト成功） | PASS | `npm test` → 64 test files / 553 tests passed |

## 観点ごとの結果
- デザイン切替トグル: PASS。ヘッダーに「📰 ニュース/◇ 現行」トグルが「🌙 ダーク/☀️ ライト」と独立配置。クリックで `<html>` に `design-news` 付与、ラベルも切替。
- 既定・永続化・no-flash: PASS。初回未保存は classic（`design-news`なし、localStorage `lol-matome:design`=null、既存フォント）。news切替→`lol-matome:design`=`news`→リロード後も保持。no-flashスクリプトが raw HTML の `<head>` に inline で存在（`document.documentElement.classList.add('design-news')` を描画前に同期実行）→FOUCなし。
- 字体（news時）: PASS。body/h2 の computed font-family が `游ゴシック体, "游ゴシック Medium", "Yu Gothic Medium"...` の指定スタック。h2 weight=800。classic時は `-apple-system,...` のまま。
- news配色/レイアウト: PASS。記事カード borderRadius=0・boxShadow=none・下罫1px（ヘアライン区切り）。カテゴリは塗りチップ廃止→太字クリムゾンラベル（light `rgb(179,18,31)`=#b3121f、透明背景）。サイドバー/PICKUPも報道メディア風。
- 4通り（design×theme）: PASS。
  - classic×light: `-apple-system`、塗りチップ、角丸8px（既存据え置き）
  - classic×dark: `-apple-system`、塗りチップ、角丸8px（`design-news`除去で完全復元＝classic据え置き確認）
  - news×light: 游ゴシック、白地(255,255,255)/文字(20,20,20)、クリムゾン#b3121f
  - news×dark: 游ゴシック、地色(10,10,10)/文字(242,242,242)、明るめクリムゾン(255,90,103)=#ff5a67。コントラスト良好。
- 記事ページ・機能回帰: PASS。記事ページ（タイトル/まとめレス枠`data-reaction-group`/コメント`data-comment-row` bg=クリムゾン系(253,236,234)/出典/シェアバー/広告枠）が news 字体・配色に追従。機能実動作を確認:
  - リアクション1回制限: 😂 0→1、続けて😮クリックで😂 1→0・😮 22→23（切替式・1つのみ選択）正常。
  - コメント投稿: 「コメント(4)」→投稿→「コメント(5)」、本文反映。
  - 検索: `?q=パッチ` で5件ヒット、news適用。
  - まとめレス枠: news字体で表示。
- コンソールエラー0件: PASS（上記）。

## 発見したバグ・問題点（FAILの原因）
- なし（FAILなし）。

## 軽微な改善点（ブロッカーではない）
- `.design-news body`（font/bg/color）は `main` にスコープされず `<html>` 直下 body に効くため、news保存済みユーザーが `/admin` を開くと admin body も news フォント（游ゴシック）・白地・news文字色を継承する。selfeval の「管理画面には一切影響しない」は body フォント波及の点で厳密には不正確。ただし `/admin` は `main`/`header[data-site-header]` を描画しないため構造スタイル（罫線・チップ・クリムゾン等）は一切適用されず、表示崩れ・機能障害はなく完全に閲覧・操作可能（スクショ目視で確認）。formalな受け入れ基準（brief記載7項目）にも「/admin無影響」は含まれず、致命的バグ・コンソールエラーにも該当しないためブロッカーではない。気になるなら body ルールも `.design-news main`/`header`/`footer` 相当にスコープするか、admin側で `design-news` を無効化する余地あり。

## 未検証項目（実機確認が必要）
- 該当なし（Webプラットフォームのため全項目ブラウザ検証済み。`/admin` は Basic認証（`ADMIN_USER`/`ADMIN_PASSWORD`）越しに認証付きURLで表示確認済み）。

## プレビュー画像（PASS）
- `ext-e14-preview-classic-light.png`
- `ext-e14-preview-classic-dark.png`
- `ext-e14-preview-news-light.png`
- `ext-e14-preview-news-dark.png`

## 関連ドキュメント
- [[ext-e14-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e14-brief]]（本スプリントの仕様抜粋）
