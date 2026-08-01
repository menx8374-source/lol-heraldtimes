---
tags: [sprint-evaluation]
sprint: reactqual-S2
result: PASS
---

# Sprint reactqual-S2 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run dev`（http://localhost:3000）を起動し、URL入りレス/コメントを持つ検証用記事をDBにseedして3デザイン（標準/ニュース記事風/Hextech dark・light）で実機確認。検証後にseed記事・コメント削除、一時スクリプト削除、devサーバー停止済み（記事数は検証前後とも14件）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | レス本文/コメント本文のURLが `<a href target="_blank" rel="noopener noreferrer nofollow">` として描画（SSR HTMLにも出力あり）。`javascript:`/`data:` はテキストのまま（`a[href^=javascript]` 0件）。非URL部分は逐語一致。横スクロールなし（scrollWidth=clientWidth=914、3デザイン共通）。 |
| コンソールエラー0件 | PASS | 検証用記事ページ（reaction複数＋YouTube埋め込み＋quote＋コメント2件）で errors 0。既存記事で観測された 2件（`k.twitchcdn.net` 429 / bluetooth permissions policy）と1件（`cdn.syndication.twimg.com` 404）は、いずれも**サードパーティ埋め込みiframe内部**（Twitchクリップ／Twitter埋め込み。モック記事の存在しないサンプルID・レート制限）由来で本スプリント変更とは無関係・既存事象。 |
| 受け入れ基準充足率100% | PASS | 基準1〜3すべて充足（下記詳細）。 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 130 files / **1824 tests passed**（失敗0）。 |

### 受け入れ基準の詳細
1. **ビルド系**: `npx vitest run` 全Green（1824）／`npx tsc --noEmit` 0エラー／`npm run build` 成功（全ルート生成）／`npm run lint` **0 errors**（warning 7件はすべて既存・本スプリント外のファイル）。
2. **リンク化・安全性**:
   - 実機DOM: `https://twitter.com/i/status/1234567890` / `https://x.com/someuser/status/999` / `https://www.youtube.com/watch?v=dQw4w9WgXcQ`（強調赤レス内）／コメント欄 `https://example.com/comment-link` の4件すべてが `rel="noopener noreferrer nofollow" target="_blank" class="underline text-sky-700 dark:text-sky-400 break-all"` で描画。
   - 末尾句読点strip実機確認: `こっちも→https://x.com/someuser/status/999。続きの文章` の href は `.../999`（`。` を含まず後続テキスト）。
   - 危険スキーム: `javascript:alert(1) を試すやつがいた` はプレーンテキスト（アンカー生成0）。
   - 逐語不変: 実機の各 `<p>` textContent がseed原文と完全一致。加えて **`linkifyText` を20万ケースでファズ検証**（URL/句読点/括弧/`javascript:`/`data:` 断片のランダム連結）し、`segments.map(v).join("")===text` の不一致 **0件**、`href` が `https?://` 以外・`href!==value` のケース **0件**。
   - `dangerouslySetInnerHTML` 不使用: `article-body-view.tsx` 内は注記コメントのみで属性使用なし（`dangerouslySetInnerHTML=` は不在。テストでもソース検査済み）。実装は `linkifyText` セグメント配列を JSX（`<a>` / `<Fragment>`）で組むのみ。
   - 共用経路: 記事本文reactionブロック（5ch/reddit/X）とコメント欄（`comment-section.tsx` が `ResLines` をimport）の双方で実機リンク化を確認。
3. **不変性**: heading/quote/embed は従来どおり（quote内のURLはリンク化されずプレーンのまま＝仕様どおり）。YouTube埋め込みiframe（`youtube-nocookie.com/embed/...` `loading=lazy` `referrerpolicy=strict-origin-when-cross-origin`）、既存X反応記事のTwitter埋め込み（`platform.twitter.com/embed/Tweet.html?id=...`）、5ch記事のTwitchクリップ埋め込みはいずれも不変。URLを含まない既存レス（5ch記事の全レス・アンカー行 `>>1`）も従来表示のまま回帰なし。`git diff --stat` は `article-body-view.tsx`＋テストのみ（新規 `src/lib/linkify.ts`・テスト）で、`prisma/schema.prisma`・`package.json` は無変更。
   - 3デザインでのリンク視認性: 標準=sky系下線、ニュース記事風=赤系下線（design-newsのリンク色オーバーライド）、Hextech=teal/sky系下線。いずれも下線付きで判別可能・レイアウト崩れなし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（PASSでもFAILでも、ブロッカーではないもの）
- ニュース記事風デザインでは、強調色=redのレス内リンクが本文の赤とほぼ同系色になり、下線でしか区別できない（可読性の観点で将来の微調整候補。破綻はしていない）。
- リンクのアクセシブルネームがURL文字列そのもの（長いURLはスクリーンリーダーで読み上げが冗長）。逐語表示方針とのトレードオフのため現状維持で問題ないが、将来 `aria-label` 付与の余地あり。
- `stripTrailingPunctuation` は半角 `[.,!?;:]` のみを対象（全角句読点は正規表現の除外文字クラス側で担保）。二系統に分かれているため、将来の記号追加時は両方の更新が必要。

## 未検証項目（実機確認が必要）
- 該当なし（Web実機ですべて確認済み）。なお外部埋め込み（Twitch/Twitter）の実コンテンツ表示はモック用サンプルIDのため404/429となるが、本スプリントの対象外かつ既存事象。

## プレビュー画像（PASSかつ画面を持つプロダクトの場合のみ）
- `docs/sprints/reactqual-s2-preview-1.png`（標準デザイン: レス本文中URLのリンク化）
- `docs/sprints/reactqual-s2-preview-2.png`（ニュース記事風）
- `docs/sprints/reactqual-s2-preview-3.png`（Hextech / dark）

## 関連ドキュメント
- [[reactqual-s2-selfeval]]（ジェネレーターの自己評価レポート）
- [[reactqual-s2-brief]]（本スプリントの仕様抜粋）
