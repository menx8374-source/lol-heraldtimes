---
tags: [sprint-selfeval]
sprint: growth-g3
---

# 成長G3 自己評価レポート

## 実装した内容
- F-G3-1: `classifyChange`（`⇒`前後の数値・スラッシュ複数値を合計比較、`LOWER_IS_BETTER_TERMS`＝クールダウン/CD/再使用/マナ/コスト/消費/詠唱時間を含む行は増減解釈を反転、数値抽出不能・個数不一致はunknown、同値はadjust）と`classifyChampion`（buff/nerf混在または判定不能のみ→adjustに安全側で倒す）を`src/lib/generation/compose.ts`に追加（純関数・DB非依存・両方export）。
- F-G3-2: `composeDetailedPatchBody`をチャンピオン節ごとに`classifyChampion`で「主な強化」「主な弱体化」「その他の調整」の3グループに振り分け。空グループ非表示、順序=強化→弱体→調整、グループ内は抽出順（本文出現順）維持。各チャンピオンの画像＋逐語変更は従来どおり保持。非チャンピオン章（アイテム/システム等）は3グループの後に従来どおり出力。
- F-G3-3: 3分類の集計（buff/nerf/adjust体数・otherセクション数）から純テンプレで冒頭1文サマリを生成し、バナー画像直後・目次の前に挿入。0体/0件の項目は文から省略。チャンピオン変更が無いパッチ（システムのみ）は非チャンピオン件数のみのサマリになる。
- F-G3-4: `ArticleBodyBlock`に`{ type: "toc"; items: { label; anchor }[] }`を追加、`heading`に任意`anchor?: string`を追加（後方互換・省略時は従来どおり）。`composeDetailedPatchBody`が出力する全ての章見出し（3グループ見出し・各チャンピオン見出し・非チャンピオン章見出し）に決定論的な連番anchor（`sec-1`, `sec-2`…）を付与し、それらを集めたtocブロックをサマリ直後に配置。`article-body-view.tsx`で`anchor`付きheadingを`<h2 id={anchor}>`、tocを`<nav aria-label="目次">`＋ページ内リンク(`<a href="#anchor">`)としてレンダリング。`parseArticleBody`にtoc/heading anchorの検証を追加、`blockText`にtoc対応（items.labelを改行連結）を追加。
- 既存の`extractPatchSectionsDeterministic`・チャンピオン画像挿入（E53/E54）・逐語抽出ロジックには一切手を加えていない（brief指示どおり）。

## 技術選定（該当する場合のみ）
- 新規ライブラリなし。すべてTypeScript純関数＋既存のReact/Tailwindコンポーネントパターンに追従（architect確定のNext.js/TypeScriptベースラインをそのまま踏襲）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run`（全1228件Green、既存98ファイル含む）・`npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（エラー0、既存の無関係warning6件のみ残存）を実行し確認した。
- [x] 基準2: detailedパッチ記事が「バナー画像 → 冒頭1文サマリ → 目次 → 主な強化/主な弱体化/その他の調整（各チャンピオン画像＋逐語）→ 非チャンピオン章」の順で生成されることをテストで確認（`generation-compose-g3-patch-classify.test.ts`・`generation-compose-detailed-patch.test.ts`）。
- [x] 基準3: 反転ステータス（クールダウン/CD/再使用/マナ/コスト/消費/詠唱時間の増減反転）を専用テストで確認。曖昧（buff/nerf混在、数値抽出不能のみ）はadjustに倒れることを確認。変更テキストは逐語のまま（部分文字列一致）であることをテストで確認。目次のitemsが全headingのanchorを指し、`<a href="#anchor">`と`<h2 id="anchor">`が対応することをテストで確認。
- [x] 基準4: AI不使用（分類・サマリ・目次は数値/テンプレ純ルールのみ、LLM呼び出しなし）。DBスキーマ変更なし・新規依存なし。fact/summaryモード・非パッチ記事（5ch/reddit反応記事）・既存記事（anchor/toc無し）の表示が不変であることをテストで確認（`toc`ブロックが出ない・headingにanchorが付かないことを確認）。

