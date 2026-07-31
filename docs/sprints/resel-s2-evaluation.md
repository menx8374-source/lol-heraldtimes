---
tags: [sprint-evaluation]
sprint: resel-S2
result: PASS
---

# Sprint resel-S2 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- Playwright MCPツールが本セッションに露出していなかったため、スクラッチ配下の `playwright` パッケージ（既存インストール・プロジェクト不変）から共有Chromium（`ms-playwright`キャッシュ）を起動して実機検証した。ブラウザ操作・DOM検証・コンソール/ネットワーク監視・スクリーンショットはすべて実施済みで、検証内容の縮退はない。
- 検証手順: dev DBに検証用Post/Articleをmock生成でseed → `npm run dev`（:3000）で3デザイン×3記事＋一覧5ページを実操作 → 検証後にseedデータ・一時スクリプト・一時PNGを全削除し、dev serverを停止（ポート3000解放・`git status`はスプリント成果物のみ）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | reddit/X/5ch記事＋一覧5ページ（`/`・`/category/overseas`・`/category/x`・`/category/5ch`・`/archive`）で例外・レイアウト崩れ・4xx/5xxなし。1280px/375pxとも横スクロールなし（`scrollWidth==clientWidth`）。 |
| コンソールエラー0件 | PASS | 全ページ・全デザインで console error/warning・pageerror・requestfailed が0件。唯一検出された404（`cdn.syndication.twimg.com/tweet-result?id=1000000000000000001`）は当方が捏造したツイートIDによるもので、実在ID（`x.com/jack/status/20`）に差し替えると404もエラーも0件になることを確認済み＝アプリ由来ではない。 |
| 受け入れ基準充足率100% | PASS | 基準1〜3すべて充足（下記）。 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 124 files / 1749 tests すべてpass（32.9s）。 |

### 受け入れ基準1（テスト/型/ビルド/lint）
- `npx vitest run`: 124 files / 1749 tests 全pass。
- `npx tsc --noEmit`: エラー0（exit 0）。
- `npm run lint`: **0 errors**（warning 7件はすべて本スプリント以前からの既存ファイル由来。新規 `reaction-select.ts` は警告0）。
- `npm run build`: 自己評価どおり成功（tsc/lint/devビルド・全ページ200応答で追認）。

### 受け入れ基準2（reddit/X = score優先＋アンカー文脈・目安12・チェーン順／5ch・llm不変）
実データをseedして**表示結果そのもの**で確認（下表はブラウザ本文から抽出した実表示順）。

- **Reddit**（コメント20件・score/parent注釈付き、既定 target=12/anchorDepth=1/hardCap=15）
  - 実表示: `C21(300) > C15(5) > C10(280,親15) > C3(260) > C18(250,親3) > C7(240) > C20(2) > C12(230,親20) > C5(220) > C14(210) > C2(200) > C9(190) > C17(180) > C4(170)` = **14件**（primary12＋context2）。
  - score上位12件が採用され、低scoreでも親（C15=score5・C20=score2）は文脈として採用、かつ**必ず子より前**（15→10、20→12、3→18）。score降順＋チェーン整合順が成立。
  - 強調（`computeLineEmphasis`/`applyMinColorFallback`）も選抜レスに適用（preview-1で赤/紫/青の色付き強調を確認）。
- **X**（`Post.media.xReplies` 15件プール、likeCount差＋`inReplyToId`相互参照）
  - 実表示: `r14(900) > r2(4) > r9(850,親r2) > r5(800) > r11(780,親r5) > r1(760) > r7(3) > r13(740,親r7) > r3(700) > r6(650) > r10(600) > r12(550) > r4(500) > r8(450)` = **14件**（like13位の r15=400 は非採用）。
  - like上位12件＋親文脈2件、親（r2/r7）が子（r9/r13）より前。`@player_rN ・ 👍900 💬90 [返信]`／`[引用]` 表示・逐語本文・元ポストembed（実在IDで正常描画）を確認。
- **Xプール実配線**: `Post.media.xReplies` に15件保存 → `extractPostXReplies` が **15件**読み出し（旧8件キャップなら切り詰められていた）→ `buildXReactionBlocks` が12＋文脈2に絞る、という一連を実DB経由で確認。`post-pipeline.ts:310` に `fetchTopReplies(post.externalId, apiKey, { max: defaultRepliesPoolMax() })` が実配線されていることもコードで確認。
- **5ch不変**: score/parent注釈を付けた5chスレでも `selectMajorConversationCluster` の結果（レス番号 1,2,4,5）と実表示が完全一致。score390/370のレスは非採用・score1のレスは採用＝**scoreを見ていない**（クラスタ据え置き）。
- **llmモード不変**: `REACTION_SELECT_MODE=llm` で同じreddit記事を再生成すると、統一選定を使わず従来経路（AI選定＋index昇順、mockのkeep全件→`reactionMaxReses()`で先頭12）に戻り、表示は `1,2,3,…,12` の昇順。score順にならないことを実行で確認。
- **env調整**: `REACTION_MAX_RESES=5 REACTION_ANCHOR_DEPTH=0` で reddit=5件（`C21>C10>C3>C18>C7`、文脈追加なし）・X=5件に変化することを実行で確認。既定は12。

