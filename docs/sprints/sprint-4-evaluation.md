---
tags: [sprint-evaluation]
sprint: 4
result: PASS
---

# Sprint 4 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run dev`（localhost:3000）で起動し、生成記事の個別ページを実ブラウザで検証。
- パイプライン（seed→collect→generate）・DB状態は Bash + Prisma で直接確認。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | seed→collect→generate が正常完走（success=6 failure=0）、記事ページも崩れなく表示 |
| コンソールエラー0件 | PASS | 生成記事3ページ（5ch/riot/reddit由来）で `browser_console_messages` error=0 |
| 受け入れ基準充足率100% | PASS | 下記7項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test`（Vitest）Test Files 16 passed / Tests 84 passed |

## 受け入れ基準ごとの検証
- 構造化日本語まとめ本文（300字以上）生成: PASS。生成記事の本文プレーンテキスト（出典除く）が 5ch=457字 / reddit=571字 / riot=449字。見出し(h2)＋段落＋引用ブロックで構造化。
- 逐語一致率が閾値以下（逐語コピーでない）: PASS。本文の大半はテンプレ生成文で、原文引用は各30字程度に切り詰め（`…`）。self-eval実測0.06〜0.39（閾値0.5未満）、`generation-verbatim.test.ts`で合格/不合格両ケース検証済み。
- 構成分岐: PASS。5ch/reddit由来は「話題／寄せられた反応／まとめ」で複数コメントを要約・並列。riot由来は「速報／要点整理／まとめ」。ブラウザ実表示で確認。
- 出典リンク必須: PASS。全記事に「出典」欄＋外部URLリンク。ArticleSource が各記事1件以上。出典URL無し候補は GenerationError で弾く実装。
- 引用の主従関係（引用過大でない）: PASS。引用は30字上限に切詰め、生成文が主。self-eval実測 quote比率 0.04〜0.13（閾値0.4未満）、`generation-quote-ratio.test.ts`で過大ケースも検証。
- 生成失敗の記録＋他候補継続: PASS。`pipeline.ts`が失敗を捕捉し `status="generation_failed"`+`generationError` に記録しループ継続。`generation-generate-article.test.ts`で「1候補失敗でも他候補は生成成功」を検証（実行時は failure=0）。
- Sprint1閲覧サイトでの表示: PASS。`/articles/gen-*` 3ページを実ブラウザ表示、h1タイトル・カテゴリ・AI生成注記・h2見出し・段落・blockquote(出典付)・出典リンク・関連記事が崩れず表示。

## DB整合性の確認（Prisma直接クエリ）
- 生成後、対象 CollectedItem 6件すべて `status="articled"` かつ `articleId` セット済み。
- 各生成Articleは別々のCollectedItemに1:1で紐づき、二重記事化なし。
- `art:NULL` の2行（duplicate reddit / articled riot）はSprint3のseed既存URL一致由来で articleId=null。二重記事化ではなく、self-eval記載の既知のSprint3挙動。Sprint4スコープ外。
- 実行時に生成失敗が無かったため `generationError` セット行は0（記録経路は単体テストで担保）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- collect実行時 riot はレート制限でスキップされることがあり、初回collect直後のgenerateではriot記事が出ない場合がある（再collectで解消）。運用上は想定内だが、検証者が混乱しうる。
- 引用抜粋が30字＋`…`で機械的に切れるため文意が途中で切れる（品質面。逐語コピー回避・主従関係の観点では適切）。

## 未検証項目（実機確認が必要）
- 本物のLLM連携: 方針通り決定論的モック（MockLLMClient）のみ検証。live経路は未実装（明示エラー）で方針通り。本接続としては未検証。

## プレビュー画像
- `sprint-4-preview-1.png`（riot由来: 速報/要点整理/まとめ 構成の個別記事ページ）
- `sprint-4-preview-2.png`（reddit由来: 話題/寄せられた反応/まとめ 構成の個別記事ページ）

## 関連ドキュメント
- [[sprint-4-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-4-brief]]（本スプリントの仕様抜粋）
