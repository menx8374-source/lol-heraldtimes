---
tags: [sprint-evaluation]
sprint: E1
result: FAIL
---

# Sprint E1（回遊・エンゲージメントUI）評価レポート

## 総合判定: FAIL

ダークモードで主要ページ（トップ・記事）の本文カラム背景と既定文字色が切り替わらず、
ヘッダー/サイドバー/カードだけが暗転する「半分だけダーク」の崩れが再現。受け入れ基準
「ダークモード… 主要ページが両モードで崩れない」を満たさず、充足率100%未達のためFAIL。
その他の観点（ページネーション/抜粋・コメント数/相対時刻/シェア/リアクション/お知らせバー/PICKUP/回帰）は良好。

## 検証モード: Playwright（Web実機, `npm run build && npm run start -p 3100`）

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | FAIL | ダークモードの主要ページ背景・文字色が切り替わらない視覚的破綻（下記 問題1） |
| コンソールエラー0件 | PASS | 全操作を通じ console errors 0 件（トップ/記事/ページ2/admin） |
| 受け入れ基準充足率100% | FAIL | ダークモード観点が未充足（8観点中1つ破綻） |
| テストGreen（全テスト成功） | PASS | `npm test` → 33ファイル 228件 全PASS |

## 観点ごとの結果（E1）
- 1 ページネーション: PASS — 20件/ページ。`?page=2`で次頁遷移、前へ/次へ・「N / M ページ」表示。`?page=99`は最終ページにクランプ（test15表示・200）、`?page=0`/`?page=abc`も200で破綻なし。**保留記事（status=held）は一覧非表示・個別404**を確認（検証用に27公開+1保留を投入して確認、検証後 `db:seed` で原状復帰）。カテゴリ/検索のページURLも200。
- 2 抜粋＋コメント数: PASS — カードにタイトル下の本文抜粋と「💬 数」を表示。
- 3 相対時刻: PASS — 「5時間前」「1日前」等。絶対日時は`time`要素に保持。
- 4 SNSシェア: PASS — X/LINE/はてブが正しい共有URL（title/urlエンコード済み・`target=_blank rel=noopener`）。URLコピーは Clipboard API 権限granted・`writeText`成功を実機確認（"コピーしました"表示は2秒で自動復帰）。
- 5 絵文字リアクション: PASS — 👍を押下で 6→7 に加算、リロード後も7を保持、DB(`ArticleReaction`)にも `👍:7` で永続化を確認。
- 6 ダークモード: **FAIL**（問題1参照）。トグル動作・`.dark`付与・localStorage(`lol-matome:theme`)保存・再読込維持自体は動作するが、主要ページ本文領域が暗転しない。
- 7 お知らせバー: PASS — `SITE_NOTICE`設定時に最上部表示、×で閉じる→リロード後も非表示（`localStorage: lol-matome:notice-dismissed:<文言>`）。`/admin`には非表示。
- 8 注目記事PICKUP: PASS — トップ上部に「注目記事 PICKUP」＋カード列。
- 9 回帰: PASS — カテゴリ/タグ/検索/人気ランキング/関連記事/法務3ページ/`/admin`（お知らせ非表示・エラー0）が正常。デスクトップ(1905px)で横スクロールなし。

## 発見したバグ・問題点（FAILの原因）
### 問題1: ダークモードで主要ページの本文カラム背景・文字色が切り替わらない
- 再現手順:
  1. `SITE_NOTICE`を設定して起動し、任意の記事ページ（例 `/articles/patch-2614-jungle-nerf-hikkuri-kaeru`）を開く。
  2. ヘッダー右上「🌙 ダーク」をクリック。
- 期待結果: ページ全体（本文カラム背景・既定文字色含む）が暗色に切り替わる。
- 実際の結果: ヘッダー・サイドバー・広告枠・お知らせバー・カードは暗転するが、**本文（メイン）カラムの背景は明色 `rgb(243,244,246)=#f3f4f6` のまま／既定文字色も `#171717` のまま**。「半分だけダーク」の崩れ。トグルのラベルは「☀️ ライト」に変わり `.dark` は `<html>` に付与済み、localStorage保存・再読込維持も成立している（切替ロジック自体は正常）。
- 根拠:
  - `getComputedStyle(document.body).backgroundColor` はダーク時も `rgb(243,244,246)`。`body`から`bg-neutral-100`クラスを外しても変化せず → `dark:bg-neutral-950` が効いていない。
  - `body`の子に生成した `dark:bg-neutral-950` 付きdivは正しく暗色(`lab(2.75 0 0)`)になる＝ダークバリアント自体は機能。差は`body`要素固有。
  - 生成CSS: `body{background:var(--background);color:var(--foreground);…}` が**アンレイヤー（@layer外）**で出力されており、`@layer utilities` 内の `.dark\:bg-neutral-950:where(.dark,.dark *)` を**レイヤー優先順位で上書き**している（アンレイヤー > レイヤーは特定度に依らず優先）。
- 疑われる原因（特定済み）: `src/app/globals.css` L10-32。
  - `:root { --background:#f3f4f6; --foreground:#171717; }` に**ダーク時の上書きが無い**。
  - `body { background: var(--background); color: var(--foreground); }` が `<body>` の `dark:bg-neutral-950 dark:text-neutral-100` を常時打ち消す。
  - 想定される修正の方向性（実装はgeneratorが判断）: 例）`.dark { --background:#0a0a0a; --foreground:#ededed; }` 等でダーク値を定義して変数側で切替える／または `body` を Tailwind の `@layer base` に入れてユーティリティが勝つようにする、等。`<body>` の `dark:` ユーティリティと `globals.css` の `body{}` 直書きが二重管理で競合している点を解消する。

## 軽微な改善点（ブロッカーではない）
- シェアURLの生成ベースURLが `http://localhost:3000`（実行ポート3100と不一致）。正規サイトURL定数由来で本番では実ドメインになる想定のため機能上の問題ではないが、開発時の共有プレビューは実ポートを指さない。
- 法務3固定ページ（disclaimer/privacy/contact）は`dark:`未対応（自己申告どおり）。ダークモード時にライトのまま表示される。可読性自体は保たれる。

## 未検証項目（実機確認が必要）
- 375px（モバイル幅）での横スクロール有無・PICKUP横スクロール/シェアボタン折返しの見た目: 本MCP環境にビューポート変更ツールが無く、デスクトップ(1905px)幅でのみ横スクロール無しを確認。375pxは未検証。

## プレビュー画像
- 該当なし（FAIL）

## 関連ドキュメント
- [[ext-e1-selfeval]]（ジェネレーターの自己評価レポート）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
