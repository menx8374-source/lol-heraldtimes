---
tags: [sprint-selfeval]
sprint: ext-e5
---

# Sprint E5（収益化拡充）自己評価レポート

## 実装した内容
- **広告枠の種類拡充**: `AdSlotPosition` に `sidebar-sticky`（追従サイドバー広告）・`anchor`（アンカー広告）・`matched-content`（マッチドコンテンツ）を追加。`ENV_KEYS`/`POSITION_LABELS`を拡張（既存の`AdSlot`/`getAdSlotCode`方式をそのまま踏襲、env設定＋未設定時プレースホルダ）。
  - 追従サイドバー広告: `page-with-sidebar.tsx`のサイドバー最下部に`lg:sticky lg:top-20`のラッパーで配置（PCのみ追従、モバイルは通常ブロック）。
  - インフィード広告: 既存の一覧内広告(`listing`)のラベルを「インフィード広告」に整理（新規position追加はせず、既存枠を拡張・明確化）。
  - アンカー広告: `AnchorAdBar`コンポーネント。画面下部固定・閉じるボタン付き・`lg:hidden`（モバイル想定、PCは追従サイドバー広告があるため非表示）。閉じた状態はlocalStorage(`lol-matome:anchor-ad-dismissed`)に保存し再訪問時も抑止。
  - マッチドコンテンツ: 記事詳細ページの「関連記事」セクション直下に`AdSlot position="matched-content"`を併設。
  - 全枠に「広告/PR」ラベルを表示し本文と区別（AdSenseポリシー配慮）。
- **Cookie同意バナー（CMP）**: `CookieConsentBanner`＋状態管理は`BottomOverlayStack`。初回訪問時に画面下部へ「同意する」「拒否/後で」の2択バナーを表示。選択はlocalStorage(`lol-matome:cookie-consent`)に保存し次回以降は非表示。プライバシーポリシー(`/privacy`)へのリンクを含む。
- **GA4等アクセス解析タグ枠**: `getGaMeasurementId()`がenv `NEXT_PUBLIC_GA_MEASUREMENT_ID` を読み、`GoogleAnalytics`コンポーネント(`next/script`)が実際のgtag.jsを読み込む。**Cookie同意済み(`accepted`) かつ 計測ID設定済みの場合のみ**マウントする(`shouldLoadAnalytics`)。未同意・未設定時は一切スクリプトを出力しない。
- **同意前トラッキング禁止の設計**: バナー表示中(`unknown`)・拒否(`rejected`)のいずれもGA4スクリプトを一切レンダリングしない（DOMに現れない＝ネットワークリクエストも発生しない）。実機(Playwright)でリクエストログを見て確認済み（後述）。
- **バグ修正（実装中に自己発見）**: Cookie同意バナーとアンカー広告を独立した`fixed bottom-0`コンポーネントとして実装したところ、モバイルで両方表示される際に重なり、バナーがアンカー広告の閉じるボタンをブロックする問題を発見。両者を`BottomOverlayStack`という単一のクライアントコンポーネントに統合し、共通の`fixed`コンテナ内で`flex-col-reverse`によりスタック（アンカー広告が一番下、その上に同意バナー）するよう再設計して解消。
- プライバシーポリシー(`/privacy`)に「Cookieの使用と同意について」セクションを追記し、CMPの挙動と整合させた（最小追記）。
- `.env.example`に新規env（`AD_SLOT_SIDEBAR_STICKY`/`AD_SLOT_ANCHOR`/`AD_SLOT_MATCHED_CONTENT`/`NEXT_PUBLIC_GA_MEASUREMENT_ID`）をキー名のみ追記。

## 技術選定
- 新規ライブラリは追加なし。GA4読み込みはNext.js標準の`next/script`（`afterInteractive`）を利用（追加依存なし）。
- 同意状態・アンカー広告の閉じる状態はいずれも`localStorage`（既存の`NoticeBar`/ダークモードと同じ方式で一貫性を維持）。
- Cookie同意バナーとアンカー広告のUI状態を単一コンポーネント(`BottomOverlayStack`)に統合したのは、独立実装だと画面下部の`fixed`要素同士が重なる実装上の問題（後述バグ）を構造的に防ぐため。

