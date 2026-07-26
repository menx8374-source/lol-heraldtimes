# 拡張E47 — 海外の反応(Reddit)のコメントを日本語訳＋原文併記にする

運用フィードバック起点（ユーザー決定: 日本語訳＋原文併記）。対象: Web。

## 背景（なぜ）
E46でRedditコメントを実データ化したが**英語のまま**。日本語まとめとして読ませるため、reddit反応記事のレス（OP＋コメント）を
**日本語訳（表示メイン）＋原文英語を併記**する。表示側は既に対応済み（`ArticleBodyReactionLine.original`＝原文英語、
`text`＝日本語訳。`ResLines` が「原文: …（英語）」を小さく併記して描画）。翻訳はHaikuで1記事1回程度＝安価。

## 含まれる機能

### F-E47-1: レス翻訳のLLMタスク（compose.ts）
- 新しい `GenerationTask` 種別 `reaction-translate`（または同等）を追加し、`llm-client.ts` の型に含める。
  - 入力: 表示対象レスの行配列（英語）。`{ reses: [{ index, lines: [英語行,...] }, ...] }`。
  - 出力(JSON): `{ translations: [{ index, lines: [日本語行,...] }, ...] }`。**各レスの行数は入力と同数**（行ごとに対訳）。
  - system指示: 「LoLまとめサイトの翻訳担当。渡された各行を自然な日本語に訳す。行数・順序は入力と厳密に一致させる。
    LoL用語（チャンピオン名・レーン・BAN/ピック等）は一般的な日本語表記で。意味を変えない・要約しない・增やさない。
    出力はJSONのみ」。
- `translateReactionLines(llmClient, reses)` を実装:
  - LLMを1回呼び、`extractJsonObject` で頑健に解析。`index→[日本語行]` の Map を返す。
  - **失敗時（mock・APIエラー・parse不能・行数不一致）は null を返す**（呼び出し側が英語のままにフォールバック）。
  - 行数不一致のレスだけ個別に除外してもよい（該当レスのみ英語フォールバック、他は翻訳採用）。堅牢側に倒す。

### F-E47-2: reddit のときだけ翻訳を適用（compose.ts `buildReactionBlocks`）
- **`sourceType === "reddit"` のときのみ**、表示対象レスの行（`extractedLines`＝keepLines適用後の実表示行）を
  `translateReactionLines` で翻訳し、各行を `{ text: 日本語訳, original: 英語原文 }`（行index対応）で組む。
  - 翻訳が取れない（null）・その行の対訳が無い場合は、その行は `{ text: 英語原文 }`（original無し）にフォールバック。
  - 行単位の強調（`computeLineEmphasis`）は**日本語訳(text)**に対して判定する（強調キーワードは日本語）。
  - NG文削除（`removeNgSentences`）は**日本語訳(text)**に適用。削除で text が空になった行は落とす（original も一緒に落とす）。
    レス全行が空ならそのレス自体を不掲載（既存E36の挙動を踏襲）。
  - 翻訳のLLM呼び出しは **reddit記事1本につき1回**（追加コストを抑制）。5ch では**呼ばない**。
- **5ch は一切変更しない**（日本語逐語・`original` 無し・追加LLM呼び出し無し）。riot/その他も不変。

## 制約・非目標
- 5ch記事の挙動はバイト単位で不変（翻訳・original付与・追加LLM呼び出しをしない）。逐語維持は「原文英語を `original` に保持」
  で担保（`text` は日本語訳＝海外の反応として意図された変換。5chの日本語逐語とは別扱い）。
- 新規npm依存なし。翻訳失敗でも記事生成は止めない（英語フォールバックでグレースフル）。
- NG・強調色・サムネ・埋め込み・収集(reddit.ts)には触れない（compose の反応組み立てのみ）。
- mock既定: `reaction-translate` は mock LLM では有効な翻訳を返さない想定で、**reddit記事は英語のまま**になる
  （original無し）。これは回帰ではなく設計（翻訳はlive時のみ）。既存テストはこの前提に更新/追加。

## テスト（必須・実API/実ネット非依存＝スタブLLM）
1. `translateReactionLines`（スタブLLM）: 正常な `{translations:[{index,lines}]}` を返すと index→日本語行のMapになる。
   行数不一致・空・不正JSON・例外 → null（または該当レスのみ除外）。
2. `buildReactionBlocks`（reddit・スタブ翻訳成功）: 各行が `{text:日本語, original:英語}` になる。行の対応が正しい。
   NG文削除は日本語(text)に適用され、空行は落ちる。強調は日本語に対して付く。
3. `buildReactionBlocks`（reddit・翻訳null/mock）: 各行が `{text:英語}`（original無し）にフォールバック（E46相当）。
4. `buildReactionBlocks`（5ch）: 翻訳を呼ばず、`text` は日本語逐語・`original` 無し（従来どおり・回帰なし）。
5. reddit記事1本で翻訳LLM呼び出しは1回（呼び出し回数の検証・スパイ）。5chでは0回。
6. 既存の compose/reaction/pipeline/article-body テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. Reddit反応記事のコメントが日本語訳＋原文英語併記になる（liveのLLM有効時）。翻訳失敗時は英語フォールバックで壊れない。
   5chは従来どおり日本語逐語（不変）。新規依存なし・翻訳はreddit1記事1回・逐語(原文はoriginalに保持)。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。mock/生成パイプラインが回帰しない（5ch記事は不変・reddit記事は英語フォールバックで表示・コンソールエラー0）。
- スタブ翻訳成功時に reddit レスが日本語訳＋原文併記になること、5chが翻訳を経由しないことがテストで確認できる。
- 受け入れ基準1〜3を満たす。
