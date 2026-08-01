# reactqual-S3 — アンカー先頭レスの本文脱落＝空白レスを根絶（バグ3）

実データで確認したバグ3の修正。5ch反応で、元ダンプは
```
102: >>101
グレイブスのスモークスクリーンか？
```
の**2行**なのに、記事表示のreactionブロック#102は `lines=[{text:">>101"}]` だけで**本文「グレイブスの…」が消えて空白同然**になっていた。ユーザー要件: 「レスが空白は今後発生させない」。**本文を正しく出す**こと（＋実質空のレスは掲載しない保険）。

## 根本原因（要特定・確定させる）
Opus5の静的解析では、既定 `REACTION_SELECT_MODE=rules` では `selection=null` のため `extractedLinesByIndex` は全 `res.lines` を採るはずで、非NGの本文行が落ちる理由が**特定しきれていない（要検証）**。実記事はrulesモードで生成された（`GENERATION_MODE=live`・`REACTION_SELECT_MODE`未設定=rules）。想定される経路は複数:
1. llm keepLines がアンカー行indexだけを選ぶ（`REACTION_SELECT_MODE=llm`時。本番既定ではないが潜在経路）。
2. NG除去で本文文が全消（アンカー行`>>N`は決してNGにならず生き残る）。
3. 元レスが実質アンカーのみ（本文が絵文字/空白trim等で消える）。
4. **rulesモードで実際に本文行が落ちる未特定の経路**（今回の実記事の主因。要特定）。

**generatorは必ず、実記事と同じ入力（101〜104のアンカーチェーンを含む5chスレッドダンプ。特に `"102: >>101\nグレイブスのスモークスクリーンか？"`）を `buildReactionBlocks`（rulesモード・mock LLM）に通し、#102 の表示行に「グレイブスのスモークスクリーンか？」が含まれることを再現テストで確認すること。** 現状で落ちるなら真の脱落箇所を特定して直す（下記(a)(b)で塞げない経路が主因なら、その経路も修正する）。

## 含まれる機能

### F-RQ3-1: アンカー判定の純関数（thread-format.ts）
- `isPureAnchorLine(text: string): boolean` = `/^>>\d+$/.test(text.trim())`（アンカーのみの行）。
- `hasNonAnchorLine(lines: string[]): boolean` = 1行でも `isPureAnchorLine` でない非空行があるか。

### F-RQ3-2: 表示抽出でアンカーのみへ縮退させない（compose.ts・本文脱落の修正）
- `extractedLinesByIndex` 構築時（keepLines/行抽出後）に、**抽出結果に非アンカー行（本文）が1行も無ければ、そのレスの `res.lines` 全体（逐語本文）にフォールバック**する。これで llm keepLines がアンカー行だけを指定してもグレイブス本文が復元される。
- **さらに、rulesモードの再現テストで本文が落ちる場合はその真の原因（parse/選定/行抽出/NGバッチのいずれか）を特定して修正する**（本ブリーフの根本目的は「本文を出す」こと。(a)だけで直らなければ追加修正する）。逐語・アンカー文脈・強調（orange/red）は不変。

### F-RQ3-3: 空白レス掲載禁止の最終ガード（compose.ts・全経路・再発防止）
- `buildReactionBlocks`（5ch/reddit）と `buildXReactionBlocks`（X）の両方で、`cleanedLines` 確定後に「**`cleanedLines` が空、または全行が `isPureAnchorLine`（アンカーのみ）**」なら `return null`（そのレスは非掲載）。判定は `hasNonAnchorLine(cleanedLines.map(l => l.text))` を使う。
- これにより (2)(3) 由来のアンカーのみブロック・NG全消の空レスも確実に排除。Xはアンカー無しなので実質「NG全消の空レス」だけを弾く。
- 空になったレスを落としても他レス・番号採番（連番）・チェーン整合順は正しく維持する。

## 制約・非目標
- **本文を出すことが第一目的**（空レスを消すだけで本文を捨てない）。逐語・アンカー文脈・強調・moderation非保留は不変。**resel-S1〜S3/X-reply/fetchopt/reactqual-S1,S2 と整合**し壊さない。
- 5ch選定の「新しめ優先」への変更は**S4（別スプリント）**。本S3は「本文脱落の修正＋空レス禁止ガード」のみ（選定順は現状のまま）。
- スキーマ変更なし・新規依存なし・`dangerouslySetInnerHTML`不使用（本スプリントは生成側）。

## テスト（必須・実HTTP非依存・fixture）
1. **再現テスト（最重要）**: `"...101: 説明...\n\n102: >>101\nグレイブスのスモークスクリーンか？\n\n103: >>102\nいや違う...\n\n104: >>103\nこれ？..."` を含む5chダンプ → `buildReactionBlocks("5ch", rulesモード, mockLLM)` で、**#102 の lines に「グレイブスのスモークスクリーンか？」が含まれる**（本文が出る）。アンカー行`>>101`は文脈として残ってよい。
2. `isPureAnchorLine`/`hasNonAnchorLine` の真偽（`">>101"`→pure、`"グレイブス…"`→非pure、空→非非アンカー扱い）。
3. keepLines がアンカー行indexのみ指定（llm相当）→ 全 `res.lines` にフォールバックし本文が残る。
4. 元レスがアンカーのみ／本文がNG全消 → そのレスは**非掲載（null）**で、他レスは正常・連番/順序維持。
5. moderation非保留・逐語・強調（orange/red）維持。既存の compose/5ch/reddit/X反応テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. アンカー先頭レスでも**本文が表示される**（#102に「グレイブス…」が出る）。実質空（アンカーのみ/NG全消）のレスは掲載されない。逐語・アンカー文脈・強調維持。
3. スキーマ/依存不変・他スプリント整合・5ch選定順は現状のまま（S4で変更）。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- **再現テストで#102に本文が出る**こと・空レス（アンカーのみ）が非掲載になること・逐語/強調/moderation非保留を確認。可能なら実機で該当構成の記事に空白レスが無く本文が出ることを確認。
- 受け入れ基準1〜3を満たす。
