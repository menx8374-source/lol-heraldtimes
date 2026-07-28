---
tags: [sprint-selfeval]
sprint: growth-g4
---

# 成長G4 自己評価レポート

## 実装した内容
- F-G4-1（`src/lib/generation/llm-client.ts`）: `AnthropicLLMClient.generate` を、system非空時に `system: [{ type: "text", text, cache_control: { type: "ephemeral" } }]` の形で `messages.create` に渡すよう変更。system空時は従来どおり `system` キー自体を付けない。`max_tokens`等その他は不変。`MockLLMClient`は無変更。
- レスポンスの `usage.input_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens` をプロセス内で1回だけ `console.log`（`cacheUsageLogged`フラグで抑制）。
- コメントに「Haiku 4.5のキャッシュ最小は4096トークン。未満のsystemは通常課金で害なし」を明記。
- 失敗時は従来どおりtry/catchで空文字フォールバック（本体を止めない原則を維持）。
- F-G4-2（新規 `src/lib/generation/translation-glossary.ts`）: LoLスラング英日対訳表（18語。inting/diff/hard stuck/gap/throw/smurf/griefing/ff/gg/nerf/buff/broken/OP/gutted/feed/clutch/carry/tilt）と、整形用純関数 `buildTranslationGlossaryText()`。表示用 `src/lib/lol-data/glossary.ts` はimport・変更していない。
- F-G4-3（`src/lib/generation/compose.ts`）: `REACTION_TRANSLATE_SYSTEM_PROMPT` の末尾に対訳表とFew-shot2例（`>>N`返信保持・草/絵文字・数値固有名詞保全の記法サンプル）を追記。既存の指示文はそのまま残した。systemは日付・レス本文等の動的値を含まない完全な静的文字列のまま（テストで同一性を確認）。
- テストのため `REACTION_TRANSLATE_SYSTEM_PROMPT` に `export` を追加（値そのものは無変更、既存の呼び出し箇所も無変更）。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の `@anthropic-ai/sdk`（バージョン変更なし）の `TextBlockParam`/`cache_control` 型をそのまま利用。
- SDKのモックは `vi.mock("@anthropic-ai/sdk")` + `vi.hoisted` でコンストラクタ・`messages.create` を差し替える方式を採用（プロジェクト内に既存の類似パターンが無かったため新規に導入。fetchスタブ注入パターン（collection-reddit.test.ts等）と同様、実ネットには一切触れない）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（99 files / 1237 tests）。`npx tsc --noEmit` エラー0。`npm run build` 成功。`npm run lint` エラー0（既存の警告6件のみ、今回変更ファイルに起因するものなし）。
- [x] 翻訳systemにLoLスラング対訳表とFew-shotが入り、`AnthropicLLMClient` が `cache_control` 付きsystemで呼び出すことをテストで確認（`generation-compose.test.ts`・`generation-llm-client.test.ts`）。
- [x] AIの呼び出し回数不変（`translateReactionLines`/バッチ構成/`normalizeTranslations`は無変更、既存バッチ分割テストが回帰なくGreenのまま）。出力JSON形式不変。事実/数値/固有名詞保全の指示文は変更していない（Few-shotも「事実を作らない」注記付き）。表示用`glossary.ts`は無変更（import・編集ともになし）。新規npm依存なし。DBスキーマ変更なし。
- [x] Haiku 4.5のキャッシュ最小(4096トークン)未満のsystemは通常課金になる旨をコード内コメントと本レポートに明記。

## Haiku 4.5の4096トークン最小に対する見積り
- 強化後の `REACTION_TRANSLATE_SYSTEM_PROMPT`（対訳表+Few-shot込み）の文字数を実測: 約1,371文字（対訳表テキスト単体は388文字）。
- 日本語主体テキストのラフなトークン概算（1〜2文字/token目安）で **約700〜900トークン程度と推定**。**4096トークンには届かない**。
- これはbrief/仕様上許容されている挙動（「無理に4096トークンへ水増ししない」）であり、この翻訳systemに関しては `cache_control` は当面ノーオペレーション（`cache_creation_input_tokens: 0`で通常課金・エラーなし・害なし）。ただし `AnthropicLLMClient.generate` 自体は全呼び出し経路（title.ts等の他LLM呼び出しやPATCH_SUMMARY/NEWS_SUMMARY等の他system）に共通して効くため、今後systemが4096トークンを超える箇所ができれば自動的にキャッシュの恩恵を受ける。

## アプリの起動方法
- 本スプリントはロジック層のみの変更（UIなし）。起動確認は以下で実施:
  - `npx vitest run`（テスト全体）
  - `npx tsc --noEmit`（型チェック）
  - `npm run build`（Next.jsビルド）
  - `npm run lint`（ESLint）
- 通常のアプリ起動は変更なし: `npm run dev`（http://localhost:3000）。環境変数 `GENERATION_MODE=live` + `ANTHROPIC_API_KEY` 設定時のみ本接続（実LLM呼び出し・課金）になり、既定はmock（無課金・決定論的モック応答）。

## 既知の問題・懸念点
- 強化後の翻訳systemは4096トークンに届かないため、この翻訳呼び出し単体では実際のキャッシュ課金削減効果は出ない（brief許容範囲内）。live実測（本番APIキー使用）は課金が発生するため本スプリントでは行っていない（未検証・brief上も任意扱い）。
- `console.log` によるusageログはデバッグ用の軽量出力で、本番運用ログの集計基盤には接続していない（brief範囲外）。

## 追加したテスト
- `src/lib/__tests__/translation-glossary.test.ts`（新規）: 対訳表のenキー重複なし・主要スラング含有・決定論性・各エントリ非空を検証。
- `src/lib/__tests__/generation-llm-client.test.ts`（追記）: `@anthropic-ai/sdk` をモックし、(1) system非空時に`cache_control`付きテキストブロック配列で`messages.create`に渡ること、(2) system空時は`system`キー自体を付けないこと、(3) API失敗時に例外を投げず空文字を返すこと、を検証。
- `src/lib/__tests__/generation-compose.test.ts`（追記）: 翻訳system（`translateReactionLines`経由）に対訳表・Few-shotが含まれること、および同一入力条件でsystem文字列が完全に静的（2回の呼び出しで同一文字列）であることを検証。

## 関連ドキュメント
- [[growth-g4-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
