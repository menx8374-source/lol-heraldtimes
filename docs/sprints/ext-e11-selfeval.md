---
tags: [sprint-selfeval]
sprint: E11
---

# 拡張スプリント E11 自己評価レポート

## 実装した内容
- F-E11-1: 記事ページ（`/articles/[slug]`）にスクロール追従の固定シェアバーを追加。
  - PC(lg以上): 本文左側に縦並びのバッジアイコン、`lg:sticky lg:top-24 lg:self-start` でスクロール追従。
  - モバイル(lg未満): 画面上部に `sticky top-0` の横並びバーへフォールバック（画面下部固定の
    Cookie同意バナー/アンカー広告=`BottomOverlayStack` と重ならないよう、あえて上部に配置）。
  - X/LINE/はてなブックマーク/Facebookを本物ロゴのインラインSVG（自前実装、外部CDN不使用）で表示。
    Xを配列先頭・最優先に配置。各リンクに `aria-label`/`title`（例:「Xでシェア」）を付与。
  - シェアURLは既存 `buildShareUrl`（`src/lib/share.ts`）を拡張して生成（新規タブ・`rel="noopener noreferrer"`維持）。
  - 記事下 `ShareButtons` も同じアイコン部品（`share-icons.tsx`）を共通利用するよう更新し、Facebookも追加。
- F-E11-2: `AdSlot`（`src/components/ad-slot.tsx`）を、広告コード未設定時に `null` を返すよう変更
  （枠・「広告 / PR」ラベル・「広告枠（未設定）」プレースホルダーを一切描画しない）。設定時は従来どおり
  ラベル付き枠＋コードを描画（`dangerouslySetInnerHTML` は信頼済みenv値のみという既存の安全方針を維持）。

## 変更/追加ファイル
- 追加: `src/components/share-icons.tsx`（X/LINE/はてブ/FacebookのインラインSVGアイコン・`SHARE_TARGETS`・`ShareIconLink`）
- 追加: `src/components/share-bar.tsx`（固定シェアバー本体、"use client"）
- 追加: `src/components/__tests__/ad-slot.test.tsx`
- 追加: `src/components/__tests__/share-bar.test.tsx`
- 変更: `src/components/ad-slot.tsx`（未設定時null化）
- 変更: `src/components/share-buttons.tsx`（アイコン共通化・Facebook追加）
- 変更: `src/lib/share.ts`（`ShareTarget`に`"facebook"`追加、`buildShareUrl`にfacebookケース追加）
- 変更: `src/lib/__tests__/share.test.ts`（facebookのURL生成テスト追加）
- 変更: `src/app/articles/[slug]/page.tsx`（`lg:flex`行で`ShareBar`と本文を横並び配置）

## シェアバーの追従方式・モバイルフォールバック
- 追従は各社が既にこのコードベースで採用しているCSS `sticky`パターン（`sidebar-sticky`広告枠と同様の手法）を採用。
  viewport-fixed（`position: fixed`固定オーバーレイ）は使わず、フローに乗せたstickyにすることで、
  既存の右サイドバー・画面下部固定のCookie同意バナー/アンカー広告との重なりを構造的に回避。
- モバイルは「下部固定バー」ではなく「画面上部sticky」をフォールバックとして採用（ブリーフの「下部固定バーや
  折返し配置などのフォールバック」の代替案）。理由: 既存の `BottomOverlayStack` が画面下部を
  `fixed inset-x-0 bottom-0 z-40` で占有しており、同じ下部に固定バーを追加すると二重固定でz-fight・
  クリック不能領域が生じるリスクがあったため、下部を避け上部sticky（`-mx-4`で親のpx-4を打ち消し
  横幅いっぱいに表示）とした。本文には被らない（sticky要素はフロー内に配置され、被さらない）。

## AdSlot非表示の分岐
- `getAdSlotCode(position)` が `undefined`（未設定・空白のみ）→ `AdSlot` は `null` を返す（DOM出力なし）。
- 値ありの場合のみ、「広告 / PR」ラベル付きの枠＋`dangerouslySetInnerHTML`でコードを描画（従来どおり）。
- 記事上部/下部・サイドバー・一覧・マッチドコンテンツ等の各呼び出し箇所は、いずれもAdSlot自身が
  余白(`my-4`)を内包する設計で、周囲要素は個別に自分のmt/border-tを持つ構成のため、AdSlotがnullでも
  レイアウト崩れ・二重余白は発生しないことをコード確認・実機確認（後述）で確認済み。

