---
tags: [sprint-selfeval]
sprint: E1
---

# Sprint E1（回遊・エンゲージメントUI）自己評価レポート

## 再実装（試行2）: ダークモード「半分だけダーク」不具合の修正
- **FAIL理由**: `globals.css`の`body { background: var(--background); color: var(--foreground) }`が**アンレイヤー（レイヤー外）**で出力されており、CSS Cascade Layers仕様上アンレイヤーCSSはレイヤー付きCSS（Tailwindの`utilities`レイヤー含む）より常に優先されるため、`<body>`に付けた`dark:bg-neutral-950`/`dark:text-neutral-100`ユーティリティが常に上書きされ、ダークモード時に本文カラムが明色`#f3f4f6`のまま残っていた。
- **修正1（本質的な原因）**: `body`の背景/文字色宣言を`@layer base { body { ... } }`に移動。ビルド後CSSで`@layer properties, theme, base, components, utilities;`の順でレイヤー宣言され、`utilities`が最後（最優先）になるため、`<body>`の`dark:bg-neutral-950`等のTailwindユーティリティが確実に効くようになった（ビルド後CSSを`grep`し、`bg-neutral-950:where(.dark,.dark *){...}`ルールが存在し、レイヤー順でbase内の`body{...}`ルールより優先されることを確認）。
- **修正2（保険・将来対応）**: `--background`/`--foreground`のCSS変数に`.dark { --background: #0a0a0a; --foreground: #f5f5f5; }`のダーク時上書きを追加。今後これらの変数を参照する箇所が増えても自動的にダーク対応する。
- **修正3（法務3ページの最小dark対応）**: 前回未対応だった`disclaimer`/`privacy`/`contact`の3ページに`dark:`バリアントを追加。
  - 見出し(h1/h2、色指定なし)は body の文字色を継承するため、修正1により自動的にダークで読める文字色になる（追加変更不要）。
  - 本文段落の明示的な`text-neutral-700`は継承されないため、個別に`dark:text-neutral-300`を追加（6+5+3=全14箇所）。
  - `contact`ページの連絡先ボックス（`bg-neutral-50 border-neutral-300`）に`dark:bg-neutral-900 dark:border-neutral-700`、見出し`text-neutral-600`に`dark:text-neutral-400`、下部注記`text-neutral-500`に`dark:text-neutral-400`を追加。
  - 各ページのリンク`text-sky-700`に、既存コンポーネント（記事本文の出典リンク等）と同じ`dark:text-sky-400`パターンを追加し一貫性を保った。
- **ライトモードへの影響**: 上記はすべて既存クラスへの`dark:`追加、または`@layer`への移動（レイヤー内でもセレクタ自体・詳細度は変わらないためライト時の描画結果は不変）であり、ライトモードの見た目は変更していない。
- **確認方法**: `npm run db:seed` → `npm run build && npm run start`でサーバー起動後、ビルド生成物のCSS（`_next/static/chunks/*.css`）を`curl`で取得し (a) `@layer`宣言の順序が`base`→`utilities`であること (b) `.dark{--background:#0a0a0a;--foreground:#f5f5f5}`ルールの存在 (c) `bg-neutral-950:where(.dark,.dark *){...}`ルールの存在、をテキストレベルで確認した。**本セッションではPlaywright等のブラウザ操作ツールが利用できないため、実際にトグルをクリックしてレンダリング結果をスクリーンショットで目視確認することはできていない**（CSSカスケード仕様に基づくレイヤー順の確認に留まる）。evaluatorのPlaywright実機検証で最終的な視覚確認が必要。
- 検証後、起動していた`npm run start`のプロセスは`taskkill`で停止済み（`netstat`でLISTENING状態が無いことを確認）。

