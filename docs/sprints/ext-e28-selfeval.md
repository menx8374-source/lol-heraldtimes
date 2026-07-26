---
tags: [sprint-selfeval]
sprint: ext-e28
---

# 拡張E28 自己評価レポート

## 実装した内容
- `src/lib/generation/llm-client.ts`: `GenerationTask`の`reaction-select`タスクの`reses`要素を`text: string`から`lines: string[]`（行配列）に変更。`renderReactionSelect`（Mock応答）は`index`のみ参照するため無変更で「全keep(数値)・emphasize空」を維持。
- `src/lib/generation/compose.ts`
  - `selectReactionReses`: LLMに渡す`reses`を`{index, number, lines}`に変更。system指示を厳選化（ルール文/テンプレ/雑談/無関係レスの除外、話題の中心レスのみ厳選、行抽出indexの指定方法）(F-E28-1)。
  - `ReactionSelection`型を`keepIndices: Set<number>`から`keepLines: Map<number, number[] | null>`に変更（`null`=全行採用）。
  - `normalizeReactionSelection`を拡張: `keep`各要素がnumber（レスindex、全行）または`{index, lines?}`（そのレスの指定行のみ）を両対応。レスindexは範囲/整数/重複除去/上限12件（先頭優先）維持。`lines`は該当レスの行数範囲内・整数・重複除去・元順（昇順）維持、空/全不正なら`null`（全行）にフォールバック。`emphasize`はkeepの部分集合。全keep不正ならnull。
  - `buildReactionBlocks`: 採用レスごとに`keepLines`の行指定があれば元`res.lines`からその行だけを逐語のまま抽出（`extractedLines`）。`computeLineEmphasis`・`extractAnchors`・`maskNgWords`（E27）は抽出後の行に対して適用するよう変更(F-E28-2)。
- `src/lib/__tests__/generation-compose.test.ts`
  - 既存テストのうちLLM送信タスクの形状を検証する箇所（`reses[].text`）を新形状（`reses[].lines`）に合わせて更新。
  - 新規describeブロック「長レスのレス内文抽出、拡張E28 F-E28-2」を追加（ブリーフのテスト1〜5に対応する6件）。

## 技術選定（該当する場合のみ）
- 新規依存の追加なし。既存のLLMClient抽象・スタブテストパターンをそのまま踏襲。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全715件Green（既存709件＋新規6件）。実API非依存（MockLLMClient/StubLLMClient/ThrowingLLMClientのみ使用）。
- [x] 基準2: `npx tsc --noEmit`・`npm run build`・`npm run lint` すべて通過（lintの警告4件は本スプリント無関係の既存警告、エラー0件）。
- [x] 基準3: `{index, lines}`形式のkeepで長レスの指定行だけが逐語で残ることをテストで確認（"二番目1行目/2行目/3行目"のうち0,2行目のみ残り1行目が落ちる）。数値keepや行指定なしは全行採用（後方互換）も確認。
- [x] 基準4: mock既定（`MockLLMClient`）ではkeepが全レスindex（数値・lines指定なし）なので従来どおり全レス・全行・強調なしで回帰なし。新規依存なし。逐語維持（抽出後の行はNG伏字以外書き換えない）。

## アプリの起動方法
- 開発起動: `npm run dev`（ポート3000既定）。
- 本スプリントはcompose.ts/llm-client.tsのロジック変更のみで画面は変わらないため、自己確認は`npx vitest run`・`npx tsc --noEmit`・`npm run build`・`npm run lint`で実施し、サーバーは起動していない（起動・停止の手順は不要）。

## 既知の問題・懸念点
- 実LLM(Haiku, `GENERATION_MODE=live`)が実際にプロンプト通りの厳選・行抽出JSONを返すかは未検証（このスプリントはテストAPI非依存の方針のため、APIキーを使った実接続確認はスコープ外。既存のAnthropicLLMClient経由のフォールバック・パース処理（extractJsonObjectなど）はE26のまま流用しており、`{index, lines}`形式もJSONとして自然にparseされる想定）。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-compose.test.ts` に describe「長レスのレス内文抽出、拡張E28 F-E28-2」を追加:
  1. `keep=[{index,lines}]`で指定行だけ逐語で残る（1行目が落ちる）
  2. `keep=[数値]`（後方互換）で全行残る
  3. `lines`に範囲外/重複を含む場合、有効な行だけ元順で残る
  4. `lines`が全て不正なら全行にフォールバック
  5. 厳選プロンプト強化後もmock（全keep）時は従来どおり全レス・全行（回帰なし）
  6. 抽出後の行にNG伏字・行強調（red/orange）・アンカーが整合的に効く（抽出前のindexに依存しない）
- 既存テスト1件（LLM送信タスクの形状検証）を`text`→`lines`の新形状に合わせて更新。

## 関連ドキュメント
- [[ext-e28-brief]]（本スプリントの仕様抜粋）