## 受け入れ基準チェック（自己申告）
- [x] シェアバーが表示され、下までスクロールしても位置が固定（追従）される（PC: sticky左レール、モバイル: sticky上部バー）。両方ともCSS `sticky`で実現。**実際のスクロール追従挙動はPlaywright実機確認が望ましく、今回はcurlでの静的HTML確認とコードレビューに留まる（後述の未検証項目）。**
- [x] シェアバー先頭にXがあり、各SNSが本物ロゴアイコン（インラインSVG）で表示される（テスト・静的HTML確認済み、X→LINE→はてブ→Facebookの順）。
- [x] 各アイコンは`buildShareUrl`のURLへ`target="_blank" rel="noopener noreferrer"`で新規タブを開くよう実装（テスト・静的HTML確認済み）。実際のクリック→新規タブ遷移はPlaywright実機での確認が望ましい（未検証）。
- [x] モバイル幅でシェアバーが本文に重ならない構成（sticky・フロー内配置。fixed非使用）。**実機での375px幅目視確認は未実施（後述）。**
- [x] 広告コード未設定時、記事・一覧・サイドバー等の広告枠が一切表示されない（テスト+実機curl確認済み: env未設定時HTMLに「広告 / PR」「広告枠（未設定）」が0件）。
- [x] 広告コードを設定した場合は「広告 / PR」ラベル付きの枠が表示される（env設定した実機curl確認済み: コード・ラベルとも出現）。
- [ ] ダークモードでの視認性: コード上はX用`dark:bg-white dark:text-black`等のダーク対応クラスを用意したが、**ブラウザでの目視確認は未実施**（未検証）。
- [x] `npm test` が全てGreen（513 tests / 59 files、AdSlot未設定時非表示・buildShareUrl(facebook)のテストを追加）。

## アプリの起動方法
- 開発: `npm run dev`（既定ポート3000）
- 本番相当: `npm run build && npm run start`（既定ポート3000。ポート変更時は `npm run start -- -p <PORT>`）
- 広告コード設定時の挙動確認: 環境変数 `AD_SLOT_ARTICLE_TOP`（等、`src/lib/ads/config.ts`のENV_KEYS参照）に任意のHTML文字列を設定して起動。
- 自己確認は上記コマンドでポート3411/3412に一時起動し、レポート作成前に停止済み（プロセス・ポートとも残留なし）。

## 既知の問題・懸念点
- Playwright MCPによる実ブラウザでのスクロール追従・クリックでの新規タブ確認・ダークモード目視・375px幅目視は今回未実施（evaluatorでの実機確認を想定）。tscビルド・vitest・curlでの静的HTML確認のみ。
- SNSアイコンのSVGパスは各社ブランドの意匠を模したインラインSVG自作実装（Simple Icons等のOSSアイコンセットで広く使われる意匠を参考に自前で記述）。ピクセル単位の公式アセット完全一致は保証しない（ライブラリ非依存の自前実装のため）が、各社のロゴとして視覚的に識別可能な形状・ブランドカラーで実装。
- モバイルのシェアバーは「下部固定」ではなく「上部sticky」を採用（既存の画面下部固定要素との衝突回避のため）。ブリーフの例示（下部固定バー）とは異なる手段だが、「本文可読性を損なわない」という受け入れ基準の趣旨は満たす設計判断。

## 追加したテスト
- `src/components/__tests__/ad-slot.test.tsx`: 未設定(undefined/空白)時に`null`（空文字列）を返すこと、設定時にラベル・コード・`data-ad-slot`を描画することを検証。
- `src/lib/__tests__/share.test.ts`: `buildShareUrl("facebook", ...)` のURL生成を追加検証。
- `src/components/__tests__/share-bar.test.tsx`: PC/モバイル2つのnavが存在すること、Xが先頭（最優先）であること、`buildShareUrl`の結果へ新規タブ・`noopener noreferrer`でリンクすること、LINE/はてブ/Facebookも含むことを検証。

## 関連ドキュメント
- [[ext-e11-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
