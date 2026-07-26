# 拡張E27 — 禁止ワードを伏字（アスタリスク）にして掲載（保留→公開）

運用フィードバック起点。対象: Web。

## 背景（なぜ）
- 現状、本文/タイトルにNGワードが含まれる記事は `moderateArticleContent` が `ng_word` で**保留(held)**にして公開しない（`pipeline.ts`）。
- 運用要望: **NGワードは記事ごと保留するのではなく、アスタリスク等で伏字化して掲載**したい。
- 人格攻撃(personal_attack)・出典欠落(missing_source)・重複(duplicate)の保留は**従来どおり維持**（NGワードのみ方針変更）。

## 含まれる機能

### F-E27-1: `maskNgWords` の追加（伏字化）
- `src/lib/moderation/ng-words.ts` に `maskNgWords(text: string): string` を追加。`NG_WORDS` の各語の出現箇所を、同じ文字数のアスタリスク（例: 「アホ」→「\*\*」）に置換する。既存の `stripNgWords`（削除）・`findNgWord`（検出）はそのまま残す（役割が違うため）。
- 純関数・LLM非依存。全出現を置換（`split(word).join(mask)` 等）。

### F-E27-2: 反応記事本文のNGワードを伏字化して公開
- 反応記事(reddit/5ch)の逐語レス本文にNGワードが含まれる場合、**表示・保存される本文で伏字化**する。実装箇所は `src/lib/generation/compose.ts` の反応ブロック組み立て（レス各行の text 生成時に `maskNgWords` を適用）。逐語は保つが、NG語のみ伏字にする（＝「逐語＋NG語だけ伏字」）。
- タイトルは既に `stripNgWords`（削除）で処理済み。整合のため、タイトルも「削除」ではなく `maskNgWords`（伏字）に切り替えてよい（`title.ts` の `stripNgWords` 呼び出し箇所を `maskNgWords` に）。ただしタイトル生成の検証(`checkTitleQuality`/`checkLLMTitleQuality`)やフォールバックの挙動は壊さないこと。※迷う場合は本文の伏字化を優先し、タイトルは既存のままでも可（本スプリントの主目的はNG記事が保留されず公開されること）。
- 結果として、`moderateArticleContent` に渡る本文には生のNGワードが残らず、`ng_word` 保留が発生しなくなる（伏字化して公開される）。personal_attack等は引き続き保留。

## 制約・非目標
- personal_attack / missing_source / duplicate の保留ロジックは変更しない。
- NGワード語彙(`NG_WORDS`)自体は増減しない。
- 逐語転載は維持（NG語のみ伏字。他は書き換えない）。LLM非依存。新規依存なし。
- 既存の `stripNgWords` を使っている他箇所（タイトル主語のサニタイズ等）を壊さない。

## テスト（必須）
1. `maskNgWords`: NGワードが同数のアスタリスクに置換され、NG以外は不変。複数出現・複数種にも対応。
2. 反応記事: NGワードを含むレス本文が、生成後の本文で伏字化されている（生のNG語が残らない）。
3. NGワードを含む反応記事が `moderateArticleContent` で `ng_word` 保留されず公開される（伏字化後の本文で `findNgWord` が null）。
4. personal_attack 等、NG以外の保留理由は従来どおり保留される（回帰なし）。
5. 既存テスト（title.ts等でstripNgWordsを使う箇所）が回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規テスト含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. NGワードを含む反応記事が伏字化されて公開される（保留されない）。他の保留理由は維持。
4. 逐語維持（NG語のみ伏字）。新規依存なし。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。
- 実機(mock)でトップ/反応記事がコンソールエラー0で表示、回帰なし。
- 受け入れ基準1〜4を満たす。
