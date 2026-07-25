---
tags: [sprint-evaluation]
sprint: E11
result: PASS
---

# Sprint E11 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- MCPブラウザ（viewport約929px）で表示・追従・シェアURL・ダークモードを検証。
- MCPにviewport変更ツールが無いため、375px幅（モバイルフォールバック）はプロジェクトローカルの `playwright`(1.62.0) で直接スクリプト起動して検証（無料・ローカル依存、追加インストールなし）。
- 広告設定時の表示は `AD_SLOT_ARTICLE_TOP` を起動プロセスの環境変数にのみ一時設定して検証（ファイル未書換え・コミット非対象）。検証後にサーバー停止で解除、DBは `npm run db:seed` で復元済み。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 主要フロー（記事表示/スクロール追従/シェアリンク/広告分岐/ダーク/モバイル）で機能不全なし |
| コンソールエラー0件 | PASS | 記事ページ・375px・ホームで console errors 0（page error も 0） |
| 受け入れ基準充足率100% | PASS | 下記7項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test`(Vitest) → 59 files / 513 tests passed |

## 受け入れ基準ごとの結果
- スクロール追従: PASS。PC(1920px)で `lg:sticky lg:top-24` のシェアバーが、1422pxスクロール後も `top=96px`(=top-24)で固定表示。
- X最優先・本物SVGアイコン: PASS。PC/モバイル両navとも先頭がX、4件（X/LINE/はてブ/Facebook）すべて `<svg>` 実体を保持（`hasSvg:true`）。
- シェアリンク: PASS。各hrefが正しい共有URL（X=twitter.com/intent/tweet、LINE=social-plugins.line.me、はてブ=b.hatena.ne.jp、Facebook=facebook.com/sharer）で、全リンク `target="_blank"` `rel="noopener noreferrer"`。
- モバイルフォールバック（375px）: PASS。PC nav非表示、モバイルnavが `sticky top-0` 全幅(375px/高さ49px)で表示。本文（h1）はバー下にフロー配置され重ならず、4アイコンすべて `elementFromPoint` でヒット＝操作可能。サイトヘッダー/お知らせバーは非sticky、Cookie同意バナー/アンカー広告は画面下部(z-40)で別領域のため重なりなし。
- 広告未設定時の非表示: PASS。env未設定の記事ページ・ホームで `[data-ad-slot]`=0、「広告 / PR」ラベル=0、「広告枠（未設定）」プレースホルダー=無し。
- 広告設定時の表示: PASS。`AD_SLOT_ARTICLE_TOP` 設定で `data-ad-slot="article-top"`＋「広告 / PR」ラベル＋広告コードが描画。
- ダークモード視認性: PASS。ダーク時にX badgeが `bg rgb(255,255,255)/logo rgb(0,0,0)`（白地に黒ロゴ＝反転）で視認可、LINE/はてブ/Facebookもブランド色でコントラスト良好。

## 回帰・維持
- E9横広一覧: ホームで記事リンク27件レンダリング、正常。
- 記事下ShareButtons: 本物アイコン共通化＋Facebook追加で表示（PCスクショで確認）。
- コンソールエラー0件（初回通常フロー）。E1由来のFOUC/hydration warningは新規発生なし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- はてなブックマークのアイコンはSVG内 `<text>` の「B」で表現（公式ロゴの厳密な意匠ではないがブランド色の角丸ボックスで識別可能）。自己評価どおり自前実装で、実運用上の問題はなし。

## 未検証項目（実機確認が必要）
- 実クリックによる新規タブ遷移そのものは外部SNSサイト側の挙動のため未遷移確認（href属性・target/relで確認）。ネイティブ専用機能ではなくブロッカーではない。

## プレビュー画像
- `ext-e11-preview-pc.png`（PC: 本文左に縦シェアバー）
- `ext-e11-preview-mobile.png`（375px: 上部stickyシェアバー）

## 関連ドキュメント
- [[ext-e11-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e11-brief]]（本スプリントの仕様抜粋）
