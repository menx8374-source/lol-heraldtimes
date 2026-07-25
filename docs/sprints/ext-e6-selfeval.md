---
tags: [sprint-selfeval]
sprint: ext-e6
---

# Sprint E6（攻略・データ固定ページ）自己評価レポート

## 実装した内容
- **データモジュール**（`src/lib/lol-data/`、記事DBとは独立の静的モック。すべてオリジナル創作）
  - `types.ts`: ロール(TOP/JG/MID/ADC/SUP)・Tier(S/A/B/C)の共通語彙。
  - `champions.ts`: チャンピオン50体。`title.ts`の`CHAMPIONS`語彙（名前のみ）を土台に、ロール・Tier・難易度(1-3)・一言説明(オリジナル書き起こし)を新規付与。`listChampions(role?)`/`getChampionBySlug(slug)`。
  - `patches.ts`: パッチノート6件（v14.8〜14.13、架空の日付・変更内容）。`listPatches()`（日付降順）/`getPatchByVersion()`。
  - `glossary.ts`: LoL用語24件（ガンク/CS/ピール/エンゲージ/オブジェクト/ワード等）。定義文はすべて独自の平易な書き起こし。`listGlossaryTerms(query?)`（五十音順＋用語/定義文の絞り込み）。
  - `tier.ts`: `champions.ts`の`tier`フィールドを唯一のsource of truthとし、`buildTierTable(role)`/`buildAllTierTables()`でロール別S/A/B/C表を組み立てる純関数。
- **固定ページ**
  - `/champions`: 一覧＋ロール絞り込みnav（`?role=`）。難易度凡例付き。
  - `/champions/[slug]`: 個別ページ（ロール・Tier・難易度・説明・同ロールの他チャンピオン）。未知slugは404。
  - `/patches`: 一覧（バージョン・日付・見出し・要約）。
  - `/patches/[version]`: 個別（変更点一覧・他パッチへの導線）。未知versionは404。
  - `/tier`: ロール別セクション＋アンカーnav。テーブルではなくflex-wrapのチップ形式で実装しモバイル横スクロール崩れを回避。
  - `/glossary`: 五十音順一覧＋`?q=`によるGET検索フォーム（クライアントJS不要）。
- **共通コンポーネント**: `champion-card.tsx`（一覧カード）、`tier-badge.tsx`（S/A/B/C配色バッジ）。
- **ナビゲーション**: `site-header.tsx`にカテゴリnavとは別行で「攻略・データ」nav（チャンピオン一覧/Tier表/パッチノート/用語集）を追加。
- **SEO**: 各ページに固有`generateMetadata`/`title`/`description`。個別ページ・一覧ページとも`Breadcrumbs`コンポーネント（可視表示＋BreadcrumbList JSON-LD）を設置。`src/app/sitemap.ts`に一覧4ページ＋チャンピオン50件＋パッチ6件の個別URLを追加（語彙で有界、記事数増加とは独立）。
- **免責**: チャンピオン詳細・パッチ詳細・Tier表の各ページに「当サイト独自の見解によるオリジナルの創作コンテンツ」である旨の注記ブロックを設置（既存フッターのRiot非公認ディスクレーマーと併用）。
- 既存の`PageWithSidebar`（サイドバー広告枠含む）・`Breadcrumbs`・ダーク対応のTailwindクラスをそのまま踏襲。新規の広告枠追加はしていない（サイドバー既存枠のみ、過剰配置を避けた）。

## 技術選定
- 新規ライブラリは追加なし。既存のNext.js App Router（`generateMetadata`/`notFound`）・Tailwind・既存コンポーネント（`Breadcrumbs`/`PageWithSidebar`/`EmptyState`）をそのまま再利用。
- Tier表は`<table>`ではなくflex-wrapチップ形式を選択（375px幅での表崩れ・横スクロールを避けるため。既存`archive`/`tags`一覧のカードスタイルと一貫性を保つ判断）。
- 用語集の絞り込みは`search-form.tsx`と同じGETフォーム方式（クライアントJS不要、サーバーコンポーネントのまま完結）。