## アプリの起動方法
- 型チェック: `npx tsc --noEmit`
- テスト: `npx vitest run`
- ビルド確認: `npm run build`
- 実機確認する場合: `npm run build && npm run start`（既定ポート3000、`http://localhost:3000`）でパッチ記事（`/articles/[slug]`、sourceType=riot・PATCH_ARTICLE_MODE未設定=detailed既定）を開き、冒頭サマリ・目次・3グループ見出し・目次リンク遷移を確認できる。
- 本スプリントでは自己確認用にサーバーを起動していない（Vitestの純関数テスト・renderToStaticMarkupによるコンポーネントテストのみで検証したため、起動・停止は不要だった）。

## 既知の問題・懸念点
- 実データ級のパッチテキスト（アジール攻撃力55⇒58=buff、ガレン確定ダメージ150/250/350⇒130/230/330=nerf、セナのダメージ増加(buff)＋クールダウン増加(反転語でnerf)混在=adjust）で3分類・冒頭サマリ・目次・逐語保持を`generation-compose-g3-patch-classify.test.ts`で自己確認済み。反転ステータス（クールダウン/CD/再使用/マナ/コスト/消費/詠唱時間の両方向）は`classifyChange`の単体テストで6パターン以上、逐語保持（部分文字列一致）は既存detailed-patchテストと新規テストの両方で確認済み。目視でのブラウザ実機確認（実際にリンククリックしてページ内スクロールすること）は未実施（Playwright未使用のため）。evaluatorでの実機検証を推奨。
- `classifyChange`の数値抽出は「⇒直前の末尾の数値並び／直後の先頭の数値並び」を正規表現でbest-effort抽出する設計。ラベル内に数字を含む極端なケース（例: 「R2発動」のような数字を含むスキル名が⇒直前にある場合）は稀に誤抽出し得るが、その場合も個数不一致でunknownに倒れるか、誤った基準値比較になる可能性はゼロではない。実データ検証（既存fixture・新規fixtureとも）では問題は確認されなかった。
- テスト用DB（`prisma/test.db`）はvitest実行時に自動生成される既存の仕組みで、今回変更していない。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-compose-g3-patch-classify.test.ts`（新規、24件）: `classifyChange`（buff/nerf/adjust/unknown・スラッシュ複数値・反転ステータス全6語・個数不一致）、`classifyChampion`（全buff/全nerf/混在adjust/全unknown adjust）、`composeDetailedPatchBody`の3グループ振り分け・冒頭サマリ集計（0件省略含む）・目次anchor整合・fact/summaryモード不変・非パッチ記事不変・`blockText(toc)`。
- `src/lib/__tests__/article-body.test.ts`（追記）: heading anchorのパース（省略時後方互換・付与時・空文字エラー）、tocブロックのパース（正常・items空/label空/anchor空のエラー）、`blockText`のtoc対応。
- `src/components/__tests__/article-body-view.test.tsx`（追記）: anchor付きheadingの`<h2 id>`描画、anchor無しheadingの回帰なし、tocの`<nav aria-label="目次">`＋ページ内リンク描画、未知型混入時に例外を投げないこと。
- `src/lib/__tests__/generation-compose-detailed-patch.test.ts`・`generation-compose-e54-other-sections.test.ts`（既存修正）: G3で構造が変わった箇所（旧「パッチXの変更点」見出し＋導入段落 → 冒頭サマリ＋目次＋3グループ見出し）に合わせてアサーションを更新。それ以外のアサーション（画像位置・逐語保持・linkButton位置・id不明チャンピオンのフォールバック等）は変更していない。

## 関連ドキュメント
- [[growth-g3-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