## 実装した内容（拡張E1 全体・前回試行分を含む）
1. **一覧のページネーション**: `src/lib/pagination.ts`（純関数: `parsePageParam`/`computeTotalPages`/`clampPage`/`paginationOffset`/`paginateArray`）。トップ・カテゴリ・タグは DB `skip`/`take`（`listArticles`/`listArticlesByCategory`/`listArticlesByTag` が `PaginationResult<ArticleSummary>` を返すよう変更）。検索は本文JSON照合がDB WHEREで表現できないためアプリ側フィルタ後に `paginateArray` で区切り。1ページ20件・`?page=`・範囲外ページは最終ページにクランプ・0件は1ページ目/空配列。`src/components/pagination.tsx`（前へ/次へ+現在ページ表示、総ページ数1以下は非表示）。
2. **本文抜粋＋コメント数**: `Article.commentCount`（既定0）追加。`buildArticleExcerpt`（`src/lib/seo.ts`、既存`buildArticleDescription`を80字上限で流用）で本文先頭から抜粋を生成し `ArticleSummary.excerpt` に格納。`ArticleCard` にタイトル下の抜粋＋「💬 件数」を表示。
3. **相対時刻表示**: `formatRelativeTime(date, now)`（`src/lib/format.ts`、純関数）。「たった今」「N分前」「N時間前」「N日前」、30日以上は絶対日時にフォールバック、未来日時（クロックスキュー）は「たった今」に丸める。`ArticleMeta` で使用（絶対日時は`title`属性に保持、サーバー時刻で算出）。
4. **SNSシェアボタン**: `buildShareUrl`（`src/lib/share.ts`、純関数、X/LINE/はてなブックマークの共有URL組み立て）＋ `ShareButtons`（クライアントコンポーネント、Clipboard APIでURLコピー）。個別記事ページに設置。
5. **絵文字リアクション**: `ArticleReaction`テーブル（`articleId`+`emoji`一意）追加。`src/lib/reactions.ts`（`REACTION_EMOJIS`=😂😮😡👍、`isValidReactionEmoji`、`mergeReactionCounts`純関数）。`POST /api/articles/[slug]/reactions`（Route Handler、JSON不正/絵文字不正/保留・存在しない記事は各エラーレスポンス、成功時は加算後の全カウントを返す）。`ReactionButtons`（クライアント、楽観的更新＋連打抑止＝直前リクエスト完了までボタン無効化）。
6. **ダークモード切替**: Tailwind v4のクラスベースdark対応（`globals.css`に`@custom-variant dark (&:where(.dark, .dark *))`追加）。`ThemeToggle`（ヘッダー設置、localStorage保存、初期値はlocalStorage>`prefers-color-scheme`）。`layout.tsx`にFOUC防止の同期スクリプトを追加（`<head>`内、ユーザー入力を含まない固定文字列のみ）。主要な公開コンポーネント（記事カード/一覧空状態/広告枠/人気ランキング/レス本文/引用/パンくず/出典/関連記事見出し等）に`dark:`バリアントを追加。
7. **お知らせバー**: `SITE_NOTICE`環境変数（`src/lib/notice.ts`）。`layout.tsx`（サーバー）で読み取り`SiteChrome`（クライアント）へpropsで渡す設計（クライアントコンポーネントは非公開env変数を直接読めないため）。`NoticeBar`は閉じるとメッセージ内容ごとにlocalStorageキーで再表示抑止。`/admin`には表示しない。
8. **注目記事PICKUP**: `PickupCarousel`（トップ上部、`listPopularArticles`のviewCount上位を横スクロールのカード列で表示、自動送りは実装せず）。

## 技術選定
- 新規npm依存の追加なし。既存のNext.js/Tailwind/Prisma/Vitest構成の範囲内で実装（architecture.mdのベースラインを維持）。
- Tailwind v4のダークモードはクラスベース切替のため`@custom-variant dark`をCSS側で定義（v4はJS設定ファイルの`darkMode: 'class'`を廃止しCSSファースト設定に変更されたため）。
- リアクションは「記事×絵文字で1行、カウンタをupsertでincrement」の単純なテーブル設計とし、ログイン無し方針のためユーザー単位の多重投稿防止は行わず、UI側の連打抑止のみとした（仕様のスコープ判断通り）。
- 記事カードの抜粋表示のため`summarySelect`に本文(body)を追加（一覧はページネーションで1ページ20件に有界化済みのため、本文込み取得のコスト増は許容範囲と判断）。

## 受け入れ基準チェック（自己申告）
- [x] 一覧のページネーション: DB結合テスト（`articles-pagination.test.ts`）で25件→2ページ・端数ページ・範囲外クランプ・0件・保留記事除外を確認。`search.test.ts`にも同等のDB結合テストを追加。実機（curl）でも`?page=99`が200で最終ページ相当を返すことを確認。
- [x] 本文抜粋＋コメント数プレースホルダ: `ArticleSummary`に`excerpt`/`commentCount`を追加し`ArticleCard`に表示。実機で💬アイコン+件数の表示を確認。
- [x] 相対時刻表示: `formatRelativeTime`は純関数としてテスト済み（分/時/日/30日超フォールバック/未来日時）。`ArticleMeta`で使用、絶対日時はtitle属性に保持。
- [x] SNSシェアボタン: `buildShareUrl`をX/LINE/はてなブックマークの3種でテスト（特殊文字のエンコードも検証）。`ShareButtons`を記事ページに設置し実機でボタン表示を確認（クリックによる実際のポップアップ遷移・クリップボート書き込みはブラウザ操作が必要なため未検証）。
- [x] 絵文字リアクション: `POST /api/articles/[slug]/reactions`をDB結合テストで加算・不正絵文字400・不正JSON400・保留記事404・存在しない記事404を確認。実機（curl、UTF-8バイナリボディ）でも👍が6→7に加算されることを確認。
- [x] ダークモード切替: `.dark`クラスによるTailwindユーティリティ生成をビルド後のCSS（66箇所の`.dark`セレクタ）で確認。**（試行2で修正）** 前回の評価で発覚した「本文カラムだけ明色のまま残る」不具合を、`body`スタイルの`@layer base`化＋`--background`/`--foreground`のダーク時変数上書きで修正し、ビルド後CSSのレイヤー順（`base`→`utilities`）を確認済み。トグルボタンの実際のクリック挙動・レンダリング結果のスクリーンショット目視確認は、本セッションでPlaywright等のブラウザ操作ツールが利用できないため引き続き**未検証**（evaluatorのPlaywright実機検証で最終確認が必要）。
- [x] お知らせバー: `SITE_NOTICE`環境変数を設定してサーバー再起動し、トップページに文言が表示されること、`/admin`には表示されない（実際にレンダリングされる`bg-amber-500`のdivが存在しない）ことをcurlで確認。未設定時は非表示（既存の起動確認で確認済み）。
- [x] 注目記事PICKUP: トップページに「注目記事 PICKUP」見出しとカード列が表示されることをcurlで確認。

