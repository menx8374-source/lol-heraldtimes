---
tags: [sprint-selfeval]
sprint: revalidate-S1
---

# revalidate-S1 自己評価レポート

## 実装した内容
- `src/lib/revalidate-config.ts`（新規）: 共有定数 `LISTING_REVALIDATE_SECONDS = 300`（ドキュメント/テスト上の単一の真実源）。
- 一覧ページ11箇所に `export const revalidate = 300;`（A・短いISR）を追加: `/`・`/category/[slug]`・`/tags`・`/tags/[tag]`・`/patches`・`/patches/[version]`・`/archive`・`/archive/[key]`・`/tier`・`/champions`・`/champions/[slug]`。
- `src/app/api/revalidate/route.ts`（新規、POST・`dynamic="force-dynamic"`）: `REVALIDATE_SECRET`（未設定なら401）＋`x-revalidate-secret`ヘッダ/body.secret一致で、固定の一覧パス群のみ`revalidatePath`。GETは405。
- `src/lib/generation/revalidate-listings.ts`（新規）: `revalidatePublishedListings()`。`REVALIDATE_SECRET`未設定でno-op、設定時は内部URL（既定`http://127.0.0.1:<PORT|3000>/api/revalidate`）へシークレット付きPOST（5sタイムアウト・失敗は握りつぶしログのみ）。
- `src/lib/pipeline/run-pipeline.ts`: 公開後ブロック（`newlyPublishedArticleIds.length > 0`内、`notifyPublishedArticles`の隣）でtry/catch付きで`revalidatePublishedListings()`を呼ぶよう配線。
- `.env.example` に `REVALIDATE_SECRET`/`REVALIDATE_URL`（任意・キー名のみ）を追記。

## 技術選定（該当する場合のみ）
- 当初brief通り「共有定数をimportしてrevalidateへ代入」を実装したが、`npm run build`で
  `Invalid segment configuration export detected`（ビルド失敗）を確認。原因調査の結果、Next.js
  16.2.11の`revalidate`静的AST抽出（`extractExportedConstValue`）は**インポートした識別子を解決できず
  `Unknown identifier`として`unsupported`扱いになりビルド失敗する**（Next.js公式仕様上の制約。
  リテラル値のみサポート）ことを`node_modules/next/dist/build/analysis/extract-const-value.js`の
  実装から確認した。
- 対応: 各page.tsxには数値リテラル`300`を直書きし、`src/lib/revalidate-config.ts`の
  `LISTING_REVALIDATE_SECONDS`はドキュメント/テスト用の単一の真実源として残す（値変更時は
  全ページのリテラルも合わせて変更する運用注記をコメントで明記）。テスト（F-RV1-1相当）は
  「各pageのrevalidate export値 === LISTING_REVALIDATE_SECONDS」を検証し実質的な単一ソース性は担保。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run`全Green（128 files / 1798 tests）・`tsc --noEmit`エラー0・`npm run build`成功（revalidate静的解析OK、上記の対応後）・`npm run lint`エラー0（既存由来の警告7件のみ、今回変更ファイルに新規警告なし）。
- [x] 一覧ページがISR(A・300s)を持つ（`build`出力で `/tags`・`/patches`・`/archive`・`/tier`は`○ Static, Revalidate 5m`と確認）。pipelineの公開後に内部URL経由でオンデマンド再検証(B)を呼ぶ配線を実装・結合テストで検証。
- [x] 記事詳細/管理画面・既存挙動不変（`/articles/[slug]`・`/admin*`・`/search`・静的固定ページは無変更、diffで確認）・本体を止めない（try/catch二重・関数内握りつぶし）・スキーマ/依存変更なし（`package.json`未変更）・APIはシークレット必須で安全（未設定/誤りで401、固定パスのみ、POST以外405）。

## アプリの起動方法
- ビルド: `npm run build` → 起動: `npm run start -- -p 3100`（`REVALIDATE_SECRET=<秘密>`をenvに設定するとB有効化）
- `curl -X POST http://127.0.0.1:3100/api/revalidate -H "x-revalidate-secret: <秘密>"` → `{"revalidated":true}`（実機で確認済み）
- 開発確認: `npm run dev`（デフォルトポート3000）でも同様に動作する想定（`npm run start`本番モードで実機確認済み）。

## 既知の問題・懸念点
- `/`・`/category/[slug]`・`/tags/[tag]`・`/patches/[version]`・`/archive/[key]`・`/champions`・`/champions/[slug]`は`searchParams`/ページネーション等の動的API使用により、`build`出力上は`ƒ Dynamic`（リクエスト毎SSR）のままで、`revalidate=300`のISRキャッシュは実質的に効かない（これは本スプリント以前からの既存のsearchParams利用パターンに起因し、スコープ外）。ただし動的SSRのためDBから都度最新を読み常に鮮度が高く、新着の反映という目的自体は損なわれない（むしろBが無くても即時反映）。`/tags`・`/patches`・`/archive`・`/tier`（パラメータ無し一覧）は実際に`○ Static, Revalidate 5m`としてISRが効くことをbuild出力で確認済み。
- Next.jsの`revalidate`静的解析はインポート定数を解決できないため、各pageに数値リテラル`300`を直書きしている（`LISTING_REVALIDATE_SECONDS`と値がズレないよう手動で追随する必要がある。コメントで明記済み）。
- `REVALIDATE_SECRET`のシークレット比較は固定文字列比較（`!==`）。brief許容範囲内（「少なくとも固定文字列比較でよい」）だがタイミング攻撃への厳密な対策（`crypto.timingSafeEqual`等）は行っていない。

## 追加したテスト（任意）
- `src/app/api/__tests__/revalidate-route.test.ts`: 正シークレット200＋固定パス群への`revalidatePath`呼び出し（`next/cache`モック）／誤・欠落シークレット401／`REVALIDATE_SECRET`未設定401／GET405／body任意パス混入でも固定パスのみ再検証。
- `src/lib/__tests__/revalidate-listings.test.ts`: `REVALIDATE_SECRET`未設定でfetch呼ばずno-op／設定時に既定内部URL・PORT反映・`REVALIDATE_URL`明示指定へのPOST／fetch例外・非2xxでも例外を投げない。
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`（追記）: 新規公開>0で`revalidatePublishedListings`相当のfetchが呼ばれる／0件・`REVALIDATE_SECRET`未設定で呼ばれない／失敗してもパイプライン本体は成功のまま完走。
- `src/app/__tests__/listing-revalidate.test.ts`: 対象11ページすべてが`revalidate === LISTING_REVALIDATE_SECONDS`をexportすることを確認。

## 関連ドキュメント
- [[revalidate-s1-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
