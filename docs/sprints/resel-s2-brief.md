# resel-S2 — 統一レス選定「score優先＋アンカー文脈」（Reddit/X共通・目安12件）

Opus5設計のS2。S1で持ち回った score / parentNumber(reddit) / inReplyToId(X) を使い、Reddit・Xのレス選定を**「scoreの高いレスを選ぶ＋アンカーで連結した元レスを文脈として採用」**に統一する。**5chは従来クラスタ据え置き**。NG婉曲化はS3（本スプリントはNG処理を変えない）。**スキーマ変更なし・新規依存なし・LLM呼び出し増なし**（決定論選定）。

ユーザー確定要件（厳守）:
- **scoreの高いレスを選ぶ**（Reddit=コメントupvote score / X=likeCount）。
- **アンカーで連結したレスも採用**し、**その連結元（親）レスも文脈として採用**（会話が繋がって読める）。
- **記事に載せるレス数の目安＝10〜12件**（Reddit/X共通・env調整可）。

## 含まれる機能

### F-RS2-1: 統一選定関数（新規 `src/lib/generation/reaction-select.ts`）
ソース非依存の純関数 **`selectScoredAnchorReses(items, options)`** を新設:
- 入力 `items: { index: number; score: number; parentIndex: number | null }[]`、`options: { target: number; anchorDepth: number; hardCap: number }`。
- アルゴリズム:
  1. **primary** = index を score 降順ソート → 先頭 `target`（既定12）件。
  2. **context** = 各 primary の `parentIndex` を `anchorDepth`（既定1）段まで遡り、primary に無い祖先を追加（低scoreでも文脈として採用）。
  3. **selected** = primary ∪ context。`|selected| > hardCap`（既定 target+3=15）なら context のうち score が低いものから間引く。
  4. **出力順＝チェーン整合順**: primary を score 降順で走査し、各 primary について「selected に含まれる祖先を親→子の順で先に、その後自分」を emit（各indexは1回だけ）。＝**親レスが必ず子より前**に出て会話が繋がる。
- 決定論・AI不使用。`index`重複なし。空入力は空配列。

### F-RS2-2: Reddit を統一選定に載せる（compose.ts `buildReactionBlocks`）
- **reddit のときだけ**、既定(rules)モードの `selectMajorConversationCluster` を **`selectScoredAnchorReses`** に置き換える:
  - items = reses を `{ index, score: res.score ?? 0, parentIndex: res.parentNumber→numberToIndex(該当) ?? null }` に変換。
  - `target = REACTION_MAX_RESES`(既定12)、`anchorDepth = REACTION_ANCHOR_DEPTH`(既定1)、`hardCap = target+3`。
  - 得た selectedIndices を既存の後段（翻訳 `translateReactionLines`・NG削除 `buildReactionDisplayLines`・強調 `computeLineEmphasis`＋`applyMinColorFallback`）にそのまま渡す。**出力順はF-RS2-1のチェーン整合順**（既存の「index昇順」から変更）。
- **5ch は `selectMajorConversationCluster` 据え置き**（score常時0で選定が無意味なため。回帰なし）。
- `REACTION_SELECT_MODE=llm` のときは従来どおり `selectReactionReses`（AI選定）を使う（本スプリントで不変）。
- 既存の「文脈1階層追加ブロック（>>Nアンカーで参照先を足す）」は、reddit経路では `selectScoredAnchorReses` の context に一本化する（二重に文脈追加しない）。ただし `selection`(llm) 経路・5ch経路の既存文脈ロジックは壊さない。

