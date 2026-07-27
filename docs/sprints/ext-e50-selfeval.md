---
tags: [sprint-selfeval]
sprint: ext-e50
---

# 拡張E50 自己評価レポート

## 実装した内容
- F-E50-1: `src/lib/generation/compose.ts` の `buildReactionDisplayLines` から `original`（英語原文）の付与を全経路（行数一致／行数不一致で束ねる場合）で削除。翻訳が無い場合（5ch・reddit翻訳失敗）は従来どおり`original`無し（不変）。
- F-E50-2:
  - `src/lib/article-body.ts` に純関数 `shouldShowHeroThumbnail(blocks)` を追加（本文先頭ブロックが`image`ならfalse、それ以外はtrue）。
  - `src/components/article-thumbnail.tsx` に任意の `alt` prop を追加（未指定時は従来どおり`""`で既存呼び出し元は無変更）。
  - `src/app/articles/[slug]/page.tsx` で `ArticleBodyView` の直前に `ArticleThumbnail` をヒーロー表示（`shouldShowHeroThumbnail(article.body)` が true のときのみ、`alt={article.title}`、`className="max-h-96 w-full rounded-lg object-cover"`）。パッチ記事等、本文先頭が`image`ブロックの記事では非表示（二重画像防止）。

## 技術選定（該当する場合のみ）
- 新規依存なし。既存の `ArticleThumbnail`（E38フォールバック込み）をそのまま再利用。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1011件、新規/更新分含む）。
- [x] `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過（lintは既存の警告6件のみ、今回変更箇所に起因するものではなく既存のまま。エラー0件）。
- [x] Reddit記事が日本語訳のみ（原文英語なし）: `buildReactionDisplayLines` の全経路からoriginal付与を削除、テストで確認。既存DB上の(E50より前に生成済みの)記事は保存済みデータのまま原文併記が残る点は既知の挙動（後述）。
- [x] 記事ページ冒頭にサムネ画像が出る（パッチ記事は既存バナーのみで二重にならない）: 単体テスト＋dev.dbでの手動確認（後述）で確認。

## アプリの起動方法
- `npm run dev`（http://localhost:3000）。記事ページ例: `http://localhost:3000/articles/<slug>`（dev.dbのmockデータで確認。例: `5ch-yasuo-otp-densetsu-no-play`、`overseas-tier-list-patch-146-hantei`、`patch-2614-jungle-nerf-hikkuri-kaeru`）。

## 既知の問題・懸念点
- E50より前に生成済みの記事（DB保存済みbody、dev.dbのmockデータ含む）は、当時保存された`original`フィールドをそのまま持っているため、`ArticleBodyView`側の原文描画コード（あえて削除せず維持。ブリーフの「そのままでよい」方針に従った）でこれまで通り「原文: ...（英語）」が表示され続ける。**これはデータ移行が今回のスコープ外**（ブリーフに移行の指示なし、生成ロジックのみの変更）であり、E50以降に新規生成される記事のみ日本語訳のみになる。手動確認でも実際にこの挙動を確認した（`overseas-tier-list-patch-146-hantei`は生成済み記事のため原文表示が残存、新規生成記事では出ない）。
- 記事ページ本体（`articles/[slug]/page.tsx`）は`PageWithSidebar`等の非同期子コンポーネントを含むasync Server Componentのため、`react-dom/server`の同期API(`renderToStaticMarkup`)では直接レンダリングできない（"component suspended"エラー）。そのため、F-E50-2のロジックは分岐判定の純関数(`shouldShowHeroThumbnail`)＋実際に使うレンダリングコンポーネント(`ArticleThumbnail`)を単体テストする方針にした。実際のページ全体でのヒーロー表示・パッチ記事での非表示・二重なしは、`npm run dev`起動＋curlでの手動確認で正常動作を確認済み（下記参照）。ただし手元のdev.db(mock)には本文先頭がimageブロックの記事（E42のパッチバナー）が現状1件も存在しなかったため、「image先頭記事でヒーロー非表示」は単体テスト(`shouldShowHeroThumbnail(imageFirstBody) === false`)でのみ確認し、実データでのブラウザ目視確認はできていない（未検証）。ロジック自体は単純な1行の条件分岐であり、単体テストでカバー済み。
- 手動確認内容（`npm run dev`起動、確認後に停止済み）:
  - `5ch-yasuo-otp-densetsu-no-play`（反応記事）: `<img class="...rounded-lg...">`が本文直前にチャンピオンスプラッシュURLで1件だけ出現、alt=記事タイトル。
  - `overseas-tier-list-patch-146-hantei`（reddit反応記事、E50より前に生成済み）: ヒーロー画像は正常表示。ただし本文中に既存データの「原文: ...」が残存（上記懸念点参照、想定通り）。
  - `patch-2614-jungle-nerf-hikkuri-kaeru`（パッチ記事、本文先頭は`heading`でimageではない）: ヒーロー画像が1件だけ表示され重複なし。

## 追加したテスト
- `src/lib/__tests__/generation-compose.test.ts`: 既存の原文併記前提テスト（行数一致/不一致/バッチ分割）を「originalを持たない」期待値に更新。
- `src/lib/__tests__/article-page-hero.test.tsx`（新規）: `shouldShowHeroThumbnail`が本文先頭image/非image/空配列で正しい真偽を返すこと。`ArticleThumbnail`が反応記事(チャンピオンスプラッシュフォールバック)・保存済みthumbnailUrlの両方で妥当なsrc/altを出すこと。

## 関連ドキュメント
- [[ext-e50-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
