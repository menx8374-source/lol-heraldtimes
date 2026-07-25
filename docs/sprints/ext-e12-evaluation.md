---
tags: [sprint-evaluation]
sprint: E12
result: PASS
---

# Sprint E12 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・localhost:3000 / next dev）
- Bash縮退・未検証のネイティブ機能なし。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全受け入れ操作が期待どおり動作 |
| コンソール・実行エラー0件 | PASS | 初回訪問の通常フロー（記事ページ・localStorageクリア後のトップ）で0 errors/0 warnings。詳細は下記注記 |
| 受け入れ基準充足率100% | PASS | F-E12-1/F-E12-2 の受け入れ基準7項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test` → 59 files / 520 tests 全passed |

## 受け入れ基準ごとの検証結果
- **まとめレスの1枠統合（F-E12-1）**: PASS。`/articles/5ch-yasuo-otp-densetsu-no-play` で reaction 1〜11 が単一コンテナ（`divide-y rounded border border-neutral-300 bg-white`, border-top 1px / radius 4px / 白背景）に連続表示。各レス（`px-3 py-2`）は自前のborder・radiusを持たず、薄い区切り線（divide-y）で仕切られている。reaction-group コンテナ数=1・内包レス数=11 をDOM計測で確認。従来の独立角丸ボックスではない。
- **レス中身の維持**: PASS。「番号: 名前（緑 text-green-700/dark:green-400）」・本文・赤強調（text-red-600）・`>>N`アンカー（橙 text-orange-600）を実DOM/スクショで確認。
- **非連続reaction別枠・広告**: PASS。当該記事は embed ブロック（配信クリップ）が reaction 群の前に single ブロックとして分離表示され、reaction 群は1枠に集約。非連続グルーピング挙動は `groupArticleBodyBlocksForDisplay` の単体テスト（連続1グループ化／非連続別グループ化）でGreen。広告差し込み位置判定（見出し元index基準）は変更なし。
- **コメントUIの差別化（F-E12-2）**: PASS。コメントカードは `rounded-lg border-l-4 border-sky-400 bg-sky-50`（radius 8px / 左4px青アクセント帯 / 淡い青背景）。ヘッダーは丸青アバターバッジ（名前先頭1文字）＋青ハンドル名＋相対時刻。まとめ本文の白背景＋「番号:名前緑」レスと配色・レイアウトの両面で一目で区別可能（ライト/ダーク双方で確認）。
- **コメント機能の維持**: PASS。返信ボタンでフォーム展開→投稿で親コメント直下にネスト表示。👍ボタンで count 0→1 に増加。標準line `>>1` が橙表示。XSS: `>>1 <script>alert('xss')</script> テスト返信` を投稿すると文字列としてエスケープ表示され、alert実行・DOM注入なし。
- **回帰・ダーク/レスポンシブ**: PASS。ダークモード切替でレス群・コメント欄とも配色維持・崩れなし。トップ（E9新着まとめ一覧＋注目記事）正常描画。

## コンソールエラーに関する注記（FAIL根拠にせず）
- クリーンな初回訪問（記事ページ初回・localStorageクリア後のトップ）は 0 errors。
- セッション途中（ダークモード手動切替・複数ページ遷移後）に観測した以下は新規バグではなく除外対象:
  - `html className "dark"` の hydration mismatch → 手動ダーク切替で発火する layout.tsx FOUC防止スクリプト起因のE1既知事象（ブリーフで除外指定）。
  - HMR WebSocket 失敗・別ポート(3421)へのRSCプリフェッチ失敗 → dev/前セッション由来のスタール成果物。localStorageクリア後の再訪で消失し再現せず。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- ブリーフどおりコメントに通し番号（番号:）を非表示化した結果、コメント本文中の `>>N` はアンカー表示されるが、参照先コメントを画面上の番号で辿る手掛かりが弱くなった（機能影響なし・意図的変更）。将来アンカークリックでスクロール等の導線があると親切。

## 未検証項目（実機確認が必要）
- 該当なし（Web対象・全項目ブラウザ実機で検証済み）。

## プレビュー画像
- `ext-e12-preview-1-reactions-light.png`（まとめレス1枠統合・ライト）
- `ext-e12-preview-2-comments-light.png`（差別化コメント欄・ライト）
- `ext-e12-preview-3-reactions-dark.png`（まとめレス1枠統合・ダーク）
- `ext-e12-preview-4-comments-dark.png`（差別化コメント欄・ダーク）

## 関連ドキュメント
- [[ext-e12-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e12-brief]]（本スプリントの仕様抜粋）
