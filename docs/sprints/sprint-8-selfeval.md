---
tags: [sprint-selfeval]
sprint: 8
---

# Sprint 8 自己評価レポート

## 実装した内容
- **F12 広告枠差し込み**
  - `src/lib/ads/config.ts`: 広告コード（AdSense等のタグ文字列）を環境変数から取得する `getAdSlotCode`。5枠分のキー（`AD_SLOT_ARTICLE_TOP`/`_IN_BODY`/`_BOTTOM`/`_SIDEBAR`/`_LISTING`）。未設定時は `undefined`。
  - `src/components/ad-slot.tsx`: 共通広告枠コンポーネント。常に「広告 / PR」ラベル＋枠線・背景色区切りを表示し、コード未設定時はプレースホルダー文言を表示。`dangerouslySetInnerHTML` の対象は `getAdSlotCode()`（運営者設定の信頼済み値）のみに限定し、記事本文等の閲覧者由来データは混ぜていない。
  - 個別記事ページ（`src/app/articles/[slug]/page.tsx`）に `article-top`（見出しナビ直下）・`article-bottom`（本文末尾、出典セクション手前）・`sidebar`（`PageWithSidebar` 経由）を追加。
  - `src/components/article-body-view.tsx` に `article-in-body` を追加。2番目の見出し直前（構成上「導入見出し→要約見出し→まとめ見出し」の間）に差し込み。
  - `src/components/article-list.tsx` に `adInterval` prop を追加（既定 未指定＝広告なし）。トップページ（`src/app/page.tsx`）のみ `adInterval={4}` を指定し、4件ごとに一覧内広告枠を差し込む。カテゴリ／タグ／検索／関連記事一覧は既存どおり広告なし。
- **F13 SEO・構造化データ・サイトマップ・OGP・robots**
  - `src/lib/seo.ts`: `buildArticleDescription`（本文最初の段落から120文字要約、フォールバック・空白正規化つき純関数）、`toSafeJsonLd`（JSON-LD埋め込み時に `<` をUnicodeエスケープし `</script>` によるタグ早期終了を防ぐ安全な直列化）。
  - `src/lib/site.ts`: `getSiteUrl()`（`SITE_URL` env、未設定時 `http://localhost:3000`）。
  - 個別記事ページの `generateMetadata` を拡張: `description`・`openGraph`（title/description/url/image/type）を出力（Next Metadata APIが `twitter:*` も自動生成）。
  - 個別記事ページ本体に `<script type="application/ld+json">` でNewsArticle構造化データ（headline/datePublished/articleSection/mainEntityOfPage/image/publisher）を出力。
  - `src/app/sitemap.ts`: 公開記事（`status="published"`のみ）全件＋全カテゴリページ＋トップページを列挙。継続的に記事が公開されるパイプライン運用を想定し `export const dynamic = "force-dynamic"` でビルド時静的化を回避（毎リクエストDB再読込）。
  - `src/app/robots.ts`: `/admin`・`/dashboard`・`/api/` を Disallow（Sprint 9で追加予定の運営ダッシュボードのパス想定。実パス確定時に見直し必要）。`sitemap: <SITE_URL>/sitemap.xml` を明記。
  - `public/og-default.svg`: サムネイル未設定記事用のOGP既定画像プレースホルダー。
- `.env.example` / `README.md` に `SITE_URL`・`AD_SLOT_*` の説明を追記。
- テスト基盤の是正: `vitest.config.ts` に `fileParallelism: false` を追加（下記「既知の問題・懸念点」参照）。

## 技術選定
- 広告コード注入は Next.js Metadata API と同様「設定→表示」の素直な構成とし、新規ライブラリは追加していない（既存のNext.js標準機能のみで完結、依存追加なし）。
- OGP画像はバイナリ画像調達を避け、テキストのみの軽量SVGプレースホルダーを静的配置（`public/og-default.svg`）。実写真調達は本スプリント対象外（サムネイル自体が未設定運用のため）。

