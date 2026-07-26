---
tags: [sprint-evaluation]
sprint: E24
result: PASS
---

# 拡張E24 評価レポート — 本物のLLM接続（Anthropic/Haiku）＋LLMによるタイトル生成

## 総合判定: PASS

## 検証モード
- Bash中心（テスト/型/build/lint/静的確認）＋ Playwright（Web実機・mockモードでの回帰確認のみ）。
- **実APIは一切呼んでいない**: `.env`に`ANTHROPIC_API_KEY`なし・`GENERATION_MODE`未設定（=mock既定）。`ANTHROPIC_API_KEY`環境変数もセットせず、`GENERATION_MODE=live`での実収集も走らせていない。課金は発生していない。
- liveモード＋実Haiku応答品質は未検証（APIキー未所持のため。配線とフォールバックはスタブテストで確認済み）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | mockでトップ/記事詳細が正常表示。タイトルもルールベースフォールバックで妥当（「【公式】新チャンピオンのティザー映像が公開、正体を巡り憶測合戦に」等） |
| コンソールエラー0件（回帰） | PASS | E24起因の新規エラーなし。既存のdev限定hydration警告1件のみ（下記・非回帰） |
| 受け入れ基準充足率100% | PASS | 基準1〜6を確認（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 73ファイル / 682件全pass |
| tsc / build / lint | PASS | `tsc --noEmit`=exit0、`npm run build`=exit0、`npm run lint`=0 error（warning 4件のみ） |
| APIキー非ハードコード | PASS | grepで実キーなし。ソースは`new Anthropic()`のSDK既定解決のみ。テスト内はダミー値`sk-ant-test-dummy-key` |

### 受け入れ基準1〜6の確認
1. vitest 682件全Green（新規: generation-llm-client 2件、generation-title のLLM関連追記）。実APIスタブ（FixedLLMClient/ThrowingLLMClient・system-only早期リターン）で実API非依存。PASS
2. tsc/build/lint 通過。PASS
3. mock既定・キー未設定で`getLLMClient()`が`MockLLMClient`を返し例外なし。実機mockでトップ/記事詳細が従来どおり表示。PASS
4. 配線確認: `getLLMClient("live")`はキー設定時`AnthropicLLMClient`、未設定時`MockLLMClient`フォールバック（テスト検証・実呼び出しなし）。`generate-article.ts:134`が`await generateHookTitleLLM(llmClient, ...)`に差し替え済み。PASS
5. `generateHookTitleLLM`は空/検証不通過(ラベル無し等)/例外いずれも`generateHookTitle`にフォールバック（title.ts:383-395・テスト4ケース）。タイトルが空/例外にならない。PASS
6. 新規依存は`@anthropic-ai/sdk@0.115.0`のみ（`npm ls`確認）。npm auditのHigh 9件は全て既存の`eslint-config-next`→`minimatch`→`brace-expansion`チェーン由来で、`@anthropic-ai/sdk`起因ではない（pre-existing）。PASS

## 発見したバグ・問題点（FAILの原因）
- 該当なし。

## 軽微な改善点（ブロッカーではない）
- **既存のhydration mismatch警告（dev限定・非回帰）**: トップ/記事詳細のコンソールに`<html className>`が`h-full antialiased`（SSR）vs `...dark`（クライアント）で不一致という[ERROR]が1件出る。原因は`src/app/layout.tsx:27`の`NO_FLASH_THEME_SCRIPT`（localStorage/prefers-color-schemeで`dark`クラスを付与する意図的なno-flashダークテーマ実装）で、ヘッドレスブラウザが`prefers-color-scheme: dark`のため発生。**E24は`layout.tsx`/テーマ/コンポーネントを一切変更しておらず（変更範囲はllm-client.ts/title.ts/generate-article.ts＋テスト/docs/設定のみ）、本スプリント起因ではない既存の挙動**。dev限定の良性警告だが、`suppressHydrationWarning`の付与等で将来解消余地あり。
- `title.ts`冒頭のファイルコメント（1-13行目「⚠ このスプリントもLLMはモック実装」）がE24でLLM本接続化した現状と食い違う古い記述。機能影響なし。
- npm audit High 9件（eslint系・pre-existing）は本スプリント範囲外だが、別途eslint破壊的更新スプリントでの解消が望ましい。
- lint warning: `<img>`要素（site-header.tsx）とテスト内`_messages`未使用（既存パターン）。

## 未検証項目（実機確認が必要）
- liveモードでの実Anthropic(Haiku) API呼び出しと実タイトル生成品質（APIキー未所持のため未実行。課金回避の指示どおり）。配線・フォールバックはスタブテストで確認済み。
- 実運用時のLLMタイトル採用率 vs ルールベースフォールバック率（`checkLLMTitleQuality`のラベル/具体要素/文字数条件を実LLM出力が満たす頻度）。実APIキー設定後の運用で観測要。

## プレビュー画像
- `ext-e24-preview-top.png`（トップ・mockモード）
- `ext-e24-preview-article.png`（記事詳細・mockモード）

## 関連ドキュメント
- [[ext-e24-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e24-brief]]（本スプリントの仕様抜粋）
