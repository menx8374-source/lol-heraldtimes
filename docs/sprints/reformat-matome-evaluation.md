---
tags: [sprint-evaluation]
sprint: reformat-matome
result: PASS
---

# 記事フォーマット改修（まとめ速報レス形式） 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run build && npm run start`（本番ビルド・localhost:3000）で自分で起動し、実ブラウザで検証。Bash縮退なし。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 5観点すべて実機で期待どおり動作。致命的挙動なし |
| コンソールエラー0件 | PASS | 5ch記事/Riot記事/reddit生成記事/検索/admin/トップの各画面で `browser_console_messages`（error）= 0 |
| 受け入れ基準充足率100% | PASS | 下記5観点すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test`（vitest run）= 28 files / 180 tests passed |

## 検証観点ごとの結果
- **1. まとめ速報レス形式の表示**: PASS。
  - seed記事 `/articles/5ch-yasuo-otp-densetsu-no-play` と pipeline生成記事 `/articles/gen-...`（reddit由来）の2記事で確認。
  - `番号: 名前`（名前=緑, computed color `lab(47 -47 31)` = green-700）＋レス本文複数行（逐語）。
  - 重要行の赤強調（「壁飛び…草生える」computed `lab(48 77 61)`=red / font-weight 700）、`>>1` アンカーのオレンジ強調（`lab(57 64 89)` / 700）。5chは「国内プレイヤーさん」、redditは「海外プレイヤーさん」。
- **2. 構成分岐**: PASS。Riot公式 `/articles/patch-146-adc-item-build-change` はreactionブロックなしの従来型（見出し＋段落「アイテム調整の影響」「新しいビルドルート」）。注記も従来の「AIにより自動生成された記事」表示。
- **3. 安全フィルタ維持**: PASS。`npm run pipeline` 実行で `status=held(理由:personal_attack)`（slug `gen-cmrzqp5yi0007vc34uvtyygsp`, category 5chの反応）。DB直接確認で held / heldReason=personal_attack。該当URLは HTTP 404、sitemap.xml に非掲載（grep 0件）。他5件は published。
- **4. 法務表示の維持**: PASS。reaction記事に出典（[5ch]/[Reddit] リンク）＋「掲示板・SNSの反応を引用・転載してまとめた…」注記、フッターにRiot非公認ディスクレーマー。
- **5. 回帰なし**: PASS。トップ/カテゴリ(5ch,overseas,patch-meta)/タグ(ヤスオ)/検索(ヤスオ→3件)/人気ランキング/関連記事/admin/法務3ページ/sitemap/robots すべて HTTP 200・表示正常。デスクトップ幅で横スクロールなし（scrollWidth==clientWidth）。admin に保留キュー・公開16件・失敗ログ表示。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- pipeline生成記事のタイトルに、本文レス冒頭の「1: 」プレフィックスがそのまま混入する（例: 「【議論】ヤスオ、1: このヤスオのコ…を巡り議論に」、関連記事カードも「【悲報】ヤスオ、1: 壁飛び5連続でキ…」）。表示上の見栄えの問題で、タイトル生成のソース素材抽出が reaction 本文の行頭「N: 」を除去していないのが原因と思われる。改修要件（レス形式表示）自体には影響しないため非ブロッカー。seed記事の手書きタイトルには発生しない。

## 未検証項目（実機確認が必要）
- モバイル実機幅での横スクロール有無は、Playwright MCPのビューポート固定のためデスクトップ幅でのみ確認（overflowなし）。レスカードは `flex-col`＋`text-sm sm:text-base` のレスポンシブ実装で、レス本文は通常の日本語文のため破綻リスクは低いが、極端に長い連続英数字レスでの折返しは未確認。
- 収集ソース（5ch/Reddit/Riot）およびLLMは方針どおりモック（fixture／決定論）。本接続は認証情報待ちのため未検証。

## プレビュー画像（PASS）
- `reformat-matome-preview-1.png`（seed 5ch記事・まとめ速報レス形式：緑名/赤・オレンジ強調/>>1アンカー）
- `reformat-matome-preview-2.png`（pipeline生成 reddit記事・海外プレイヤーさんレス形式）

## 関連ドキュメント
- [[reformat-matome-selfeval]]（ジェネレーターの自己評価レポート）
- [[project-memory]]（記事フォーマットの方針変更セクション）
