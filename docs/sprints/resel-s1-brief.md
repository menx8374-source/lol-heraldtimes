# resel-S1 — レス選定の基盤配管（score・アンカーをcompose段階まで持ち回る／選定挙動は未変更・スキーマ変更なし）

Opus5設計のS1。S2の「score優先＋アンカー文脈」統一選定に必要な**データ配管**だけを作る。**この時点では選定・表示の挙動は変えない**（データが通るだけ＝回帰ゼロ）。**スキーマ変更なし**（既存のスレッドダンプ文字列＋`Post.media` JSON）。**LLM呼び出し増なし**（決定論）。

## 背景（現状の事実）
- Reddit: `selectTopComments`（reddit.ts）がscore降順で上位20コメントを選び、`buildRedditThreadDump`が`"1: OP\n\n2: body\n\n3: body…"`を生成→`Post.body`。**scoreはダンプに載らず、`>>N`アンカーも無い（フラット）**。
- compose: `parseThreadReses`（thread-format.ts）が`ThreadRes{number,lines}`にパース（**scoreなし**）。
- X: `XReplyItem`（x.ts）は`likeCount`等を持つが**`inReplyToId`が無い**（会話チェーン解決不可）。`fetchTopReplies`はlike降順→`X_REPLIES_MAX`(8)で打ち切り。

## 含まれる機能

### F-RS1-1: ThreadRes に score を持たせる（thread-format.ts）
- `ThreadRes` に **任意フィールド `score?: number`** を追加。
- レス開始行の正規表現を **`N: body` と `N (score:M): body` の両方**に一致するよう拡張し、`parseThreadReses` が `(score:M)` があれば `score` に読み取る（無ければ `undefined`）。`M` は負値も許容（redditは負scoreあり）。
- **注釈は本文（lines）に混入させない**（scoreはパース時に剥がし、表示・タイトル生成に出さない）。既存の `extractAnchors`/`computeLineEmphasis`/`threadBodyText` は不変。
- 後方互換: `(score:M)` 注釈の無い既存ダンプ・5chダンプ・fixtureはそのまま一致し `score=undefined`（回帰なし）。

### F-RS1-2: Reddit ダンプに score 注釈と親アンカーを埋める（reddit.ts）
- `buildRedditThreadDump` のレス行を **`"N (score:M): body"`** 形式に拡張（score が取得済みのコメントのみ。OP行=1は付けなくてよい）。
- **親アンカー**: `RedditCommentData` に **`parent_id?: string`** を追加。`comments/search` の応答が親IDを返す場合、親が「別コメント（OP＝res#1ではない）」のときだけ、そのコメント本文の**先頭に `>>N`（親コメントのres番号）を1行付与**する（`extractAnchors` がそのまま解釈できる形）。
  - **要検証**: Arctic Shift `comments/search`（`buildCommentsSearchUrl`）が `parent_id`（`t1_…`/`t3_…`）を返すか実応答/型で確認。**返さない/信頼できない場合はアンカー埋め込みを行わず**、score注釈のみにする（S2はscore優先のみで動く＝回帰なし）。自己評価に「parent_id有無と対応」を明記。
- `selectTopComments`（score降順＋議論枠）は**不変**。5chダンプは注釈もアンカーも付けない（従来どおり）。

### F-RS1-3: X に inReplyToId を配線（x.ts）
- `XReplyItem` に **任意フィールド `inReplyToId?: string`** を追加（`GetXApiTweet.inReplyToId` は型に既存。`toXReplyItem` で**逐語保持**。実値の有無は要検証・自己評価に記載）。
- `fetchTopReplies` の取得プール上限を、S2の選定（目安~12＋文脈余白）に足りるよう **少し広げる**（例 15件。`X_REPLIES_MAX` は下位互換で残しつつ、選定用プールはそれ以上取れる形にする。追加コストは同一ページ内なので**API呼び出し回数は増えない**＝1〜2コールのまま）。
- `buildXReactionBlocks` の**表示挙動は変えない**（S2で統一選定に載せる）。`Post.media.xReplies` にプールを保存する既存経路（S2済み）はそのまま。

## 制約・非目標
- **選定・表示の挙動は一切変えない**（S1はデータを通すだけ）。5ch/reddit/X・他記事・既存表示は回帰ゼロ。
- **スキーマ変更なし**（ダンプ文字列＋Post.media JSON）・**新規npm依存なし**・**LLM呼び出し増なし**。
- **逐語維持**（score注釈・アンカー行はパース時に剥がし表示に出さない。リプ本文・数値はそのまま）。hotness・G8収集足切り分離は不変。

## テスト（必須・実HTTP非依存・fixture）
1. `parseThreadReses`: `N (score:M): body` を score付きでパース、`N: body`（注釈なし）は `score=undefined`。負値scoreも読む。score注釈が `lines` に混入しない。既存の複数行・`>>N`・OPパースが回帰しない。
2. `buildRedditThreadDump`: scoreありコメントは `(score:M)` 付き、親が別コメントなら本文先頭に `>>N` 付与、親がOPなら付けない。`parent_id` 無し入力では注釈のみ（アンカー無し）で落ちない。5ch経路のダンプは不変。
3. `toXReplyItem`/`fetchTopReplies`: `inReplyToId` が保持される。プール上限が拡大しても既存のlike降順・dedup・失敗フォールバックが不変。API呼び出し回数（クエリ数）が増えない。
4. 既存の thread-format / reddit / x / compose / post-pipeline / 5ch・reddit・X反応テストが**全て回帰しない**（表示・選定は不変）。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. Redditコメントの score と親アンカー（取得可能な場合）、Xリプの `inReplyToId` が compose 段階まで持ち回れる。**選定・表示・件数は現状のまま（回帰ゼロ）**。
3. スキーマ変更なし・新規依存なし・LLM増なし・逐語維持・hotness/G8不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。UIを持たないデータ配管のため検証モードは「テスト＋静的確認」で可（Playwright不適用）。
- score/アンカー/inReplyToIdの持ち回りが実装され、**選定・表示・件数がS1で不変（回帰ゼロ）**。parent_id/inReplyToIdの要検証結果が自己評価に記載されている。
- 受け入れ基準1〜3を満たす。
