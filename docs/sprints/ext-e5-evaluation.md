---
tags: [sprint-evaluation]
sprint: ext-e5
result: PASS
---

# Sprint E5（収益化拡充）評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・本番ビルド起動）
- ダミーenv（`AD_SLOT_SIDEBAR_STICKY`/`AD_SLOT_ANCHOR`/`AD_SLOT_MATCHED_CONTENT`、`NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXTEST`）を`.env`に設定→`npm run db:seed`→`npm run build`（env埋め込みのため再ビルド）→`npm run start`（:3000）。検証後にサーバー停止・`.env`復元・DB再seed済み。
- 補足: Playwright MCPにビューポート変更/resizeツールが無く、起動時ビューポートが1920幅固定のため、アンカー広告（`lg:hidden`＝モバイル専用）の「実画面での可視表示」はピクセル確認できず、DOM/React挙動レベルで検証した（下記「未検証項目」参照）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全観点で期待通り動作。ブロッカーなし |
| コンソールエラー0件 | PASS | 全操作を通してconsole errors/warnings 0件（`all:true`で確認） |
| 受け入れ基準充足率100% | PASS | 観点1〜4すべて充足（下記詳細） |
| テストGreen（全テスト成功） | PASS | `npm test`（vitest run）→ 47ファイル / 376 tests 全passed |

## 観点ごとの検証結果

### 1. 広告枠拡充（PASS）
- 追従サイドバー広告: PCサイドバー最下部に`STICKY_AD_TEST`表示、`lg:sticky lg:top-20`。`広告 / PR`ラベル＋`aria-label="追従サイドバー広告"`。スクロール（scrollY=1200）後も表示維持。
- インフィード広告: 一覧途中に`aria-label="インフィード広告"`枠が挟まる（`広告 / PR`ラベル付き、未設定のためプレースホルダ）。
- アンカー広告: `data-ad-slot="anchor"`がDOMに存在、`広告 / PR`＋`ANCHOR_AD_TEST`＋閉じるボタン（`aria-label="広告を閉じる"`）。desktop(1920)では`display:none`（`lg:hidden`、設計通り）。閉じるボタン押下→`localStorage['lol-matome:anchor-ad-dismissed']="1"`保存＆DOMから消滅、リロード後も非表示を確認。固定コンテナ側に`h-16`スペーサーがあり本文を覆い隠さない設計。広告コード未設定時は固定バーを出さない実装（`Boolean(anchorAdCode)`ガード）。
- マッチドコンテンツ: 記事末尾「関連記事」直下に`aria-label="関連コンテンツ"`枠、`広告 / PR`＋`MATCHED_AD_TEST`表示。

### 2. Cookie同意バナー（PASS）
- 初回訪問（同意未保存）で画面下部に`role=dialog aria-label="Cookie使用に関する同意"`が表示、プライバシーポリシー(`/privacy`)リンクあり、「拒否/後で」「同意する」の2択。
- 「同意する」→バナー消滅、`localStorage['lol-matome:cookie-consent']="accepted"`保存、リロード後も非表示。
- 「拒否/後で」→バナー消滅、`"rejected"`保存。
- consent削除→リロードでバナー再表示を確認（永続化の逆方向も正常）。

### 3. GA4の同意連動（最重要・PASS、ネットワーク観測で確認）
- 同意前（バナー表示中）: `googletagmanager.com`/`google-analytics.com`への通信0件（network requestsフィルタで確認）、`<script src*=googletagmanager>`もDOMに存在せず。
- 「同意する」直後: `GET https://www.googletagmanager.com/gtag/js?id=G-XXXXTEST => 200`、および`POST https://www.google-analytics.com/g/collect?...tid=G-XXXXTEST...en=page_view => 204` を観測。
- 同意済みでリロード: GAスクリプトが即読み込まれる（`gaScript:true`）、バナーは非表示。
- 「拒否/後で」後: `gaScript:false`、GA通信なし。

### 4. 回帰・分離（PASS）
- `/admin`: `data-ad-slot`要素数=0、同意バナーなし、GAスクリプトなし、GA通信0件（`SiteChrome`が`/admin`でBottomOverlayStack等を構造的にマウントしないため）。
- 既存機能: 記事一覧・注目記事・人気ランキング・新着コメント・人気タグ・月別アーカイブ・記事詳細（関連記事/コメント）正常表示。
- ダークモード表示崩れなし、横スクロールなし（scrollWidth==clientWidth=1905）。
- `npm run build`成功、コンソールエラー0件。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- インフィード広告は新規positionを追加せず既存`listing`のラベル整理にとどめる（self-eval既知事項）。現状で本文と区別できており問題なし。
- アンカー広告=モバイル/追従サイドバー=PC という役割分担でUI上の同時表示を回避（AdSenseポリシー配慮の自己判断）。仕様の意図と整合的で問題なし。

## 未検証項目（実機確認が必要）
- アンカー広告の「モバイル実画面での可視表示・タップでの閉じる操作」のピクセル確認: Playwright MCPにビューポート変更/resizeツールが無いため未実施。代替として、DOM上の枠存在・ラベル・閉じるボタン・React onClick経由の閉じる処理→localStorage保存→DOM除去→リロード後の非表示、を検証済み（`lg:hidden`は静的Tailwindクラスで実画面幅<1024pxでは表示される）。ロジック・永続化は問題なし。

## プレビュー画像
- `ext-e5-preview-1.png`（ダークモード・Cookie同意バナー表示）
- `ext-e5-preview-2.png`（スクロール後・追従サイドバー広告）

## 関連ドキュメント
- [[ext-e5-selfeval]]（ジェネレーターの自己評価レポート）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
