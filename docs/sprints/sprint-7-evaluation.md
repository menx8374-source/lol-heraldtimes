---
tags: [sprint-evaluation]
sprint: 7
result: PASS
---

# Sprint 7 評価レポート

## 総合判定: PASS

## 検証モード: Bash（バックエンド／バッチ）
- 新規UIなしのバックエンド統合スプリント。`npm test`（Vitest結合テスト）＋ `npm run pipeline` をスクラッチDBに対して実行し、`PipelineRunLog`・`Article`・`CollectedItem` をPrisma経由で直接確認。
- 本番 `prisma/dev.db` は汚さず、`scratchpad/eval7.db`・`eval7cap.db` を都度 `prisma db push` で新規構築して検証後に削除。閲覧サイトへの記事表示は既存スプリントで確認済みのため軽検証にとどめた。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全実運用シナリオ・全テストでクラッシュなし |
| コンソール・実行エラー0件 | PASS | 3回の live 実行いずれも想定外エラーログ出力なし（status="success"） |
| 受け入れ基準充足率100% | PASS | 下記9項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test` → 20ファイル / **124件全Green**（内 統合テスト8件） |

## 受け入れ基準ごとの検証結果（実データ）

fresh DB（cap=5 既定）に `npm run pipeline` を3回連続実行した実測ログ:
```json
[
  {"status":"success","collectedCount":8,"candidateCount":7,"generationSucceeded":5,"generationFailed":0,"publishedCount":5,"heldCount":0},
  {"status":"success","collectedCount":0,"candidateCount":3,"generationSucceeded":3,"generationFailed":0,"publishedCount":2,"heldCount":1},
  {"status":"success","collectedCount":0,"candidateCount":0,"generationSucceeded":0,"generationFailed":0,"publishedCount":0,"heldCount":0}
]
```
公開記事数の推移: **0 → 5 → 7 → 7**（3回目は候補枯渇で据え置き）。

- [x] 1回起動で完走し新規公開>0: run1 で publishedArticles 0→5 ✓
- [x] 公開本数上限: 既定cap=5 で候補7→公開5。別途 fresh DB で `PIPELINE_MAX_PUBLISH_PER_RUN=2` を設定し候補7→公開2（run2でさらに+2、累計4）を確認 ✓
- [x] 繰り返し実行で積み上がる: 5→7、cap=2版は2→4 ✓
- [x] 重複公開防止: run2 で heldCount=1（duplicate判定）、公開は新規分のみ。全 CollectedItem が最終 status="articled"、Article総数8＝重複公開なし ✓
- [x] 候補枯渇時の正常終了: run3 candidateCount=0 / publishedCount=0 / status="success"（エラーなし）✓
- [x] エラー耐性（1件失敗でも継続）: 統合テストで(a)1収集ソース例外時に他ソース分が公開、(b)1候補生成失敗（本文最低文字数未達）時に他候補が公開されることを検証 ✓
- [x] 運営ログ: `PipelineRunLog` に collected/candidate/generationSucceeded/generationFailed/published/held を毎回記録（上記JSONで実確認）✓
- [x] 再処理: 生成失敗候補は status="generation_failed" / articleId=null で残存し、`rebuildCandidateQueue()` 再実行で status="queued" に復帰（テストで検証）✓
- [x] 最悪ケース: 全3ソース例外でも status="success"・collected=0・公開0、`SourceFetchLog` に failure 3件記録（テストで検証）✓

## 発見したバグ・問題点
- なし。

## 軽微な改善点（ブロッカーではない）
- 実際のcron常駐は未実装だが brief で本スプリント不要と明記済み（`PIPELINE_INTERVAL_MS`＋単発実行コマンドで代替、`computeNextRunAt` で次回目安表示）。仕様どおりで問題なし。
- モックfixtureは有限（合計12件）のため同一DBへの反復実行はいずれ候補枯渇で頭打ちになるが、これは受け入れ基準「候補枯渇時は正常終了」そのものであり不具合ではない。

## 未検証項目（実機確認が必要）
- 該当なし（全モック方針・APIキー不要。ライブ収集／LLM本接続は後続スプリントの範囲で、本スプリントの受け入れ基準はモック前提のため分母から除外なし）。

## プレビュー画像
- 該当なし（UIなしのバックエンド統合スプリント、Bash検証モード）。

## 関連ドキュメント
- [[sprint-7-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-7-brief]]（本スプリントの仕様抜粋）