## アプリの起動方法
```
npm install
npx prisma migrate dev   # 初回のみ（本スプリントで新規マイグレーション追加済み: 20260725041808_add_engagement_features）
npm run db:seed
npm run build && npm run start -- -p 3100   # または npm run dev
```
- http://localhost:3100/ （トップ・ページネーション・PICKUP・お知らせバー用に`SITE_NOTICE`環境変数を設定可）
- お知らせバー確認例: `SITE_NOTICE="テスト" npm run start -- -p 3100`（PowerShellの場合は`$env:SITE_NOTICE="テスト"`後に実行）
- リアクションAPI確認例: `curl -X POST -H "Content-Type: application/json" -d '{"emoji":"👍"}' http://localhost:3100/api/articles/<slug>/reactions`

## 既知の問題・懸念点
- **ブラウザ実機検証は未実施**: 本セッションではPlaywright等のブラウザ操作ツールが利用できず、ダークモード切替のクリック挙動・SNSシェアのポップアップ遷移・Clipboard APIでのURLコピー・375px/1280pxでの実際の見た目崩れの有無は確認できていない（curlによる静的HTML/CSS確認、ビルド後CSSのレイヤー順確認、DB結合テストによるロジック確認のみ）。evaluatorのPlaywright実機検証で最終確認が必要。
- 法務3固定ページ（disclaimer/privacy/contact）は試行2で`dark:`バリアントを追加済み（本文段落・連絡先ボックス・リンク色）。見出し(h1/h2)は`body`のダーク文字色を継承する設計。
- お知らせバーの`notice`propは`/admin`ページのRSCハイドレーションペイロード（埋め込みJSON）には含まれるが、実際にレンダリングされる要素としては表示されない（curlで`bg-amber-500`要素が存在しないことを確認済み）。`SITE_NOTICE`は非秘密の公開文言のため情報漏洩の懸念はない。
- 記事カード一覧のクエリで本文(body)を毎回取得するようになった（抜粋生成のため）。ページネーションで1ページ最大20件に有界化しているため許容範囲と判断したが、将来記事数が大きく増えた場合は抜粋の事前計算・キャッシュ化の余地がある。

## 追加したテスト
- `src/lib/__tests__/pagination.test.ts`（純関数: parsePageParam/computeTotalPages/clampPage/paginationOffset/paginateArray）
- `src/lib/__tests__/format.test.ts`（追記: formatRelativeTime）
- `src/lib/__tests__/share.test.ts`（buildShareUrl、X/LINE/はてなブックマーク＋特殊文字エンコード）
- `src/lib/__tests__/reactions.test.ts`（isValidReactionEmoji/mergeReactionCounts）
- `src/lib/__tests__/reactions-route.test.ts`（DB結合: POST /api/articles/[slug]/reactions の加算・不正絵文字・不正JSON・保留/存在しない記事の404）
- `src/lib/__tests__/articles-pagination.test.ts`（DB結合: listArticles/listArticlesByCategory/listArticlesByTag のページネーション・範囲外クランプ・0件・保留除外）
- `src/lib/__tests__/search.test.ts`（追記: searchArticlesのページネーションDB結合テスト）
- `src/lib/__tests__/seo.test.ts`（追記: buildArticleExcerpt）
- テスト実行結果（試行2再確認）: `npm test` 33ファイル228件全てPASS。`npx tsc --noEmit`エラー0件。`npm run lint`エラー0件（既存の無関係な警告1件のみ`generation-generate-article.test.ts`、本スプリント差分外）。`npm run build`成功（全ルート生成）。今回のCSS/クラス変更はロジックを含まないため新規テストは追加していない（見た目のみの修正）。

## 前回フィードバックへの対応（再実装）
- 指摘: ダークモードで本文メインカラムだけ明色のまま残り「半分だけダーク」になる（`globals.css`のアンレイヤーCSSがTailwind utilitiesレイヤーを常に上書き、`--background`/`--foreground`にダーク時上書きが無い）。
  → 対応: `body`スタイルを`@layer base`に移動しレイヤー優先順位問題を解消。`.dark { --background; --foreground }`を追加。あわせて法務3ページ（disclaimer/privacy/contact）にも最小限`dark:`バリアントを追加。ライトモードの見た目・既存機能への影響は無し（テスト228件全PASS、build/lint/tsc全て成功で確認）。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
