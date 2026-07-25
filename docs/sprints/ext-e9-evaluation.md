---
tags: [sprint-evaluation]
sprint: E9
result: PASS
---

# Sprint E9 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run db:seed` → `npm run dev`（localhost:3000）で自分で起動して検証。検証後にサーバー停止・DB再シード済み。
- 未検証項目なし（下記「未検証項目」参照）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全一覧ページ・記事詳細を実操作、レイアウト破綻・機能不全なし |
| コンソール・実行エラー0件 | PASS | 通常フロー（初回訪問・各一覧・詳細・ダークモード切替）で0件。※後述の注記あり |
| 受け入れ基準充足率100% | PASS | 下記7項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test`（vitest run）→ 55 files / 478 tests passed |

## 受け入れ基準ごとの検証結果
- [x] トップの一覧でまとめ速報型記事に「1レス目の本文」抜粋: PASS
  - 5ch-yasuo カード抜粋「壁を5回飛び越えてキャリーだけ倒すとか意味わからん、マジで神プレイすぎるだろこれ。」= seed `reaction number:1` 本文と完全一致。
  - overseas-tier-list 抜粋「先週まで誰も使ってなかったチャンプが急にSランク入りしてて驚愕。」= seed `reaction number:1` と一致（5ch/海外の両reaction型で機能）。
- [x] reactionブロック無し記事は本文冒頭抜粋（空欄にならない）: PASS
  - patch-2614「本日配信されたパッチ14.6では…」、official-new-champion「Riot Games公式が新チャンピオンを…」等、段落フォールバックが表示。空欄カードなし。
- [x] カテゴリ・タグ・検索・アーカイブでも同じ抜粋が一貫: PASS
  - `/category/5ch`・`/tags/神プレイ`・`/search?q=パッチ`・`/archive/2026-07` すべてで同一の1レス目/段落抜粋を確認（共通の `buildArticleExcerpt` 経由）。
- [x] 以前より横幅を広い読みやすいレイアウト: PASS
  - `page-with-sidebar.tsx` を `max-w-5xl`→`max-w-7xl`。左サムネ＋右にタイトル＋プレビュー＋メタの横長カード。preview-1参照。
- [x] PC・モバイル双方で破綻しない（レスポンシブ・ダークモード維持）: PASS
  - PC実機で崩れなし。ダークモード切替後もレイアウト・可読性維持（preview-2）。モバイルはレスポンシブクラスで担保（後述）。
- [x] ピン留め記事の📌注目バッジ・先頭表示維持: PASS
  - `article-card.tsx` のバッジ描画 `{article.pinned && …}` 無変更、`orderBy: [{ pinned: "desc" }, …]` 維持。seedにpinned記事が無いためコードで確認（ブリーフ許容）。
- [x] `npm test` 全Green: PASS（478 passed）。

## その他の回帰確認
- 公開限定維持: `PUBLISHED_ONLY` 絞り込みが category/tag/popular/sitemap クエリで無変更。E9はorderByのみで露出条件を変えていない。
- ダークモード: トグルで正常切替、0コンソールエラー。

## 発見したバグ・問題点
- FAILの原因となる致命的バグ・E9起因のエラーは無し。

## 軽微な改善点（ブロッカーではない）
- 【可読性・要検討】コンテナ幅拡張により記事詳細の本文カラムが約936px（従来 約680px）になり、段落主体（Riot公式形式）記事の1行が約55〜58全角文字とやや長め。破綻・顕著な読みにくさではないため致命ではないが、本文カラムに `max-w-prose` 相当の上限を設ける等で更に読みやすくできる（一覧は横広のまま、詳細本文だけ制限する余地）。
- 【pre-existing・E9対象外】ダークテーマが有効な状態（localStorageに`dark`保存済み or `prefers-color-scheme: dark`）でページを開くと、`layout.tsx` のFOUC防止スクリプトが `<html>` に `dark` を付与する一方、同要素に `suppressHydrationWarning` が無いためReactのhydration mismatch ERRORがコンソールに出る。
  - E9は `layout.tsx`・テーマ機構を一切変更しておらず、E1（ダークモード導入）以来の潜在issue。初回訪問（テーマ未保存・ライト既定）では0件で、今回検出できたのは永続Playwrightプロファイルに前セッションの`dark`が残っていたため。通常フロー（初回訪問）ではコンソール0件のためE9のブロッカーとはしない。
  - 恒久対策の提案: `src/app/layout.tsx` の `<html lang="ja" …>` に `suppressHydrationWarning` を付与（E9スコープ外のため別途対応推奨）。

## 未検証項目（実機確認が必要）
- モバイル幅のピクセル単位スクショ: 使用中のPlaywright MCPにビューポート即時リサイズ用ツールが無いため、モバイル実表示のスクショは未取得。代わりにレスポンシブCSSをコードで確認（`article-card`: `flex gap-3` + `min-w-0 flex-1` + サムネ `h-16 w-16`→`sm:h-24 sm:w-40 md:h-28 md:w-48`、`line-clamp-2`／`page-with-sidebar`: モバイル `flex-col`、`lg:flex-row` でサイドバー下段積み）。固定幅で溢れる要素は無く破綻リスクは低い。

## プレビュー画像
- `ext-e9-preview-1.png`（PC・ライト、横広一覧＋1レス目プレビュー＋サイドバー併存）
- `ext-e9-preview-2.png`（PC・ダークモード、同上）

## 関連ドキュメント
- [[ext-e9-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e9-brief]]（本スプリントの仕様抜粋）
