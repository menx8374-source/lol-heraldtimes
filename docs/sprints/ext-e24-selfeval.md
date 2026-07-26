---
tags: [sprint-selfeval]
sprint: E24
---

# 拡張E24 自己評価レポート

## 実装した内容
- **F-E24-1（Anthropic本接続LLMClient）**: `@anthropic-ai/sdk` を追加し、`src/lib/generation/llm-client.ts` に `AnthropicLLMClient` を実装。
  - `messages.create({ model, max_tokens: 1024, system, messages })` を呼び出し。`system`はLLMMessagesのsystem role結合、`user`はuser role結合。応答のtextブロックを連結して返す。
  - モデルは env `ANTHROPIC_MODEL`（既定 `claude-haiku-4-5`）。APIキーは env `ANTHROPIC_API_KEY`（`new Anthropic()`でSDK既定解決、ハードコードなし）。
  - API呼び出しはtry/catchで囲み、失敗時は例外を投げず空文字を返す（呼び出し側=title.tsがフォールバックできるようにする）。userメッセージが無ければAPIを呼ばず即座に空文字を返す。
  - `getLLMClient(mode)`: `mode==="live"`かつ`ANTHROPIC_API_KEY`設定済みなら`AnthropicLLMClient`、未設定なら`MockLLMClient`にフォールバック（フォールバック発生を1回だけ`console.log`）。`GENERATION_MODE`既定は従来どおり`mock`。
- **F-E24-2（LLMによるタイトル生成）**: `src/lib/generation/title.ts` に `generateHookTitleLLM(llmClient, input)` を追加。
  - プロンプト（`LLM_TITLE_SYSTEM_PROMPT`）: ラベル付与・捏造禁止・20〜48全角文字・省略記号禁止・タイトルのみ出力、を指示。本文は要約させずそのまま渡す。
  - 生成結果に`stripNgWords`を適用→`checkTitleQuality`で検証→空/不通過/例外時は必ず`generateHookTitle`（ルールベース）にフォールバック（例外を投げない）。
  - `generate-article.ts`の`generateArticleForCandidate`を`await generateHookTitleLLM(llmClient, ...)`に差し替え（既存の`llmClient`引数をそのまま利用）。
  - `pipeline.ts`の`regenerateArticleTitle`（213行付近）は`llmClient`引数を持たない経路のため、ブリーフの許可どおり変更せず従来の同期`generateHookTitle`のまま維持（回帰防止・スコープ最小）。
  - `compose.ts`の既存`askLLM`はLLMClientが本物になることで自動的に本接続に乗る（プロンプト変更なし）。
- `.env.example`・`README.md`を更新（`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`の説明を「後続スプリントで使用」から実装済みの説明に更新、キー名のみ・値は空のまま）。

## 技術選定
- `@anthropic-ai/sdk`（公式SDK）を追加。architecture.mdで既に「LLM接続方針」として同SDK・同モデル(`claude-haiku-4-5`)が確定済みだったため、その決定に従った（新規の技術選定判断は無し、architecture.mdの更新も不要と判断）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green。681件（既存672件+新規9件）すべてパス。実APIは叩いていない（`FixedLLMClient`/`ThrowingLLMClient`スタブ使用）。
- [x] 基準2: `npx tsc --noEmit`（エラー0件）・`npm run build`（成功）・`npm run lint`（エラー0件、warning4件のみ・うち2件はテスト内の未使用引数`_messages`で既存コードと同一パターン）すべて通過。
- [x] 基準3: `GENERATION_MODE=mock`（既定・env未設定時）は`getLLMClient()`が`MockLLMClient`を返す（テストで確認）。`MockLLMClient`は`generateHookTitleLLM`に渡すJSON以外の自然文プロンプトをJSON.parse失敗として扱い常に空文字を返すため、mock時のタイトル生成は自動的にルールベース`generateHookTitle`にフォールバックし、従来と同一の挙動になる（回帰なし・コスト0・実API呼び出しなし）。
- [x] 基準4: `getLLMClient("live")`は`ANTHROPIC_API_KEY`設定時に`AnthropicLLMClient`のインスタンスを返すことをテストで確認（配線のみ・実呼び出しはしていない）。
- [x] 基準5: `generateHookTitleLLM`はLLM出力が空/検証不通過/例外いずれの場合も`generateHookTitle`にフォールバックすることをテストで確認。タイトルが空や例外になるケースは無い。
- [x] 基準6: 新規依存は`@anthropic-ai/sdk`のみ（package.json/package-lock.json diffで確認）。`npm audit`は9件Highだが、いずれも`eslint-config-next`→`eslint-plugin-*`→`minimatch`→`brace-expansion`の既存依存チェーンで、`@anthropic-ai/sdk`追加前後でpackage-lock.jsonのeslint関連エントリに差分が無いことを確認済み（pre-existing、本スプリントの新規依存に起因しない）。

