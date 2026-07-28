---
tags: [sprint-selfeval]
sprint: patch-s4
---

# パッチ記事刷新S4 自己評価レポート

## 実装した内容
- `src/components/article-body-view.tsx`
  - `ArticleBodyView` が本文に `patchChange` ブロックを1つでも含む場合（=公式パッチノート由来のdetailed記事）だけ、本文全体を `data-lol-patch` ラッパ（紺→黒のグラデ地 `from-[#091428] to-[#010A13]`・金文字 `text-[#CDBE91]`・角丸・パディング）で囲む（F-S4-1）。含まない記事（反応記事・一般Riotニュース等）は従来のまま何も変わらない。
  - `PatchChangeBlockView`（対象カード）: 上辺2px金ライン（`border-t-[#C89B3C]`）・面`#091428`・金薄枠`#463714`、対象アイコンは金の太枠(円形)、対象名は金文字太字`#F0E6D2`、directionバッジ（強化=teal地/弱体化=赤地/調整=金地）、intentは金寄りの控えめ斜体。スキル行はスキルアイコン（金枠・角丸）＋abilityName金文字＋`stat：before ⇒ after`をspan分割し、before=`#9AA0A6`（弱めグレー）・⇒矢印=金・after=direction色（buff=teal/nerf=赤/adjust=金）で色分け（F-S4-2）。逐語のテキスト自体は変更せず、色分け用にspanで囲んだのみ。
  - 3グループ見出し（主な強化=teal下線・主な弱体化=赤下線・その他の調整=金下線）、目次(toc)・公式リンクボタン(linkButton)はパッチ記事本文内でのみLoL意匠（紺地・金/teal）に切り替え、非パッチ記事では従来の配色のまま（`lol`propで分岐、この2つは他記事とも共用のブロックのため）。冒頭サマリ段落（本文中最初のparagraphブロック）も紺地金文字のカードにする（F-S4-3）。
- `src/app/globals.css`: `[data-lol-patch]` スコープにLoLカラートークン（research §5.1準拠、CSS変数）を追加。ドキュメント目的＋スコープの単一の真実源。実際の配色はarticle-body-view.tsx側のTailwind任意値(hex直書き)で適用。
- `src/components/__tests__/article-body-view.test.tsx`: S4向けテストを追加。既存のS2/S3テスト2件（before/after逐語の literal string 一致検証）は、色分けのためのspan分割で文字列がタグ分断される影響を受けるため、タグ除去後の逐語一致検証に更新（値そのものは不変）。