### F-RS2-3: X を統一選定に載せる（compose.ts `buildXReactionBlocks` ＋ post-pipeline 配線）
- **プールの実配線（evaluator必須指摘）**: `post-pipeline.ts` の `fetchTopReplies` 呼び出しを **`fetchTopReplies(post.externalId, apiKey, { max: defaultRepliesPoolMax() })`** にし、`Post.media.xReplies` に**選定用の広いプール（既定15件）**を保存する（S1でexport済みの `defaultRepliesPoolMax`/`X_REPLIES_POOL_MAX`）。API呼び出し回数は不変（同一ページ内）。
- `buildXReactionBlocks`（compose.ts）で、保存済み `xReplies`（プール）から **`selectScoredAnchorReses`** で目安12件＋文脈に絞る:
  - items = xReplies を `{ index, score: likeCount, parentIndex: inReplyToId→同プール内でid一致するreplyのindex ?? null（親ポスト＝会話ルート参照や、プール外はnull） }`。
  - `target = REACTION_MAX_RESES`(12)、`anchorDepth`(1)、`hardCap = target+3`。
  - 選ばれた順（チェーン整合順）で reaction ブロック化（@handle＋👍/💬＋[返信]/[引用] は現状のまま・逐語維持）。翻訳（非日本語）・NG処理は現状のまま（NGはS3）。
- これにより X も「いいねの高いリプ/引用＋その連結元」を目安12件で表示する（現状の「プール全部＝最大8件をそのまま」から変更）。

### F-RS2-4: env
- `REACTION_MAX_RESES`（既定12・目安上限）、`REACTION_ANCHOR_DEPTH`（既定1・遡る段数）を追加（`.env.example`）。既存 `MAX_EXCERPT_RESES`(12) 等のハードコードがあれば `REACTION_MAX_RESES` に統一。`X_REPLIES_MAX` は下位互換で残す（表示上限は `REACTION_MAX_RESES` が主）。

## 制約・非目標
- **5ch選定は不変**（クラスタ据え置き）。**NG処理は変えない**（S3）。`REACTION_SELECT_MODE=llm` の AI選定経路は不変。
- **スキーマ変更なし・新規依存なし・LLM呼び出し増なし**（選定は決定論）。逐語維持・出典・moderation・hotness・G8 は不変。riot/riot-news経路は無関係。
- 表示順は reddit/X で**チェーン整合順**に変わる（意図した変更）。件数は目安12（±文脈）に変わる（意図した変更）。＝S2は「意図的な挙動変更」であり回帰扱いにはしない（5ch・llm経路・他ソースの回帰はゼロ）。

## テスト（必須・fixture）
1. `selectScoredAnchorReses`: score降順でtarget件選抜／親を1段(anchorDepth)遡って文脈追加／hardCap超過で低score contextから間引き／チェーン整合順（親→子・各index1回）／空入力空配列／親がnull（ルート/プール外）で落ちない。
2. reddit `buildReactionBlocks`: score上位＋親文脈が選ばれ、チェーン整合順で並ぶ。翻訳・NG削除・強調・applyMinColorFallbackが選抜レスに適用。**5chは従来クラスタのまま（不変）**。llmモードは`selectReactionReses`のまま。
3. X `buildXReactionBlocks`＋post-pipeline: `fetchTopReplies`に`max=defaultRepliesPoolMax()`が渡り`Post.media.xReplies`にプール保存、`buildXReactionBlocks`が`selectScoredAnchorReses`で目安12件＋文脈に絞る。inReplyToIdで親を辿る。@handle/評価/引用ラベル/逐語は不変。
4. 目安件数がenv `REACTION_MAX_RESES` で変わる。`REACTION_ANCHOR_DEPTH` で遡り段数が変わる。
5. 既存の compose/reddit/x/post-pipeline/5ch/reddit/X反応テストのうち、**5ch・llm経路・他ソースが回帰しない**こと（reddit/Xの選定・順序・件数の変化は新仕様に合わせてテスト更新）。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. Reddit・Xとも「scoreの高いレス＋アンカー連結の元レス」を目安10〜12件・チェーン整合順で表示する。5ch・llm経路は不変。
3. スキーマ変更なし・新規依存なし・LLM増なし・逐語/出典/moderation/hotness/G8不変。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- **Playwrightで実機確認**: reddit（海外の反応）と X（xReplies入りをseed）記事で、score上位＋親文脈のレスが目安12件・親→子順で崩れず表示（標準/ニュース/Hextech）。5ch記事が従来どおり。
- 統一選定・Xプール実配線（Post.media.xRepliesが広いプール）・env調整を確認。受け入れ基準1〜3を満たす。