## 受け入れ基準チェック（自己申告）
- [x] 追従サイドバー広告: PC(lg以上)で`sticky`配置。実機(Playwright, 1280x900)でスクロール後も表示位置を維持することを確認。
- [x] インフィード広告: 既存の一覧内広告を「インフィード広告」ラベルに整理。記事一覧の途中に挟まる配置は既存踏襲（未変更）。
- [x] アンカー広告: 画面下部固定・閉じるボタンで消える・閉じたらlocalStorageで再表示抑止（リロード後も非表示を確認）・モバイル想定でPCでは非表示(`lg:hidden`)。コンテンツを覆い隠す配置ではなく、下部にスペーサーを設けて本文と重ならないようにした。
- [x] マッチドコンテンツ: 記事末尾の関連記事セクションに広告枠を併設。実機確認済み。
- [x] `AdSlotPosition`拡充とENV_KEYS/POSITION_LABELS網羅: 全position分のテスト(`ads-config.test.ts`)で確認。
- [x] Cookie同意バナー: 初回訪問時に表示、「同意する」「拒否/後で」の2択、プライバシーポリシーへのリンクを含む。実機(Playwright)で表示→選択→非表示化→リロード後も非表示、を確認。
- [x] 同意状態の永続化（localStorage）: リロード後も同じ状態を維持することを実機確認。
- [x] GA4タグの同意連動（同意前トラッキング禁止）: 同意前(バナー表示中・拒否後)はGA4への一切のネットワークリクエストが発生しないことを実機(Playwright, リクエストログ)で確認。「同意する」クリック直後にのみgoogletagmanager.comへのリクエストが発生することを確認。IDが未設定の場合はコンポーネント自体をレンダリングしない(`shouldLoadAnalytics`)。
- [x] `/admin`には広告/バナー/解析タグを一切出さない: 実機(Playwright)で`/admin`ページの`data-ad-slot`要素数=0・同意バナー非表示を確認。
- [x] 既存機能（レス表示・コメント・リアクション・ページネーション・アーカイブ・ダーク・レスポンシブ）を壊さない: 既存353件＋新規23件＝376件全テストGreen、`npm run build`成功、実機でダークモード・モバイル/デスクトップ双方の表示崩れなしを確認。

## アプリの起動方法
```
npm run db:seed                  # サンプル記事投入（既存DBがあれば任意）
npm run build && npm run start   # 本番相当起動（http://localhost:3000）
```
- 開発起動: `npm run dev`
- 広告/GA4の実タグ確認には`.env.local`（gitignore済み）に`AD_SLOT_SIDEBAR_STICKY`/`AD_SLOT_ANCHOR`/`AD_SLOT_MATCHED_CONTENT`/`NEXT_PUBLIC_GA_MEASUREMENT_ID`等を設定し、**設定変更後は`npm run build`からやり直す**こと（`NEXT_PUBLIC_`変数はビルド時に埋め込まれるため）。
- テスト: `npm test`（Vitest, 376件Green）／型チェック: `npx tsc --noEmit`／Lint: `npm run lint`（既存の無関係な警告1件のみ、エラー0件）
- 検証方法: Playwright（`npx playwright install chromium`で一時取得、開発依存には追加せず）でヘッドレスブラウザから実操作・ネットワークリクエストログを確認。自己確認用サーバーは検証後に停止済み。

## 既知の問題・懸念点
- インフィード広告は新規position（例: `in-feed`）を追加せず、既存`listing`のラベルのみ整理する形にとどめた。仕様は「既存の一覧内広告があれば整理・拡張」と許容しているため範囲内と判断したが、より明確な区別が必要であれば別positionへの分離余地はある。
- アンカー広告のPC非表示(`lg:hidden`)・追従サイドバー広告のモバイル非sticky、という設計上の役割分担（PC=追従サイドバー、モバイル=アンカー）は自己判断。仕様は両方を独立した広告種として求めているため、双方のenv・実装は用意した上で、UI上の同時表示を意図的に避けた（AdSenseポリシー上、過剰な広告表示を避ける判断）。
- GA4計測IDは`NEXT_PUBLIC_`プレフィックス（クライアントバンドルに埋め込み）。計測IDはGoogle Analytics側の仕様上ページに公開される識別子であり秘密情報ではないため意図的な設計（`.env.example`にもその旨を明記）。
- Cookie同意の選択肢は「同意する」「拒否/後で」の2択のみ（ベンダー別詳細設定は仕様範囲外のため未実装）。
- 広告コード(`AD_SLOT_*`)・GA4計測タグはいずれも運営者がenvに設定した信頼値のみを`dangerouslySetInnerHTML`/`next/script`に渡しており、記事本文・コメント等の閲覧者入力は一切混ぜていない（既存`AdSlot`/`BlogRankingSlot`と同じ安全設計を踏襲）。

## 追加したテスト
- `src/lib/__tests__/ads-config.test.ts`: 全`AdSlotPosition`に対する`ENV_KEYS`/`POSITION_LABELS`の網羅性、新種広告枠の`getAdSlotCode`の未設定/空白/trim挙動。
- `src/lib/__tests__/ads-anchor.test.ts`: アンカー広告の閉じた状態判定(`isAnchorAdDismissed`)・表示可否判定(`shouldShowAnchorAd`)の純関数テスト。
- `src/lib/__tests__/consent.test.ts`: Cookie同意状態のパース(`parseConsentStatus`)・バナー表示可否(`shouldShowConsentBanner`)・トラッキング許可判定(`isTrackingAllowed`)の純関数テスト（同意/未同意/拒否の3状態を網羅）。
- `src/lib/__tests__/analytics.test.ts`: GA4計測ID読み込み(`getGaMeasurementId`、未設定/空白/trim)・GA4読み込み可否判定(`shouldLoadAnalytics`、同意×ID設定の4パターン全組み合わせ)の純関数テスト。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
