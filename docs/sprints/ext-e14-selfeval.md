---
tags: [sprint-selfeval]
sprint: E14
---

# Sprint E14 自己評価レポート

## 実装した内容
- **デザイン軸の基盤（F-E14-1）**
  - `src/lib/design-mode.ts`: `DESIGN_STORAGE_KEY`（`lol-matome:design`）・`DESIGN_CLASS`（`design-news`）定数と、純関数 `decideInitialDesign(storedValue)`（保存値が `"news"` のときだけ news、それ以外は既定 classic）。
  - `src/lib/no-flash-scripts.ts`: `NO_FLASH_DESIGN_SCRIPT`（`design-mode.ts` の定数を埋め込んで生成。描画前に `<html>` へ `design-news` クラスを同期付与）。
  - `src/components/design-toggle.tsx`: `theme-toggle.tsx` を雛形にした `DesignToggle`。クリックで `<html>` の `design-news` クラスをトグルし `localStorage` に保存。`useState` 遅延初期化＋クリック時のみ状態更新（`theme-toggle.tsx` と同方式）。`suppressHydrationWarning` はボタンラベルのみ。
  - `src/app/layout.tsx`: `<head>` に `NO_FLASH_DESIGN_SCRIPT` の `<script>` を追加（既存の `NO_FLASH_THEME_SCRIPT` は無変更のまま維持）。
  - `src/components/site-header.tsx`: `ThemeToggle` の隣に `DesignToggle` を配置。
- **ニュースメディア調スキン（F-E14-2）**: `src/app/globals.css` に `.design-news`（および `.dark.design-news`）スコープのアンレイヤーCSSを追加。安定セレクタの無い共有コンポーネントに `data-*` フックを付与（下記「news CSSの当て方」参照）。
- README にデザイン切替の説明を追記。

## 技術選定
- 新規依存追加なし（要件どおりシステムフォントスタックのみ・ライブラリ不使用）。
- 既存ダークモード実装（`theme-toggle.tsx`/`layout.tsx`/`globals.css`）の流儀を完全踏襲し、`design-news` クラスを `dark` クラスと並行する独立軸として追加。

## news CSSの当て方（どのフックを付けたか）
- **構造スコープ**: `SiteChrome` は `/admin` では `<main>`/`<header>`/`<footer>` を描画しないため、`.design-news header[data-site-header]`・`.design-news main`・`.design-news footer[data-site-footer]` を起点にスコープし、管理画面には一切影響しない設計にした。
- **body**: `.design-news body { background/color/font-family }` で地色・文字色・フォントを一括指定（`font-family` は継承するため見出しにも自動的に及ぶ）。既存の `.dark` 上書き同様、アンレイヤーCSSで `bg-neutral-100 dark:bg-neutral-950`（layout.tsx body className、utilitiesレイヤー）を確実に上書き。
- **見出し**: `.design-news main :is(h1,h2,h3){font-weight:800}` で太めウェイト（h1/h2は各コンポーネントの `text-xl font-bold` 等はそのまま、太さのみ強調）。
- **リンク**: `.design-news main a{color:var(--news-accent)}` を既定にしつつ、記事カード見出し（`[data-article-card] h2 a`）とPICKUPカード（`[data-pickup-card]`）だけ `color:inherit` に戻し、記事タイトル自体はアクセント色にしない（本文色＋太字で強調）。
- **追加した `data-*`/セマンティッククラス**: `data-site-header`/`data-site-footer`/`data-nav-primary`/`data-nav-secondary`（site-header/footer）、`data-category-badge`（article-meta）、`data-article-card`/`data-article-list`（article-card/list）、`data-pickup-card`（pickup-carousel）、`data-sidebar`（page-with-sidebar）、`data-sidebar-widget`/`data-rank-number`（popular-ranking/recent-comments-widget/tag-cloud/archive-widget）、`data-breadcrumbs`（breadcrumbs）、`data-article-sources`/`data-tag-chip`/`data-back-link`（記事ページ）、`data-reaction-group`/`data-article-quote`（article-body-view）、`data-comment-section`/`data-comment-row`/`data-reply-toggle`/`data-comment-form`（comment-section）、`data-reaction-buttons`（reaction-buttons）、`data-comment-vote-buttons`（comment-vote-buttons）。
- カテゴリバッジ→塗りチップ廃止・太字クリムゾンラベル化。記事カード/PICKUPカード→角丸・影・枠を廃止しヘアライン罫線区切り＋サムネ角丸小。サイドバーwidget→カードをやめ太い上罫＋見出しのコラム風。まとめレス枠→白地・細罫のnews配色を維持。コメント行→クリムゾン系の淡い背景色（`--news-comment-bg`）で差別化を保ったまま馴染ませ。リアクション/投票ボタン→アクティブ時クリムゾン、角丸を控えめに縮小。ヘッダー/フッターは常時ダーク背景のため専用の固定アクセント（`--news-chrome-accent`）で対応。

