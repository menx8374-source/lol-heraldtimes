---
tags: [sprint-selfeval]
sprint: E47
---

# 拡張E47 自己評価レポート

## 実装した内容
- `src/lib/generation/llm-client.ts`: `GenerationTask` に `reaction-translate`（`{ kind, reses: {index, lines}[] }`）を追加。`MockLLMClient` は `reaction-translate` に対して常に空文字を返す（＝翻訳はlive時のみという設計を担保、mockは英語フォールバックのまま）。
- `src/lib/generation/compose.ts`:
  - `REACTION_TRANSLATE_SYSTEM_PROMPT`（行数厳密一致・LoL用語の一般的表記・意味を変えない等の指示）を追加。
  - `normalizeTranslations(raw, reses)`: LLM生JSON `{translations:[{index,lines}]}` を検証・正規化する純関数。indexが入力に実在し行数が一致するレスだけをMapに採用（不一致レスは個別除外）。
  - `translateReactionLines(llmClient, reses)`: LLMを1回呼び `extractJsonObject` で頑健parseし、失敗（空応答・空文字・parse不能・例外・不正形式）は `null` を返す（グレースフルフォールバック、例外を投げない）。
  - `buildReactionBlocks`: `sourceType === "reddit"` のときだけ、選択済みレスの表示行（英語, `extractedLines`）をまとめて`translateReactionLines`で1回翻訳。翻訳が取れた行は `{text: 日本語, original: 英語}`、取れない（null・当該レスのみ行数不一致で除外）行は `{text: 英語}`（original無し）。`computeLineEmphasis`・`removeNgSentences` は表示テキスト（reddit翻訳成功時は日本語、それ以外は従来どおり）に対して適用。5chはこの分岐に入らず、`translations` は常に `null`（追加LLM呼び出しゼロ、既存コードパス完全不変）。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の `LLMClient`/`extractJsonObject` パターンを踏襲（architecture.md記載のLLM接続方針に従う、追記不要）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（875テストファイル75件・テスト874件、うち本スプリントで新規追加した9件を含む=92件がcompose.test.tsで実行され全パス）。実API/実ネット非依存（スタブLLMのみ）。
- [x] `npx tsc --noEmit`・`npm run build`・`npm run lint` すべて通過（lintは既存の警告5件のみ、エラー0件、本スプリントによる新規警告なし）。
- [x] 設計上の受け入れ基準3: liveのLLM有効時にreddit反応記事のコメントが日本語訳＋原文英語併記になる構造をテストで確認（スタブ翻訳成功時の`{text:日本語,original:英語}`、行対応、NG適用、強調適用）。翻訳失敗（null/parse不能/行数不一致/例外）時は英語フォールバックで壊れない。5chは従来どおり日本語逐語で不変（`translateCalls`が0回であることをスパイで確認）。新規npm依存なし。翻訳呼び出しはreddit記事1本につき1回（スパイで確認）。
  - 実際のAnthropic API（live）を用いた翻訳結果そのものの目視確認は未実施（`ANTHROPIC_API_KEY`未設定・課金回避のため。スタブLLMでの契約検証のみ）。

## アプリの起動方法
- `npm run dev`（既定 http://localhost:3000）。本スプリントはcompose.ts内部ロジックのみの変更で画面確認は不要なため、自己確認は `npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint` のみで行い、開発サーバーは起動していない（起動していないため停止処理も不要）。

## 既知の問題・懸念点
- mock既定（`GENERATION_MODE`未設定/live未設定時）では `reaction-translate` は常に空文字を返す設計のため、mockモードで動作確認する限りreddit記事は引き続き英語のまま表示される（原文併記なし）。これは仕様どおりの意図的な挙動（翻訳はHaiku接続時のみ）であり回帰ではない。
- live（`GENERATION_MODE=live` かつ `ANTHROPIC_API_KEY` 設定）時の実際の翻訳品質・実運用コストは未検証（API呼び出し自体は`AnthropicLLMClient`の既存実装をそのまま利用するため新規のAPI疎通確認は不要と判断したが、実際のHaiku応答が期待JSON形式で返るかは実運用で要観察）。
- 表示側（`article-body-view.tsx`のResLines、原文併記描画）はE46時点で対応済みのため本スプリントでは変更していない。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-compose.test.ts` に `describe("composeArticleBody（reddit反応記事のレス翻訳＋原文併記、拡張E47 F-E47-1/F-E47-2）")` を追加（9件）:
  1. 翻訳成功時: 各行が`{text:日本語, original:英語}`になり行対応が正しい（`>>N`アンカー行はorange強調も同時検証）。
  2. 複数行レスでの行index対応。
  3. NGワードは日本語訳(text)に対して削除される。
  4. 強調(`computeLineEmphasis`)は日本語訳(text)に対して判定される。
  5. 翻訳null（`MockLLMClient`）時は英語フォールバック（originalなし）＝E46相当の回帰なし確認。
  6. 翻訳LLMが行数不一致を返した場合、そのレスのみ英語フォールバック。
  7. 翻訳LLMが不正JSONを返しても例外を投げず英語フォールバック。
  8. 翻訳LLM呼び出しが例外を投げても記事生成が止まらず英語フォールバック。
  9. reddit記事1本で翻訳呼び出しは1回、5chでは0回・逐語不変（スパイで呼び出し回数を検証）。
- 既存テスト（compose/reaction/pipeline/article-body等）は変更なしで全パス（回帰なし）。

## 関連ドキュメント
- [[ext-e47-brief]]（本スプリントの仕様抜粋）
- [[lolまとめサイト自動運営-spec]]（製品仕様書、該当する場合）