## 技術選定
- 純CSS/Tailwind任意値のみで実装（AI・新規npm依存なし、brief制約どおり）。
- 色分けは「見出しテキストの先頭一致」（"主な強化"/"主な弱体化"）で3グループの下線色を判定。compose.ts側の固定文言に依存する軽量な決定論ロジック（新規フィールド追加なし、DBスキーマ変更なし）。
- Tailwindの静的スキャン対策として、direction別のクラス文字列は `PATCH_DIRECTION_STYLE` オブジェクトに完全な形（`"border-[#0AC8B9]"`等）で定義し、実行時に文字列を分割結合で生成しない（テンプレートリテラル内で参照する場合も、参照元の完全な文字列がソース中に literal で存在することを確認済み）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（107ファイル/1424テスト）・`npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（エラー0、警告6件は本スプリント無関係の既存警告）。
- [x] パッチ記事本文が黒/紺地＋金/tealのLoL公式風で表示され、対象/スキルアイコンが金枠、変更前後がcolor分け、公式リンクボタンがLoL意匠になる。一覧・他記事・ヘッダは従来ライトのまま不変（実サーバーでの目視確認、下記参照）。
- [x] コントラストAA・レスポンシブ崩れなし・AI不使用・逐語維持・DBスキーマ変更なし・新規依存なし。

## パッチ本文スコープの確認（実ブラウザ・実DB経由）
- 一時的に `patchChange`/`toc`/`linkButton`/3見出しを含む検証用記事（slug: `temp-s4-preview-patch`）をdev.dbに挿入し、`npm run dev`で実際にレンダリングして確認後、記事を削除（DBは元の14件に復元済み）。
- `/articles/temp-s4-preview-patch` のHTML出力を確認:
  - `data-lol-patch="true"` ラッパに `from-[#091428] to-[#010A13]` グラデ・`text-[#CDBE91]` が適用されている。
  - directionバッジ: 強化`bg-[#0AC8B9]`・弱体化`bg-[#E84057]`・調整`bg-[#C8AA6E]`。
  - before/after: `data-patch-before class="text-[#9AA0A6]"` → `data-patch-arrow class="text-[#C8AA6E]"` → `data-patch-after class="text-[#0AC8B9]/[#E84057]/[#C8AA6E]"`（direction別）。
  - 3グループ見出し: `<h2 id="sec-1" class="...border-[#0AC8B9]">主な強化`、`sec-2 border-[#E84057]">主な弱体化`、`sec-3 border-[#C8AA6E]">その他の調整`。
  - 公式リンクボタン: `data-link-button class="...border-[#C8AA6E] bg-[#091428] ... hover:bg-[#C8AA6E] hover:text-[#091428]"`、ラベル`▶ パッチ26.14 公式パッチノートを読む`。
- スコープ漏れ確認: 同じページ内の `<header data-site-header>` は `bg-neutral-900`（LoL色なし、不変）。トップページ(`/`)・別記事(`/articles/patch-2614-jungle-nerf-hikkuri-kaeru`、patchChangeブロックを含まない旧形式記事)には `data-lol-patch` が0件（`grep -c`で確認）。
- コントラストAA（相対輝度計算で確認、背景`#091428`基準）: `#F0E6D2`=14.84:1、`#C8AA6E`=8.26:1、`#CDBE91`=9.95:1、teal`#0AC8B9`=8.73:1、nerf赤`#E84057`=4.64:1、before灰=当初`#7A7A7A`(4.28:1、AA未達の恐れ)だったため`#9AA0A6`(6.96:1)に変更しAA(4.5:1)を確保。

## アプリの起動方法
- `npm run dev`（http://localhost:3000）。パッチ記事は `sourceType="riot"` かつ公式パッチノートDOM抽出に成功した記事本文（`patchChange`ブロックを含む）で自動的にLoL意匠になる。現在のdev.dbには該当記事が無い（S1〜S3の生成パイプラインが実パッチノートHTMLを収集した際に生成される）ため、evaluatorが実機確認する場合は本レポートと同様に一時的な検証用記事を挿入するか、`npm run generate`等でriot由来の実パッチ記事を生成する必要がある可能性がある。
- テスト: `npx vitest run`。型検査: `npx tsc --noEmit`。ビルド: `npm run build`。lint: `npm run lint`。

## 既知の問題・懸念点
- 現状のdev.db(14記事)には`patchChange`ブロックを含む実記事が存在しない（旧形式のパッチ記事のみ）。今回の確認は一時的に検証用記事を挿入→削除して行った（DBは元の状態に復元済み、コミット対象に混入していないことを`git status`で確認済み）。evaluatorが実ブラウザで確認する際も同様の対応（検証用記事の一時投入、または実パッチ記事の生成）が必要になる可能性がある。
- 3グループ見出しの下線色判定は見出しテキストの先頭一致（"主な強化"/"主な弱体化"）に依存する軽量ロジックのため、将来compose.ts側の見出し文言を変更する場合はここも追従が必要（現状は一致している）。
- ability icon（スキルアイコン）の枠色は brief に明記の無い部分だったため、対象アイコンより控えめな金`#785A28`を自己選択した（brief該当箇所: 「スキルアイコン(小・角丸枠)」に色指定なし）。

## 追加したテスト
- `src/components/__tests__/article-body-view.test.tsx` に新規describe「ArticleBodyView（LoL公式風パッチ意匠、パッチ記事刷新S4）」を追加（11件）: data-lol-patchラップ・スコープ漏れ無し・対象/スキルアイコン金枠・directionバッジ3色・before/after/⇒色分け・3グループ見出し下線色・冒頭サマリカード・toc LoL化・公式リンクボタンLoL化＋▶ラベル・画像max-width保持。
- 既存S2/S3テスト2件（`2 ⇒ 2.5`等のリテラル一致）は、色分けのためのspan分割に伴いタグ除去後の一致検証に更新（逐語の値自体は不変であることを確認）。

## 関連ドキュメント
- [[patch-s4-brief]]（本スプリントの仕様抜粋）
- [[patch-accuracy-research]]（デザイン根拠 §5・§7 S4）