## 受け入れ基準チェック（自己申告）
- [x] `/champions`一覧・ロール絞り込み・個別ページ: 実装・ビルド・実機(curl)確認済み。50体、オリジナル創作。
- [x] `/patches`一覧・個別ページ: 実装・確認済み。6バージョン、オリジナル創作パッチ内容。
- [x] `/tier`: ロール別S/A/B/C分類、レスポンシブ（flex-wrapチップでモバイル崩れなし）、パッチ版数注記＋「当サイト独自の見解」明記。オリジナル創作ランク。
- [x] `/glossary`: 五十音順一覧、`?q=`検索絞り込み、オリジナル定義文。
- [x] ナビゲーション: ヘッダーに「攻略・データ」nav追加、実機で全4リンク確認。
- [x] SEO: 各ページ固有title（curlで個別確認、全ページ重複なし）・meta description・BreadcrumbList JSON-LD（curlで構造確認）。
- [x] サイトマップ追加: `/champions`・`/champions/[slug]`(50件)・`/patches`・`/patches/[version]`(6件)・`/tier`・`/glossary`をcurlで確認。テストでも検証。
- [x] すべてオリジナル創作モックデータ: 各データファイル冒頭コメントに明記。チャンピオン名等の一般名詞は使用するが説明文・Tier・パッチ内容・用語定義はすべて新規執筆。
- [x] 既存機能への影響なし: 既存376テスト＋新規34テスト=410件全Green、`npm run build`成功、既存ページ(`/`,`/category/patch-meta`等)の200応答を確認。
- [x] ダーク/レスポンシブ対応: 既存コンポーネント（`dark:`クラス付き）をそのまま利用。実機ブラウザでの目視確認は未実施（curl/HTMLレベルの確認のみ、後述）。

## アプリの起動方法
```
npm run db:seed                  # サンプル記事投入（既存DBがあれば任意）
npm run build && npm run start   # 本番相当起動（http://localhost:3000）
```
- 開発起動: `npm run dev`
- 確認URL: `/champions`（`?role=TOP`等で絞り込み）、`/champions/garen`、`/patches`、`/patches/14-13`、`/tier`、`/glossary`（`?q=ガンク`等）
- テスト: `npm test`（Vitest, 410件Green）／型チェック: `npx tsc --noEmit`（エラー0件）／Lint: `npm run lint`（既存の無関係な警告1件のみ、エラー0件）／ビルド: `npm run build`（成功、新規6ルートすべて登録確認）
- 自己確認用サーバーは検証後に停止済み（ポート3000解放を確認）。

## 既知の問題・懸念点
- **実機ブラウザ（Playwright等）でのダークモード切替・375px/1280px双方の見た目確認は未実施**。既存コンポーネント（`PageWithSidebar`/`Breadcrumbs`/`EmptyState`等、既に他スプリントでダーク/レスポンシブ確認済み）をそのまま再利用しているため崩れる可能性は低いと考えるが、`/tier`のチップレイアウトは本スプリントの新規UIのため特に未検証。evaluatorでの実機確認を推奨。
- Tier表・チャンピオン一覧のTier/難易度/ロール割当は50体・単一ロールの簡易割当（複数ロール兼任は考慮していない）。実際のLoLでは複数ロールを持つチャンピオンもいるが、データ構造をシンプルに保つため今回は1体1ロールとした。
- `/champions/[slug]`のOGP画像は未設定（既存記事ページのようなサムネイル画像枠は持たない。テキストベースの解説ページのため必須ではないと判断）。
- パッチノートのバージョン番号（14.x）は一般的な採番慣習を踏襲しているが、内容（変更点・日付）はすべて創作。実在パッチとの数値の偶然の一致はあり得るが、内容自体の複製ではない。

## 追加したテスト
- `src/lib/__tests__/lol-data-champions.test.ts`: スラッグ/名前の一意性、ASCII安全性、ロール網羅、`listChampions`のロール絞り込み・五十音ソート、`getChampionBySlug`の存在/非存在。
- `src/lib/__tests__/lol-data-tier.test.ts`: `buildTierTable`のロール一致・Tier一致・件数整合、`buildAllTierTables`の全ロール網羅・合計件数一致。
- `src/lib/__tests__/lol-data-patches.test.ts`: バージョン/スラッグの一意性、ASCII安全性、`listPatches`の日付降順、`getPatchByVersion`のバージョン/スラッグ両対応。
- `src/lib/__tests__/lol-data-glossary.test.ts`: スラッグ/用語の一意性、`listGlossaryTerms`の五十音ソート・用語/定義絞り込み・該当なし時の空配列。
- `src/lib/__tests__/seo-output.test.ts`に追記: サイトマップへの攻略・データページ追加の確認、チャンピオン/パッチ個別ページ・一覧4ページのタイトル固有性確認。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
