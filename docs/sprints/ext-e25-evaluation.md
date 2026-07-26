---
tags: [sprint-evaluation]
sprint: ext-e25
result: PASS
---

# 拡張E25 評価レポート — 反応記事のレス抜粋（話題関連のみ）＋重要レス強調

## 総合判定: PASS

## 検証モード: Playwright（Web実機・mockモードでの回帰確認）＋ Bash（テスト/tsc/build/lint）
- 実APIは一切叩かず（`ANTHROPIC_API_KEY`未設定・mock既定）。live実収集は未実行。
- LLMによる実際の話題関連性判定精度は実APIコストがかかるため未検証（配線はスタブLLMで検証済み。ブリーフ方針どおり）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | mockモードで実機トップ/反応記事詳細が正常表示、従来どおり全レス羅列。逐語破壊なし。 |
| コンソールエラー0件 | PASS | トップ・反応記事(埋め込みなし)で0 errors/0 warnings。埋め込みあり記事の429/警告は第三者Twitch iframe由来（E22既存・E25無関係）。 |
| 受け入れ基準充足率100% | PASS | 基準1〜5すべて充足（下記）。 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 73 files / 698 tests passed（実API非依存・スタブLLM）。 |

## 受け入れ基準1〜5の確認
- 基準1（全Green）: 698件全pass。E25新規テスト確認（generation-compose: keep/emphasize反映・正規化・上限・各種フォールバック・mock回帰、article-body-view: text-lg/font-bold/data-res-emphasis、article-body: emphasisパース、llm-client: mock決定論応答）。
- 基準2（tsc/build/lint）: `npx tsc --noEmit`エラー0、`npm run build`成功（全ルート生成）、`npm run lint`エラー0（warning4件は既存・範囲外: site-header img、テストの_messages未使用）。
- 基準3（mock回帰・コスト0）: `MockLLMClient.renderReactionSelect`がkeep=全index/emphasize=空を返し、`normalizeReactionSelection`を経ても全レス・強調なし。実機5ch反応記事で「反応まとめ」＋全レス（国内プレイヤーさん）が従来どおり表示。AnthropicLLMClient未使用でAPI呼び出し0。
- 基準4（liveスタブ配線）: `StubLLMClient(JSON keep:[0,2] emphasize:[2])`でkeepのレスのみ元スレ順・emphasizeに強調フラグ、が確認済み（generation-compose.test.ts）。
- 基準5（逐語維持・依存追加なし）: `buildReactionBlocks`が`reses[i].lines`（パース済みレス由来）を出力しLLM出力textは本文に使わない（compose.ts L131-144）。selectReactionResesはindexのみ使用。テストで入力content由来のtextが不変と確認。package.json依存追加なし。

## 発見したバグ・問題点
- なし。

## 軽微な改善点（ブロッカーではない）
- lint warning 4件（site-headerの`<img>`・テストの`_messages`未使用）は既存でE25範囲外。放置で問題なし。
- 埋め込みを含む反応記事(例 5ch-yasuo-otp)ではTwitch埋め込みSDKが429(Too Many Requests)/MaxListenersExceededWarningを出すが、第三者iframe由来のネットワーク事象でE22既存挙動。E25とは無関係。

## 未検証項目（実機確認が必要）
- liveモードでの実LLMによる話題関連レス選定の妥当性（実API課金回避のため未検証。配線はスタブで検証済み）。

## プレビュー画像
- `ext-e25-preview-1.png`（mockモードの5ch反応記事詳細。全レス・強調なしの従来表示）

## 関連ドキュメント
- [[ext-e25-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e25-brief]]（本スプリントの仕様抜粋）
