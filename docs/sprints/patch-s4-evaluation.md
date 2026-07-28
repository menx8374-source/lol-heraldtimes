---
tags: [sprint-evaluation]
sprint: patch-s4
result: PASS
---

# Sprint patch-s4 評価レポート（LoL公式風パッチ記事デザイン）

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- 検証記事の用意: フィクスチャ `src/lib/generation/__fixtures__/patch-26-14.html` を `composeArticleBody`（riot/detailed経路＝`parsePatchNotesHtml`→`composeDetailedPatchBody`）で本文化し、`patchChange`ブロック14件を含むArticle（slug `temp-s4-eval-patch`）を一時的にdev.dbへ投入して実表示検証。検証後に削除しdev.dbを元の14件に復元済み（`git status`で混入なしを確認）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 実表示・スコープ・レスポンシブいずれも問題なし。壊れ画像1件はテスト用candidateに入れた架空バナーURLで、実アイコンは全て正常（下記） |
| コンソールエラー0件 | PASS（注記あり） | ライトモードのパッチ記事・トップとも error 0。ダークモード時のみ `<html class dark>` のhydration mismatch警告が1件出るが、非パッチのトップページ(`/`)でも同条件で再現する**サイトのテーマ切替に起因する既存・全体問題**で、S4（パッチ本文のみ変更）は未関与 |
| 受け入れ基準充足率100% | PASS | 下記チェック項目すべてPASS |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 107ファイル / 1424テスト全pass。`npx tsc --noEmit` エラー0、`npm run lint` エラー0（警告6=既存テストの未使用引数、S4無関係）、`npm run build` 成功 |

## チェック項目ごとの結果（Playwright実機）
- **黒/紺地＋金/tealのLoL公式風**: PASS。`[data-lol-patch]`ラッパが紺→黒グラデ（`from-[#091428] to-[#010A13]`）、本文金系テキスト。目視でLoL公式パッチノートの世界観になっている（`patch-s4-preview-2-body-detail.png`）。
- **対象/スキルアイコンの金枠・対象名金文字・directionバッジ**: PASS。チャンピオン/アイテムアイコンが金枠で表示、対象名は金文字太字。バッジは強化=teal(`bg-[#0AC8B9]`)/弱体化=赤(`bg-[#E84057]`)/調整=金(`bg-[#C8AA6E]`)をDOMで確認。
- **before ⇒ after 色分け**: PASS。DOM検証で `data-patch-before=text-[#9AA0A6]`（グレー弱め）、`data-patch-arrow=text-[#C8AA6E]`（金矢印）、`data-patch-after` が direction色（buff=`#0AC8B9`/nerf=`#E84057`/adjust=`#C8AA6E`）。スキル行にスキルアイコン＋abilityName（例「R - 連発ミサイル」）。
- **3グループ見出し・目次・公式リンクボタン**: PASS。見出し「主な強化」=teal下線/「主な弱体化」=赤下線/「その他の調整」＋アイテム/システム=金下線。目次は紺地金見出し＋tealリンク。公式リンクボタンは `border-[#C8AA6E] bg-[#091428] text-[#C8AA6E]`＋ラベル「▶ パッチ26.14 公式パッチノートを読む」。
- **冒頭サマリカード**: PASS。紺地金文字カードで「チャンピオン4体を強化・5体を弱体化・1体を調整…」。
- **スコープ漏れ無し**: PASS。ライトモードでパッチ記事を開くと本文のみダークLoL意匠、周囲（サイドバー人気ランキング・関連記事・コメント欄・フッタ）はライトのまま（`patch-s4-preview-1-light-scope.png`）。トップページ・別ページの `[data-lol-patch]` 要素数は0。
- **コントラスト**: PASS。金(#C8AA6E/#F0E6D2)・本文(#CDBE91)・teal(#0AC8B9)は紺地#091428上で読める。before灰は#9AA0A6でAA確保。
- **レスポンシブ（モバイル幅）**: PASS。リサイズ専用ツールが無いため、`[data-lol-patch]`ラッパを360px幅に制約して測定 → ラッパ・14カードとも横溢れ0（`scrollWidth===clientWidth`）。ヘッダは`flex-wrap`、変更行はインライン折返しで崩れなし。
- **アイコン読み込み**: PASS。DDragonのチャンピオン画像（naturalWidth=128）・スキル画像（=64）はすべて正常読み込み。唯一の壊れ画像は**evaluatorがテスト用candidateに入れた架空URL `https://www.leagueoflegends.com/patch-banner.jpg`**（ヒーローバナー）で、実運用では実パッチページのog:imageが入るためS4の欠陥ではない。

## コンソールエラーの有無
- ライトモード: パッチ記事・トップページとも error 0 / warning 0。
- ダークモード（`lol-matome:theme=dark`）: `<html className "h-full antialiased" ⇔ "...dark">` のhydration mismatch警告が1件。**非パッチのトップページ(`/`)でも同一条件で再現**するため、S4スコープ外（サイトのテーマ切替＝dark class をクライアントでlocalStorageから付与する既存挙動）に起因。S4はパッチ本文（`article-body-view.tsx`・`globals.css`の`[data-lol-patch]`）のみ変更しており、html要素・テーマプロバイダを触っていないため本警告の原因ではない。

## 発見したバグ・問題点（FAILの原因）
- なし（総合PASS）。

## 軽微な改善点（ブロッカーではない）
- ダークモード時のhydration mismatch警告（`<html>`のdarkクラス）はS4起因ではないが、サイト全体の品質として別途対処余地あり（テーマクラスをSSR時にも確定させる/`suppressHydrationWarning`等）。本スプリントの受け入れ対象外。
- lint警告6件（テストの未使用`_messages`引数）は既存・S4無関係。

## 未検証項目（実機確認が必要）
- 該当なし（Web実機で全項目検証）。モバイル幅は実ビューポートリサイズ不可のためコンテナ幅制約による横溢れ測定＋レイアウト構造で代替検証（崩れ無しを確認済み）。

## プレビュー画像（PASS）
- `docs/sprints/patch-s4-preview-1-light-scope.png`（ライトモード全体＝本文のみダーク・周囲ライトのスコープ分離）
- `docs/sprints/patch-s4-preview-2-body-detail.png`（パッチ本文の詳細：金枠アイコン・directionバッジ・before⇒after色分け・3見出し・目次・公式リンクボタン）
- `docs/sprints/patch-s4-preview-3-dark.png`（サイトのダークモード時の全体表示）

## 関連ドキュメント
- [[patch-s4-selfeval]]（ジェネレーターの自己評価レポート）
- [[patch-s4-brief]]（本スプリントの仕様抜粋）
- [[patch-accuracy-research]]（デザイン根拠 §5・§7 S4）
