# reactqual-S4 — 5ch反応のレスを「新しめ/活発な会話」優先に（バグ2）

実データで確認したバグ2の修正。5ch反応で古いレス（58・61番等）が選ばれ、直近の活発な議論でない。5chの選定を**新しめのレス優先＋アンカー文脈**にする。既存の統一関数 `selectScoredAnchorReses`（resel-S2）を5chにも流用し、**レス番号を疑似score（新しい＝高score）**として使う。

## 根本原因（確定）
- 5chは `compose.ts` `buildReactionBlocks` で `selectMajorConversationCluster`（`>>N`アンカーの最大連結クラスタ・同サイズは最小レス番号タイブレーク）を使うため、序盤の古い大きな流れを拾いやすい。5chは score 常時0で resel-S2 の統一選定対象外に据え置かれ、recency（新しさ）を一切加味していなかった。
- 収集層 `selectHighlightReses`（`fivech.ts`）で既に被参照の多いレス（最大30件）に絞り込み済みなので、選定層で「その中の新しめ」を優先すれば直近の活発な議論になる。

## 含まれる機能

### F-RQ4-1: 5chを統一選定（selectScoredAnchorReses）に載せる（compose.ts buildReactionBlocks）
- 現行の統一選定分岐（`useUnifiedRedditSelection = sourceType === "reddit" && mode !== "llm"` 相当）を **「reddit **または 5ch** かつ rulesモード」** に拡張する。
- items 構築を**ソース別に分岐**:
  - **reddit（現行どおり不変）**: `score: res.score ?? 0`、`parentIndex: res.parentNumber → numberToIndex(該当) ?? null`。
  - **5ch（新規）**: `score: res.number`（＝レス番号を疑似score。**新しい番号＝高score＝優先**）、`parentIndex:` は `extractAnchors(res.lines)` の中で `numberToIndex` に存在し自己参照でない**先頭の番号 → index**、無ければ `null`。
- `target = reactionMaxReses()`（既定12）、`anchorDepth = reactionAnchorDepth()`（既定1）、`hardCap = target+3` は現行同値。
- これにより 5ch は **primary=新しめの活発レス**、context=その参照先（親）で会話が繋がる。**チェーン整合順（親→子）**で出力。
- **`selectMajorConversationCluster` は削除しない**（`REACTION_SELECT_MODE=llm` 経路やredditでない他用途の互換のため残す。ただし5ch rulesは新選定を使う）。
- **llmモード（`REACTION_SELECT_MODE=llm`）の5chは従来どおり `selectReactionReses`**（AI選定）を使う（不変）。

## 制約・非目標
- **逐語・アンカー文脈・強調（orange/red）・S3の空レス非掲載ガード・本文保持は不変**（本S4は5chの選定順のみ変更）。reddit/X/riotの選定・NG・moderationは不変。
- **S3の再現テスト（#102に本文が出る）が引き続き通る**こと（新しめ選定でも101〜104チェーンは 104(新)＋親101〜103 が文脈で選ばれ、#102本文は保持される）。
- 収集層 `selectHighlightReses`（被参照上位絞り込み）は不変。件数上限（`reactionMaxReses`）・チェーン整合順維持。
- スキーマ変更なし・新規依存なし・LLM呼び出し増なし（決定論選定）。resel/X-reply/fetchopt/reactqual-S1〜S3bと整合。
- **留意（要検証）**: 収集層が被参照上位に絞っているため「スレ末尾の乙/落ちるぞ等の低価値レス」を拾う懸念は限定的。過剰変更は避ける。

## テスト（必須・fixture）
1. **5ch新しめ優先**: 番号の大きい（新しい）活発レス群と、古い連結クラスタ（小さい番号）を含む5chダンプで、`buildReactionBlocks("5ch", rulesモード, mockLLM)` の選定が**新しめレス優先**になり、古いクラスタだけに偏らない。親アンカーが文脈として含まれチェーン整合順（親→子）。
2. **5chで `>>N` からparentIndexが導出される**（parentNumber注釈が無くても本文の`>>N`から親を辿る）。自己参照・存在しない番号はnull。
3. **S3不変**: `102: >>101\nグレイブスのスモークスクリーンか？` を含む101〜104チェーンで #102 の本文が保持される（S3の再現テストがS4後も通る）。空レス非掲載ガード・逐語・強調維持。
4. **reddit/llm/X 不変**: reddit rulesは score=res.score のまま・5ch llm は `selectReactionReses`・X は現行どおり（回帰なし）。既存の compose/5ch/reddit テストが回帰しない（5chの選定順の変化は新仕様に合わせてテスト更新）。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. 5ch反応が**新しめ/活発な会話**（新しいレス優先＋親文脈）で表示される。reddit/X/llm経路・S3の本文保持/空レスガードは不変。
3. スキーマ/依存不変・LLM増なし・逐語/強調/moderation不変・他スプリント整合。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 5chが新しめ優先で選ばれる（古いクラスタ固定でない）・親文脈・チェーン整合順。S3の#102本文保持・空レス非掲載がS4後も維持。reddit/X/llm不変。
- 可能なら実機で5ch記事が直近の議論中心に見えることを確認。
- 受け入れ基準1〜3を満たす。
