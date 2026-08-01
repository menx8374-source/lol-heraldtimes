---
tags: [sprint-evaluation]
sprint: reactqual-S3
result: PASS
---

# Sprint reactqual-S3 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）＋ 独立検証スクリプト（tsx、evaluator自作・アプリ本体は無変更）
- ジェネレーターのテストを鵜呑みにせず、evaluator が別途書いた検証スクリプト（scratchpad配置）で `composeArticleBody` / `buildXReactionBlocks` / `findNgWordExcluding` / `moderateArticleContent` を直接実行して確認。
- さらに隔離SQLite（scratchpad配下の `eval.db`、開発/本番DBには非接触）に該当構成の記事を投入し、`next dev -p 3100` ＋ Playwright で実描画を確認。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 再現ケース#102に本文表示・空レス非掲載・NG検出は維持。独立検証スクリプト26項目すべてPASS |
| コンソールエラー0件 | PASS | `/articles/eval-reactqual-s3` 表示時のconsole: 総2件・Errors 0・Warnings 0。ネットワークは非静的リクエスト0件（失敗レスポンスなし） |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3をすべて充足（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → 131 files / 1842 tests 全passed（44.0s） |

### 受け入れ基準ごと
| 受け入れ基準 | 結果 | 根拠 |
|---|---|---|
| 1. vitest / tsc / build / lint | PASS | vitest 1842 passed・`npx tsc --noEmit` exit 0・`npm run build` 成功・`npm run lint` 0 errors（既存の無関係warning 7件のみ） |
| 2. アンカー先頭レスで本文表示・実質空レス非掲載・逐語/アンカー文脈/強調維持 | PASS | 独立検証で#102 lines = `[">>101","グレイブスのスモークスクリーンか？"]`・anchors=[101]。実機描画でも#102に本文（赤強調）が表示。アンカーのみ/NG全消レスは非掲載で連番・順序維持 |
| 3. スキーマ/依存不変・他スプリント整合・5ch選定順不変 | PASS | `git diff HEAD -- package.json prisma/` 差分なし。`selectMajorConversationCluster` 無変更。既存131テストファイル全green＝回帰なし |

## 実施した独立検証（要点）
- **再現（最重要）**: 101〜104アンカーチェーン（`102: >>101` + `グレイブスのスモークスクリーンか？`）を既定rulesモード・MockLLMで `composeArticleBody("5ch")` → #102に本文が出る／101・103・104も逐語維持。
- **真因の裏取り**: `findNgWord("グレイブスのスモークスクリーンか？") === "ブス"`（旧関数は誤検知）→ `findNgWordExcluding(..., CHAMPIONS) === null`。CHAMPIONS全87件走査で旧関数の衝突は「グレイブス」1件のみ、新関数では全件null。
- **検出能力の非退行**: NG_WORDS 全語が単体文脈で依然検出（過剰除外0件）。`グレイブス使ってるやつ死ね`→`死ね`検出、`グレイブスはブス`→`ブス`検出、半角カナ回避 `ｶﾞｲｼﾞ` も検出。
- **moderation**: グレイブス記事 → `published`。本物NG記事 → `held(ng_word)`。チャンピオン名と本物NGが同居 → `held`。
- **空レスガード**: 5ch（アンカーのみ#102・NG全消#103が非掲載、残り `[101,104]` で順序維持）／X（NG全消リプ非掲載、連番 `[1,2]` に振り直し、グレイブス本文は残存）。
- **回帰**: 逐語＋赤強調 `{text:"壁飛び5連続でキャリーとか草生える", emphasis:"red"}`・アンカー文脈 `[1]` 維持。
- **逆依存（moderation→generation の CHAMPIONS import）**: 循環なし（title.ts→ng-words.ts の一方向）。`tsc --noEmit` 0・`next build` 成功・実機SSRも正常描画で確認。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（PASSでもFAILでも、ブロッカーではないもの）
- **タイトル経路のチャンピオン名欠損（既存・本スプリント範囲外）**: `stripNgWords("グレイブスの育ち方が異常")` → `"グレイの育ち方が異常"`。`title.ts`（`safeSubject`/`contextPool`）は今回 `findNgWordExcluding` 化されていないため、タイトルで「グレイブス」が「グレイ」に欠損し得る。実害あり得るので次スプリントで `stripNgWords` にも exemptions を通すことを推奨（自己評価でも既知として記載済み）。
- **`NG_REPHRASE_MODE=mask` 時の伏字欠損（既定softenでは非該当）**: `maskNgWords("グレイブスはゴミ")` → `"グレイ**は**"`。mask経路は NG検出済み文にのみ適用されるため既定運用では発火しないが、同じ CHAMPIONS 除外が必要。
- **非掲載レスへのダングリングアンカー**: NG全消で#103を非掲載にしても、#104の表示行に `>>103` が残る（参照先が記事内に存在しない）。表示上の軽微な不整合。
- `findNgWordExcluding` は呼び出しごとに CHAMPIONS 全件を `includes`/`split` 走査する（文単位で呼ばれる）。現行データ量では実測上の問題なしだが、将来的にはマスク済みテキストの再利用や正規表現化の余地あり。

## 未検証項目（実機確認が必要）
- 本番の実5chダンプ（実データ）での再生成結果は未検証（LLM live・実HTTPを伴うため）。今回は同一構成の入力を隔離DB経由で再現し実描画まで確認した。
- LLM実接続（`GENERATION_MODE=live`）での `softenNgSentences` 言い換え結果は mock のみ検証（既存挙動・本スプリント変更範囲外）。

## プレビュー画像（PASSかつ画面を持つプロダクトの場合のみ）
- `reactqual-s3-preview-1.png`（#102に `>>101` と本文「グレイブスのスモークスクリーンか？」が表示され、空白レスが無いことを示す実機描画）

## 関連ドキュメント
- [[reactqual-s3-selfeval]]（ジェネレーターの自己評価レポート）
- [[reactqual-s3-brief]]（本スプリントの仕様抜粋）