## npm audit結果
```
9 high severity vulnerabilities
brace-expansion <=5.0.7 (via minimatch <- @eslint/config-array, @eslint/eslintrc, eslint-plugin-import/jsx-a11y/react <- eslint-config-next <- eslint)
fix available via `npm audit fix --force`（eslintのbreaking change更新を伴うため今回は対応せず）
```
- `@anthropic-ai/sdk`自体および直接の依存（zod, standardwebhooks, @stablelib/base64, fast-sha256, json-schema-to-ts, ts-algebra, @babel/runtime）由来の指摘は無し。
- 既存のeslint系Highはこのスプリントの変更範囲外（package-lock.json差分にeslint関連の変更なし）のため対応せず据え置き。対応する場合は別途eslintの破壊的更新を検討するスプリントが必要。

## アプリの起動方法
- テスト: `npx vitest run`（または `npm test`）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- 開発サーバー: `npm run dev`（http://localhost:3000）※本スプリントでは起動確認はテスト・build・tscのみで行い、動作確認用に起動したdevサーバー等は無し（起動していないため停止作業も不要）。
- 生成パイプラインをmockで確認する場合: `GENERATION_MODE=mock npm run generate`（既定のためGENERATION_MODE省略でも同じ、APIキー不要・無課金）

## 既知の問題・懸念点
- `npm audit`のHigh 9件は`eslint-config-next`系の既存依存チェーン由来で、本スプリントの新規依存(`@anthropic-ai/sdk`)には起因しない（pre-existing）。`npm audit fix --force`はeslintの破壊的アップグレードを伴うため、スコープ外として今回は対応していない。
- `AnthropicLLMClient`の実API呼び出し（`live`モード・実際のHaiku応答品質）は、ユーザーのAPIキーが無いため実機検証していない（未検証）。テストは配線とフォールバック挙動のみをスタブで確認済み。
- `checkTitleQuality`は具体要素（本文の部分文字列）・定義済み感情フックパターン・ラベル・文字数の4条件を厳格に要求するため、LLMが自由に生成したタイトルはこれらの条件（特に「定義済みHOOKS語彙のいずれかで終わる」）を満たさず不合格→ルールベースへフォールバックする頻度が実運用では高くなる可能性がある（ブリーフの設計どおりであり、想定内の挙動。実際のフォールバック率は実APIキー設定後の運用で確認が必要）。

## 追加したテスト
- `src/lib/__tests__/generation-llm-client.test.ts`（新規）: `getLLMClient`のmock/live切替（ANTHROPIC_API_KEY有無）、`AnthropicLLMClient.generate`のuserメッセージ無し時の早期リターンを検証。
- `src/lib/__tests__/generation-title.test.ts`（追記）: `generateHookTitleLLM`について、(1)LLM有効応答時はそのタイトルを採用、(2)LLM空応答時はルールベースにフォールバック、(3)LLM検証不通過（ラベル無し）時はルールベースにフォールバック、(4)LLM例外時はルールベースにフォールバック（例外が外に漏れない）、(5)stripNgWordsがLLM出力にも適用される、の5件を追加。いずれも実APIを叩かないスタブ（`FixedLLMClient`/`ThrowingLLMClient`）を使用。

## 関連ドキュメント
- [[ext-e24-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン。LLM接続方針は既に確定済みで本スプリントはその実装）
