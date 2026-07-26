---
tags: [sprint-evaluation]
sprint: ext-e21
result: PASS
---

# Sprint 拡張E21 評価レポート（ヘッダーにマスコット題字ロゴ＋モバイル横溢れ修正）再検証

## 総合判定: PASS

前回FAILの原因だったモバイル幅でのヘッダー右側コントロール列の横溢れが、`site-header.tsx` のコントロール包括div変更（`flex w-full flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap sm:justify-end`）で解消。回帰なし。

## 検証モード
Playwright（Web実機）: MCPにビューポート変更ツールがないため、Bash駆動 playwright-core（MCP同梱chromium-1234）で実375/320/1280px実測＋スクショ。本番ビルド(`npm start`)を起動して検証、検証後停止。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| モバイル375px 横溢れ解消 | PASS | `scrollWidth=clientWidth=375`（横スクロールなし）。search width=260px(操作可)、theme right=176・design right=224 いずれも viewport 375内。 |
| モバイル320px 横溢れなし | PASS | `scrollWidth=clientWidth=320`。search width=228px、theme right=176・design right=224 いずれも 320内。 |
| デスクトップ回帰なし(1280px) | PASS | search/theme/design 全て top=31 の同一行・右寄せ(design right=1264≤1280)、横溢れなし。マスコット表示(complete, naturalWidth=512, 84px)。ロゴ`a[href="/"]`クリックで `/tier`→`/` 遷移確認。 |
| マスコット画像表示 | PASS | `/mascot-header.webp` 200、img complete/naturalWidth=512、全幅で表示。 |
| コンソールエラー0件 | PASS | 375/320/1280px・ページ遷移いずれも console error 0・pageerror 0。 |
| テスト Green | PASS | `npx vitest run` → 70 files / 647 tests 全pass。 |
| build | PASS | `npm run build` → exit 0（全ルート生成成功）。 |

## 実測サマリ（375px）
- scrollWidth 375 = clientWidth 375（前回: 472で97px溢れ → 解消）
- search: left16/right276/width260（前回: width約18で潰れ → 解消）
- theme: right176 / design: right224（前回: design right472で画面外 → 画面内に収束）
- コントロール列は全幅の別行に落ち内部で縦積み折り返し、全要素が画面内。

## 発見したバグ・問題点
- なし。

## 軽微な改善点（ブロッカーではない）
- lint warning: `site-header.tsx` の `<img>` は `next/image` 推奨警告（意図的採用、装飾のため `alt=""` 妥当）。前回同様、機能影響なし。

## 未検証項目（実機確認が必要）
- 該当なし（Webレンダリングで全項目検証可能）。

## プレビュー画像
- `docs/sprints/sprint-ext-e21-preview-mobile.png`（375px、横溢れ解消・検索/トグルが画面内に収まる）
- `docs/sprints/sprint-ext-e21-preview-desktop.png`（1280px、1行右寄せ・マスコット表示）

## 関連ドキュメント
- [[sprint-ext-e21-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-ext-e21-brief]]（本スプリントの仕様抜粋）