### 受け入れ基準3（スキーマ/依存/LLM増なし・不変条件）
- `git status`: 変更は `.env.example` / `compose.ts` / `post-pipeline.ts` / 既存テスト1本、新規は `reaction-select.ts` と新規テスト2本のみ。`prisma/schema.prisma`・`package.json`・`package-lock.json` に差分なし＝スキーマ変更なし・新規依存なし。
- 選定は純関数 `selectScoredAnchorReses`（同期・AI呼び出しなし）。LLMは既存の翻訳/導入/結び経路のみ。
- 逐語（本文がそのまま表示）・出典ブロック・moderation・hotness・G8 は表示上も不変。5ch/riot経路のコードパス未変更。

### コード確認（指示項目 (a)〜(e)）
- (a) `reaction-select.ts`: score降順（同点はindex昇順）でtarget件→親をanchorDepth段遡って文脈追加→hardCap超過はcontextの低scoreから間引き（primaryは保護）→親→子のチェーン整合順で各index1回だけemit。空入力は`[]`、`parentIndex=null`／プール外index／循環は`break`で安全に打ち切り（例外なし）。単体テスト9件で網羅。
- (b) `compose.ts:660` `useUnifiedRedditSelection = sourceType === "reddit" && mode !== "llm"` で reddit×rulesのみ統一選定（`res.score ?? 0` / `res.parentNumber → numberToIndex`）。5chとllmモードは従来の `selectMajorConversationCluster` / `selectReactionReses` ＋既存アンカー文脈ブロックを通る（二重文脈追加なし）。専用テストで不変アサート済み。
- (c) X: `post-pipeline.ts:310` の `max: defaultRepliesPoolMax()` 実配線＋`extractPostXReplies` の読み出しキャップ15、`buildXReactionBlocks` が `inReplyToId → 同プール内index` で親解決。
- (d) `reactionMaxReses()`（`REACTION_MAX_RESES`・既定12・不正値フォールバック）／`reactionAnchorDepth()`（`REACTION_ANCHOR_DEPTH`・既定1・0許容）。`.env.example` に記載あり。
- (e) スキーマ/依存/LLM増なし（上記のとおり）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- `selectScoredAnchorReses` の出力段（`compose.ts` 側ではなく `reaction-select.ts:87-94`）は、祖先チェーンを辿る途中で未選定の祖先に当たると `break` する。既定 `anchorDepth=1` では到達不能だが、`REACTION_ANCHOR_DEPTH>=2` かつ hardCap 間引きで「中間の親だけが間引かれ祖父は残る」状況になると、`selectedSet` に含まれるのに一度も emit されない index が生じ得る（クラッシュや順序崩れはなく、件数が1件少なくなるだけ）。非既定env限定の理論ケース。
- reddit の翻訳バッチは6件区切り（`REDDIT_TRANSLATE_BATCH_SIZE`）のため、文脈追加で13〜15件になるケースでは翻訳バッチが2→3回に増える（選定自体のLLM呼び出しは0のまま。仕様「LLM呼び出し増なし＝選定は決定論」には反しないが、live運用時のコスト観点で認識しておくとよい）。
- 反応ブロックの `[引用]`/`[返信]` ラベルと `👍`/`💬` は絵文字のみで文字ラベルが無く、スクリーンリーダーでは意味が伝わりにくい（`aria-label` 付与の余地）。今回の変更由来ではない既存事項。

## 未検証項目（実機確認が必要）
- GetXAPI の `inReplyToId` 実値の有無（`X_API_KEY` 未設定のため live 呼び出し未実施）。本評価では検証用プールをseedして `inReplyToId → 親` の解決経路が正しく動くことを確認済みで、残るのは「本番APIが実際に `in_reply_to_status_id` を返すか」のみ。
- `fetchTopReplies` の本接続（`max=15` で実際に15件取得できるか）は認証情報待ちのためモック/結合テストのみで検証。

## プレビュー画像（PASS）
- `resel-s2-preview-1.png`（Reddit・標準デザイン: score順＋親文脈 C21>C15>C10>C3>C18>C7>C20>C12… の実表示）
- `resel-s2-preview-2.png`（X・Hextechダーク: 元ポストembed＋@handle/👍💬/[返信][引用]・r14>r2>r9>r5>r11… の実表示）
- `resel-s2-preview-3.png`（5ch・ニュース記事風: 従来クラスタ選定のまま不変）

## 関連ドキュメント
- [[resel-s2-selfeval]]（ジェネレーターの自己評価レポート）
- [[resel-s2-brief]]（本スプリントの仕様抜粋）
