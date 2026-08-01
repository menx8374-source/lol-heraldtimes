---
tags: [sprint-selfeval]
sprint: reactqual-S4
---

# reactqual-S4 自己評価レポート

## 実装した内容
- `src/lib/generation/compose.ts` の `buildReactionBlocks` で、統一選定分岐（`selectScoredAnchorReses`）を「reddit **または 5ch** かつ rulesモード」に拡張（`useUnifiedSelection`）。
- items構築をソース別に分岐:
  - reddit（不変）: `score: res.score ?? 0`、`parentIndex: res.parentNumber → numberToIndex ?? null`。
  - 5ch（新規）: `score: res.number`（レス番号＝疑似score、新しい番号ほど高score）、`parentIndex`: `extractAnchors(res.lines)` の中で `numberToIndex` に存在し自己参照でない先頭番号 → index（無ければnull）。
- `target=reactionMaxReses()`（既定12）・`anchorDepth=reactionAnchorDepth()`（既定1）・`hardCap=target+3`は不変。
- `selectMajorConversationCluster` は削除せず、`REACTION_SELECT_MODE=llm` のAI選定失敗時フォールバック（reddit/5ch共通）として残置。llmモードは本スプリントで不変。
- 上記変更に伴い5ch選定順が変わるテストを新仕様に合わせて更新（後述）。

## 技術選定（該当する場合のみ）
- 新規技術選定なし。既存の`reaction-select.ts`の`selectScoredAnchorReses`（純関数・決定論）を流用するのみ。新規依存追加なし。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（132ファイル/1858件）・`tsc --noEmit` 0エラー・`npm run build` 成功・`npm run lint` 0エラー（既存の無関係warning 7件のみ、本スプリントの変更に起因するものなし）。
- [x] 5ch反応が新しめ/活発な会話（新しいレス優先＋親文脈）で表示される。新規テスト`generation-compose-reactqual-s4.test.ts`で「新しめクラスタ優先・古いクラスタに偏らない」「>>Nからのparent導出（自己参照/存在しない番号はnull）」を確認。
- [x] reddit/X/llm経路・S3の本文保持(#102)/空レスガードは不変。既存テスト（`generation-compose-resel-s2.test.ts`, `generation-compose-resel-s3.test.ts`, `generation-compose-reaction-select-mode.test.ts`, `generation-compose-reactqual-s3.test.ts`, `generation-compose.test.ts`（常時llmモード固定でX-reply系含む）, `generation-generate-article.test.ts`）で回帰なしを確認。加えて新規テストファイルにもS3再現テスト・reddit/5ch-llm不変の直接確認を追加。
- [x] スキーマ変更なし・新規依存なし・LLM呼び出し増なし（決定論選定のみ、`selectScoredAnchorReses`は非同期処理・AI呼び出しを一切含まない純関数）。逐語/強調/moderation/収集層`selectHighlightReses`は不変。

## アプリの起動方法
- 本スプリントはロジック（`compose.ts`のレス選定分岐）のみの変更で、UIや起動手順の変更はなし。
- 検証はテスト/ビルド/型チェック/lintで実施（サーバー起動は不要のため未起動・停止対応も不要）。
  - `npx vitest run`
  - `npx tsc --noEmit`
  - `npm run build`
  - `npm run lint`
- アプリ自体の起動（参考、変更なし）: `npm run dev`（デフォルト http://localhost:3000）。

## 既知の問題・懸念点
- 5chの新しい選定は「収集層`selectHighlightReses`（被参照上位30件に絞り込み済み）の中でさらに新しめを優先」という設計のため、収集層が絞り込んだ後のプール内に「スレ末尾の乙/落ちるぞ等の低価値だが新しいレス」が紛れていた場合、それが優先されうる（brief記載の留意点どおり、収集層の絞り込みにより実際の懸念は限定的と判断。過剰な追加フィルタは非目標のため実装せず）。
- 5chの選定順変更に伴い、既存テスト5件（`generation-compose-reaction-select-mode.test.ts`×2、`generation-compose-resel-s2.test.ts`×1、`generation-compose-resel-s3.test.ts`×1、`generation-generate-article.test.ts`×1）の期待値・タイトル・コメントを新仕様に合わせて更新済み（挙動追認のみ、ロジック自体の検証意図は維持）。

## 追加したテスト
- 新規ファイル `src/lib/__tests__/generation-compose-reactqual-s4.test.ts`:
  - 新しめクラスタ優先・古いクラスタが完全除外される（target絞り込み時）
  - 新しめ独立レス＋古いクラスタが混在時、新しめが先＋その親文脈がチェーン整合順で連なる
  - 5chの`>>N`から`parentNumber`注釈なしで`parentIndex`が導出される（有効参照・自己参照・存在しない番号の3ケース）
  - S3再現テスト（#102本文保持）・空レス非掲載ガードがS4後も維持されることの直接確認
  - reddit rulesモード・5ch llmモードが不変であることの直接確認
- 既存テストの更新（新仕様への追従、上記「既知の問題」参照）。

## 前回フィードバックへの対応（再実装の場合のみ）
- 該当なし（初回実装）。

## 関連ドキュメント
- [[reactqual-s4-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
