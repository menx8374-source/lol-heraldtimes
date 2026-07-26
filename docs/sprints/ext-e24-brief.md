# 拡張E24 ブリーフ — 本物のLLM接続（Anthropic/Haiku）＋LLMによるタイトル生成

運用フィードバック起点の機能追加。対象プラットフォーム: Web（Next.js 16 / Vitest）。

## 背景（なぜ）
- 現状のタイトルは `generateHookTitle`（ルールベース、LLMモック）で、本文の意味を理解せず数字等を機械的に主語化するため「【海外の反応】01.33、だった件」のような意味不明タイトルが出る。
- おばにゅー流の「人を惹きつける完結タイトル」（本プロジェクト最初の中核要件）を実現するには本文の意味を理解するLLMが必要。ユーザー決定で、当初モック化していたLLMを**本接続に解禁**する。
- 逐語転載モデルは維持する（LLMはタイトルを生成するのみ。レス本文の書き換えはしない。レス抜粋・強調は後続のE25で扱う）。
- コスト最小のため **Claude Haiku 4.5**（`claude-haiku-4-5`、$1/$5 per MTok、現行最安）を使う。低頻度運用で月$3〜4程度。

## 含まれる機能

### F-E24-1: Anthropic本接続のLLMClientを追加
- 依存追加: `@anthropic-ai/sdk`（公式SDK。保守されている実績あるもの）。`npm install @anthropic-ai/sdk` を実行。
- `src/lib/generation/llm-client.ts` に、既存 `LLMClient` インターフェース（`generate(messages: LLMMessage[]): Promise<string>`）を実装する `AnthropicLLMClient` クラスを追加する。
  - `client.messages.create({ model, max_tokens, system, messages })` を呼ぶ。`system`はLLMMessagesのsystem roleを結合、`user`はuser roleを結合。応答テキスト（textブロック）を連結して返す。
  - モデルは env `ANTHROPIC_MODEL`（既定 `claude-haiku-4-5`）。`max_tokens` は小さめ（例 1024）。APIキーは env `ANTHROPIC_API_KEY`（SDK既定の解決に任せる。ハードコード禁止）。
  - **信頼境界のエラーハンドリング**: API呼び出しはtry/catchで囲み、失敗・タイムアウト時は例外を投げず**呼び出し側がフォールバックできるよう**にする（本体を止めない原則）。SDKの自動リトライ（既定2回）に任せてよい。
- `getLLMClient(mode)` の live 分岐を実装: `mode==="live"` かつ `process.env.ANTHROPIC_API_KEY` が設定済みなら `AnthropicLLMClient` を返す。未設定なら `MockLLMClient` にフォールバックし、その旨を1回 `console.log` で知らせる（本体は継続）。`GENERATION_MODE` 既定は従来どおり `mock`（キー未設定・未課金でも動く）。

### F-E24-2: LLMによるタイトル生成（ルールベースはフォールバックに）
- 目的: 本文（逐語）の意味を踏まえた「【ラベル】＋惹きつける完結タイトル」を生成し、「01.33、だった件」型の無意味タイトルを排除する。
- `src/lib/generation/title.ts` に、LLM経由でタイトルを生成する async 関数（例 `generateHookTitleLLM(llmClient, { title, content }, options?)`）を追加する。
  - プロンプト方針: 「LoLまとめ速報の編集者として、次のスレッド/投稿の内容に対して、日本語で人を惹きつける完結したまとめ速報風タイトルを1つ作る。冒頭に【速報】【悲報】【朗報】【議論】【海外の反応】等のラベルを付ける。本文に無い固有名詞・事実を捏造しない。全角20〜48文字程度。省略記号「…」は使わない。タイトルのみを出力」。本文はそのまま渡す（要約させない＝タイトル生成のみ）。
  - **後処理と検証**: 生成タイトルに既存の `stripNgWords`（NGワード除去）を適用し、`checkTitleQuality(title, sourceText)` でラベル/具体要素/フック/文字数を検証する。長すぎる場合は末尾で自然に切るか再生成せず、**検証を通らない/空/APIエラーの場合は既存の `generateHookTitle`（ルールベース）にフォールバック**する（＝必ず妥当なタイトルを返す。例外を投げない）。
- 呼び出し側を async 化して LLM 経由に差し替える:
  - `src/lib/generation/generate-article.ts`（生成本経路、現状134行の同期 `generateHookTitle`）: 受け取っている `llmClient` を使い、`await generateHookTitleLLM(...)` を用いる。失敗時フォールバックは関数内で処理。
  - `src/lib/generation/pipeline.ts` のタイトル再生成箇所（213行付近 `generateHookTitle(sourceInput)`）も、その関数が `llmClient` を持つならLLM経由に。持たない経路なら従来の同期フォールバックのままでよい（回帰させない範囲で最小変更）。
- clip紹介文など既存の `askLLM`（compose.ts）は**本接続に自動的に乗る**（LLMClientが本物になるため）。プロンプトは既存のまま。挙動が大きく変わらないことをテストで確認する。

## 制約・非目標
- **レス抜粋・強調（本文の編集）はE24では扱わない**（E25）。本文組み立て(compose.ts)の構造は変えない。
- 逐語転載を維持: LLMにレス本文を書き換えさせない。
- コスト: Haiku固定・`max_tokens`小・1記事あたりタイトル1回（＋既存askLLMの段落）。過剰なトークンを使わない。
- シークレット: `ANTHROPIC_API_KEY` はハードコードせず `.env`（gitignore済み）から。`.env.example` にキー名のみ追加（`ANTHROPIC_API_KEY=`、`ANTHROPIC_MODEL=claude-haiku-4-5`）。

## テスト（必須・TDD-lite）
- テストでは**実APIを叩かない**。`LLMClient` をスタブ（`generate` を固定文字列/例外を返すfake）にして検証する:
  1. live+有効応答時、`generateHookTitleLLM` がLLMの返すタイトル（NGワード除去・検証通過後）を使う。
  2. LLMが空/検証不通過/例外を返したとき、`generateHookTitle`（ルールベース）にフォールバックする。
  3. `stripNgWords` がLLM出力にも適用される。
  4. `getLLMClient("live")` は `ANTHROPIC_API_KEY` 未設定時に `MockLLMClient` を返す（例外を投げない）。
  5. 既存の compose/generate-article のテストが、LLMClientスタブ差し替えで従来どおり通る（回帰なし）。
- `@anthropic-ai/sdk` を追加したら `npm audit`（High以上があれば対応）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規テスト含む・実API非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. `GENERATION_MODE=mock`（既定）でAPIキー無しでも従来どおり動く（コスト0・回帰なし）。
4. `GENERATION_MODE=live`＋`ANTHROPIC_API_KEY`設定時に `AnthropicLLMClient` が使われる配線になっている（テストは配線のみ検証、実呼び出しはしない）。
5. LLMタイトルが検証不通過・APIエラーのとき必ずルールベースにフォールバックし、タイトルが空や例外にならない。
6. 新規依存は `@anthropic-ai/sdk` のみ。`npm audit` にHigh以上の未対応がない。

## 評価基準（evaluator向け）
- テストGreen（実API非依存）。build/tsc/lint通過。
- `GENERATION_MODE=mock` で `npm run pipeline` 相当が従来どおり動く（実機 or テストで確認。実API課金を発生させない）。
- 受け入れ基準1〜6を満たす。
- コンソールエラー0でトップ/記事詳細が表示（回帰なし）。
