---
tags: [sprint-selfeval]
sprint: reactqual-S3
---

# reactqual-S3 自己評価レポート

## 実装した内容
- **F-RQ3-1**（`thread-format.ts`）: `isPureAnchorLine(text)`（`/^>>\d+$/`のみの行判定）・`hasNonAnchorLine(lines)`（非アンカー非空行が1つでもあるか）を新設。
- **F-RQ3-2**（`compose.ts`）: `extractedLinesByIndex`構築時、抽出結果に非アンカー行が無ければ`res.lines`全体へフォールバック（llm keepLinesがアンカー行のみ指定するケースの保険）。
- **真因の特定と修正（最重要）**: rulesモード（既定）でも「グレイブスのスモークスクリーンか？」が消える再現に成功。真因は**NGワードリストの「ブス」が実在するLoLチャンピオン名「グレイブス」に部分文字列として偶然一致し、`findNgWord`が差別語と誤検知していた**こと（NGバッチ経路＝brief記載の原因候補(2)）。既定`NG_REPHRASE_MODE=soften`でLLM(mock)言い換えが得られない場合、NG判定された文はまるごと削除されるため、非NGの本文文が丸ごと消えていた。
  - 修正: `ng-words.ts`に`findNgWordExcluding(text, exemptions)`を追加（既存`findNgWord`は無変更・後方互換）。`exemptions`（チャンピオン名一覧`CHAMPIONS`）に完全一致する箇所を無害な記号に置換してからNG照合するため、「グレイブス」のような偶然の部分一致は除外しつつ、「ゴミチャンピオン」のような単独NGワード＋別語の連結は従来どおり検出する。
  - `compose.ts`の`buildReactionLinesBatch`（NG文検出ループ）で`findNgWord`→`findNgWordExcluding(sentence, CHAMPIONS)`に置換。
  - **`moderate.ts`（`moderateArticleContent`のng_wordチェック）も同じ関数に置換**。理由: compose.tsだけ直すと「グレイブス」を含む本文が最終bodyTextに残るようになり、そのまま`moderateArticleContent`の従来`findNgWord`が同じ誤検知でその記事全体を`held`にしてしまう（brief必須invariant「moderation非保留」に違反する新規regressionになる）ため、根本原因（NG_WORDSのチャンピオン名衝突）を共有関数レベルで解消する必要があった。
- **F-RQ3-3**（`compose.ts`）: `buildReactionBlocks`（5ch/reddit）・`buildXReactionBlocks`（X）の両方で、`cleanedLines`確定後に空、または全行が`isPureAnchorLine`（`hasNonAnchorLine`で判定）なら`return null`（非掲載）。他レスの番号・連番・チェーン整合順は維持。

## 技術選定（該当する場合のみ）
- 新規依存追加なし。既存の`ng-words.ts`/`thread-format.ts`のパターンに倣い純関数を追加しただけ。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run`全Green（131 files / 1842 tests）・`tsc --noEmit`0エラー・`npm run build`成功・`npm run lint`0エラー（既存の無関係な警告7件のみ、error 0）。
- [x] アンカー先頭レスでも本文が表示される（#102に「グレイブスのスモークスクリーンか？」が出ることを再現テストで確認）。実質空（アンカーのみ／NG全消）のレスは非掲載。逐語・アンカー文脈・強調は既存テストで維持確認。
- [x] スキーマ変更なし・新規依存なし。5ch選定順（`selectMajorConversationCluster`）は不変（S4で変更予定、本S3では未変更）。他スプリント（resel-S1〜S3/X-reply/fetchopt/reactqual-S1,S2）との整合はテスト回帰ゼロで確認。

## 真因の特定結果（必須明記）
- **rulesモードで本文が落ちる真因**: NG誤検知（NGワード「ブス」がチャンピオン名「グレイブス」の部分文字列に一致）。extraction（F-RQ3-2のフォールバック）は今回の実記事バグの直接原因ではなかった（rulesモードではkeepLinesがそもそも`null`＝全行抽出のため）。
- **F-RQ3-2のフォールバックだけで直ったか**: **直らなかった**。フォールバック追加だけでは「グレイブスの…」の文自体がNGバッチ（`buildReactionLinesBatch`）で削除される経路を塞げないため、追加修正として`ng-words.ts`に`findNgWordExcluding`を新設し、`compose.ts`のNG検出と`moderate.ts`のng_wordチェックの両方をこれに差し替えた（後者を直さないと、本文を残す修正がそのまま記事全体の`held`化という新たな回帰を生むため必須だった）。
- F-RQ3-2のフォールバック自体は、`REACTION_SELECT_MODE=llm`でLLMがアンカー行indexだけをkeepした場合の保険として有効に機能する（別テストで確認済み）。

## アプリの起動方法
- テスト実行: `npx vitest run`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- 開発サーバーは今回の検証で起動していない（compose.ts/thread-format.ts/ng-words.ts/moderate.tsの純関数テストのみで検証可能なため）。実機確認が必要な場合は `npm run dev`（既定ポート3000）。

## 既知の問題・懸念点
- 本スプリントの明示的な実装対象ファイルは`thread-format.ts`・`compose.ts`だったが、真因の特定の結果、共有モジュール`ng-words.ts`（新関数追加のみ、既存`findNgWord`は無変更）と`moderate.ts`（ng_wordチェックの1行差し替え）にも変更が及んだ。理由は自己評価レポート「真因の特定結果」に記載のとおりで、compose.ts単体の修正では「moderation非保留」invariantを壊す新規回帰を生むため不可避と判断した。オーケストレーターの判断が必要であれば差し戻しを検討されたい。
- チャンピオン名とNGワードの衝突は全87件のCHAMPIONS走査で「グレイブス」の1件のみ確認（他の衝突なし）。将来チャンピオンが追加され新たな衝突が生じた場合も`findNgWordExcluding`のCHAMPIONS除外ロジックがそのまま機能する想定。
- タイトル生成側（`title.ts`のstripNgWords経由の処理）は本スプリントのスコープ外のため変更していない。理論上「グレイブス」を含むタイトルではstripNgWordsが「ブス」部分を除去し「グレイ」のような欠損表記になり得るが、これは本反応レス表示バグとは別経路であり、次スプリント以降の課題として残す（実際に発生しているかは未確認）。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-thread-format.test.ts`: `isPureAnchorLine`/`hasNonAnchorLine`の単体テスト。
- `src/lib/__tests__/generation-compose-reactqual-s3.test.ts`（新規）: 再現テスト（#102本文確認）・真因確認（通常NGは従来どおり検出）・moderation非保留確認・keepLinesアンカーのみ→フォールバック・アンカーのみ/NG全消レスの非掲載＋順序維持（5ch・X両方）・既存回帰（逐語・強調・アンカー文脈）。
- `src/lib/__tests__/moderation.test.ts`: `findNgWordExcluding`の単体テスト＋`moderateArticleContent`でのグレイブス非保留確認を追記。

## 関連ドキュメント
- [[sprint-reactqual-s3-brief]]（本スプリントの仕様抜粋、docs/sprints/reactqual-s3-brief.md）