## 受け入れ基準チェック（自己申告）
- [x] 個別記事ページに記事上部・本文中(見出し間)・記事末尾・サイドバーの各広告枠が存在し、未設定時プレースホルダー表示: `curl`でHTML取得し `data-ad-slot` が `article-top`/`article-in-body`/`article-bottom`/`sidebar` の4種すべて出力・「広告枠（未設定）」表示を確認。
- [x] トップ記事一覧内にも一定間隔で広告枠: `adInterval={4}`。公開記事12件のDBで一覧内`listing`広告枠が2箇所出力されることを確認（4件毎・最終グループ後は出さない仕様）。
- [x] 設定に広告タグ文字列を入れると各枠に出力される: `AD_SLOT_SIDEBAR`をテスト用タグ文字列にして再起動→記事ページのsidebar枠にそのまま出力を確認。`AD_SLOT_LISTING`を設定して再ビルド→トップ一覧の広告枠に出力を確認（静的ページのため反映には再ビルドが必要。下記懸念点参照）。
- [x] 広告枠が本文・ナビと誤認されない配置（ラベル/区切りあり）: 全枠に共通で「広告 / PR」の小さいラベル＋破線枠＋背景色区切りを実装。目視・HTML確認済み。
- [x] 広告枠込みでスマホ・PCでレイアウトが崩れず本文が読める: 既存のTailwindレスポンシブ構成（`PageWithSidebar`のlg:flex-row等）はそのまま維持し、広告枠は通常のブロック要素として本文の縦流れに追加しただけのため崩れる要素なし。目視は`npm run dev`のブラウザ幅可変で簡易確認（Playwright等での実機マルチビューポート検証は未実施、下記懸念点参照）。
- [x] 記事ページに固有title・メタディスクリプション・OGP(og:title/description/image/url)出力: `curl`で `<title>`・`<meta name="description">`・`og:title`/`og:description`/`og:image`/`og:url` すべて確認。
- [x] 記事ページに構造化データ(見出し・公開日時・カテゴリ等): JSON-LD(`NewsArticle`)に`headline`/`datePublished`/`articleSection`を含め出力を`curl`で確認。
- [x] 全公開記事とカテゴリページを列挙したサイトマップが生成されアクセス可能: `/sitemap.xml`にcurlでアクセスし12公開記事+5カテゴリ+トップの18件を確認。自動テスト(`seo-output.test.ts`)で保留記事が含まれないことも検証。
- [x] robotsで管理／保留キュー等がクロール対象外: `/robots.txt`で`/admin`・`/dashboard`・`/api/`をDisallow確認。自動テストでも検証。
- [x] トップ・カテゴリ・記事の各ページのtitleが固有: `curl`実測（トップ「LoLまとめ速報」、カテゴリ「パッチ/メタ の記事一覧 | LoLまとめ速報」、記事「(記事タイトル) | LoLまとめ速報」）＋自動テストで記事間・カテゴリ間の非重複、トップの既定titleが記事titleと異なることを検証。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev     # 初回のみ
npm run db:seed            # サンプル記事投入
npm run build && npm run start   # 本番相当（http://localhost:3000）。sitemap/robots/静的ページの挙動確認にはbuildを推奨
# または開発確認: npm run dev
npm test                    # Vitest（137件）
```
- 広告タグ設定確認: `.env`に`AD_SLOT_SIDEBAR=<任意のHTML文字列>`等を設定してから起動（静的生成されるトップページの`AD_SLOT_LISTING`は`npm run build`時点のenvが反映される。動的レンダリングの記事ページ等は起動時のenvで都度反映）。

## 既知の問題・懸念点
- **静的ページのenv反映タイミング**: `next build`によりトップページ(`/`)はビルド時に静的プリレンダリングされるため、ビルド後に`AD_SLOT_LISTING`等のenvを変更しても`npm run start`の再起動だけでは反映されず再ビルドが必要（Next.jsの静的最適化の仕様であり本スプリントの実装不具合ではない）。個別記事ページ等は動的レンダリングのため起動時のenvが都度反映される。運用上は「envは`next build`前に確定させる」運用を前提にする。
- **サイトマップの鮮度**: 上記と同じ理由で `sitemap.xml` もデフォルトでは静的化されビルド時点のDBスナップショットに固定されてしまう問題があったため、`export const dynamic = "force-dynamic"` を明示的に追加して毎リクエストDB再読込するよう修正済み（自動運営パイプラインが継続的に記事を公開する前提と矛盾しないようにするための対応）。ただしトップページ自体は本スプリントのスコープ外のため静的のまま（Sprint 8時点での既存挙動を維持。パイプライン公開直後に一覧へ反映するには再ビルドまたは動的化が必要になる点は、次スプリント以降の検討事項として申し送り）。
- **本文中広告の位置は見出し2番目固定**: 記事は最低3見出し構成（導入/要約/まとめ）で生成されるため通常は2番目の見出し直前に収まるが、将来的に見出しが1個しかない構成に変更された場合は本文中広告が出力されない（本文自体は問題なく表示される。エラーにはならない）。
- **レスポンシブの実機マルチビューポート検証は未実施**: Tailwindの既存レスポンシブクラスを維持したまま広告枠を追加しただけであり構造的に崩れる要素はないと判断しているが、Playwright等でスマホ幅・PC幅を実際に切り替えての目視確認は行っていない（evaluatorでの検証を想定）。
- **robotsのDisallowパスは仮決め**: Sprint 9で運営ダッシュボードが実装される際の実際のURLパスが `/admin` と一致しない場合、`src/app/robots.ts` の見直しが必要（コメントに明記済み）。
- **DB結合テストのファイル並列実行レース**: `seo-output.test.ts`（新規のDB結合テスト）追加により、既存の`pipeline-run-pipeline.test.ts`と同一テストDBファイルへ並列書き込みして稀に失敗するようになったため、`vitest.config.ts`に`fileParallelism: false`を追加して解消（4回連続実行で137件全てGreenを確認）。`reference/learnings.md`に一般化した教訓として追記済み。

## 追加したテスト
- `src/lib/__tests__/seo.test.ts`: `buildArticleDescription`（段落優先・フォールバック・切り詰め・空白正規化の4ケース）、`toSafeJsonLd`（通常直列化・`</script>`混入時の安全エスケープ）。
- `src/lib/__tests__/seo-output.test.ts`（Prisma実DB結合テスト、公開2件+保留1件を投入）:
  - `sitemap()`が公開記事のみ列挙し保留記事を含まないこと／全カテゴリ+トップを含むこと
  - `robots()`が`/admin`・`/dashboard`をDisallowすること／`allow: "/"`と`sitemap`URLを提供すること
  - 記事ページ`generateMetadata`が記事ごとに異なるtitleを返すこと（ハードコード固定文字列でないこと）
  - カテゴリページ`generateMetadata`がカテゴリごとに異なるtitleを返すこと
  - トップページ既定titleが記事titleと重複しないこと
- テスト結果: `npm test` で **137件全てGreen**（既存124件+本スプリント新規13件、退行なし）。連続4回実行で決定的にGreenであることを確認済み。
- `npx tsc --noEmit`・`npm run build`・`npm run lint` いずれもエラーなし（既存の無関係warning1件のみ、新規追加なし）。

## 関連ドキュメント
- [[sprint-8-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