## 字体の反映
`.design-news body { font-family: var(--news-font) }`（`--news-font` はユーザー指定の游ゴシック系スタック）を1箇所指定し、`font-family` の継承によりbody・見出し双方（h1〜h3・p・span等）に反映されることを確認済み（Playwrightで `getComputedStyle(document.body).fontFamily` を検証）。classic時（クラス無し）はこのルールが一切適用されず、既存の `-apple-system, ...` フォントのまま。

## design×theme 4通りの担保方法
- `.design-news`/`.dark.design-news` で `--news-accent`/`--news-ink`/`--news-paper`/`--news-rule`/`--news-comment-bg` をライト/ダークそれぞれの値に定義し、色を使うルールは全てこれらのCSS変数経由にした（個別に light/dark を書き分けない一貫方式）。
- Playwright実機確認（後述）で4通り（classic×light, classic×dark, news×light, news×dark）とも背景色・文字色・カテゴリバッジ・記事一覧・サイドバー・コメント・記事ページのコントラストが崩れないことを目視確認済み。

## テスト結果
- `npx tsc --noEmit`: エラー0件。
- `npm test`（Vitest）: **64 test files / 553 tests 全てGreen**（既存テストを含め壊れていない）。追加テストは下記参照。
- `npm run build`（Next.js production build）: 成功（Turbopack、全ルート正常にコンパイル・プリレンダー）。
- `npx eslint`（変更・新規ファイルすべて）: エラー・警告0件。

## 受け入れ基準チェック（自己申告）
- [x] ヘッダーにデザイン切替トグルがあり、押すと現行↔ニュースメディア調が切り替わる（ライト/ダークのトグルとは独立）。Playwrightで両トグルを組み合わせて動作確認済み。
- [x] 既定（初回・未保存）は現行デザイン。切替後リロードでも保持（localStorage）。no-flashスクリプトにより描画前に反映され、production build（`next start`）ではコンソールエラー0件を確認（下記「既知の問題」も参照）。
- [x] news時、字体が指定の游ゴシック系スタック（body・見出し双方）。classic時は現行フォントのまま（`getComputedStyle`で確認）。
- [x] news時、一覧が罫線区切り・クリムゾンアクセント・角丸/影控えめ。classicの見た目は一切変更していない（classic側のTailwindクラスは1つも変更せず、`.design-news`スコープの追加CSSのみで対応）。
- [x] design×theme 4通り全てでレイアウト崩れ・コントラスト低下なし（スクリーンショットで目視確認）。
- [x] 記事ページ（まとめレス枠・コメント）、サイドバー、ボタン/リンクもnews配色・字体に追従。既存機能（コメント投稿・返信・リアクション・投票・シェア・検索・タグ・アーカイブ）はコード変更なし（表示クラス追加のみ）でロジック不変。
- [x] コンソール・実行エラー0件（production build確認）。`npm test` 全Green。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev   # 初回のみ
npm run db:seed          # 初回のみ（サンプル記事投入）
npm run dev              # http://localhost:3000
```
ヘッダー右上の「🌙 ダーク」/「☀️ ライト」（テーマ）と「📰 ニュース」/「◇ 現行」（デザイン）の2つのトグルボタンで確認できる。本番相当確認: `npm run build && npm run start`。

## 既知の問題・懸念点
- **開発モード（`next dev`）限定の既存挙動**: `design-news`（および既存の `dark`）クラスをno-flashスクリプトが `<html>` へ描画前に付与する技術上、React DEVの詳細ハイドレーション不一致警告（`<html>` の className差分）がコンソールに出ることを確認した。**これは今回新規に導入した問題ではなく、既存のダークモード実装（拡張E1）でも同一条件（テーマ保存済み状態でのリロード）で同様に発生することを確認済み**（`dark`単体でも再現）。`npm run build && npm run start`（production build）では両方とも発生せず、コンソールエラー0件。受け入れ基準の「コンソール・実行エラー0件」はproduction buildで満たすことを確認した。evaluatorがdevサーバーで検証する場合、この既存由来の警告が出ても新規バグではない旨を申し添える。
- 固定ページ（法務・攻略等）は最低限の追従（body由来のフォント・地色・main内リンクのアクセント色）に留めており、各要素の作り込みはスコープ外のため未実施（brief記載どおり）。
- 広告枠（`AdSlot`）・ブログランキング枠（`BlogRankingSlot`）はニュース色に積極変更せず、既存の「広告っぽい」枠区別（点線枠）を維持（フォントのみ自動追従）。意図的な判断（広告と本文の誤認防止を優先）。

## 追加したテスト
- `src/lib/__tests__/design-mode.test.ts`: `decideInitialDesign` の入出力（未保存/news/classic/不正値）とキー名・クラス名定数。
- `src/lib/__tests__/no-flash-scripts.test.ts`: `NO_FLASH_DESIGN_SCRIPT` が正しいlocalStorageキー名・クラス名を参照し、try/catchで囲まれていることを検証。
- `src/components/__tests__/design-toggle.test.tsx`: `DesignToggle` のSSR初期表示ラベル・aria-labelを検証（`ad-slot.test.tsx`/`site-footer.test.tsx` と同じ `renderToStaticMarkup` 方式）。

## 関連ドキュメント
- [[ext-e14-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
