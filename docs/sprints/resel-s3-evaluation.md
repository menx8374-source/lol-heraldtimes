---
tags: [sprint-evaluation]
sprint: resel-S3
result: PASS
---

# Sprint resel-S3 評価レポート

## 総合判定: PASS

## 検証モード: テスト＋静的確認（＋curlによるレンダリング/サーバーログのスモーク）
- 本スプリントのUI差分は「NG語を含む記事 かつ `GENERATION_MODE=live`」でのみ発生し、既定mockでは soften→空応答→削除フォールバックで従来表示と同一。よってブラウザ操作での差分検証は原理的に不可能（縮退ではなく変更の性質による）。
- 加えて本実行ではPlaywright MCPのツール（`browser_navigate`等）が当セッションに露出しておらず、代替として `next dev` 起動＋curlで反応記事5本のHTTP 200レンダリングとサーバーログのエラー0を確認した。
- 検証は generator のテストを鵜呑みにせず、evaluator が独自に一時テスト（6ケース）を作成・実行して未カバー経路を確認し、実行後に削除した（リポジトリ汚染なし＝`git status` clean）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 独自検証6ケース（部分欠落・不正index・翻訳文NG・未知env値・呼び出し回数実測・LLM例外）すべて期待どおり。LLM例外時も本体は止まらず削除フォールバック |
| コンソールエラー0件 | PASS | `npm run build` 成功（エラー0）、`next dev` 起動〜反応記事5本閲覧でサーバーログのerror/exception 0件、全ページHTTP 200 |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3を全て確認（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **125 files / 1760 tests 全passed**（既存テストの改変ゼロ＝mock既定で回帰なし） |

### 受け入れ基準の個別確認
- 基準1: `vitest run` 1760/1760 Green ／ `npx tsc --noEmit` エラー0 ／ `npm run build` 成功 ／ `npm run lint` **0 errors**（warning 7件はすべて既存ファイル由来で本スプリント無関係）。
- 基準2:
  - soften採用時にNG文が言い換え文で**表示される**（削除されない）ことを、モックLLM注入テストで確認（`"このチャンピオンはカスだと思う。でも強いと思う。"` → `"そのプレイは残念だと思う。でも強いと思う。"`）。
  - 再検査: `softenNgSentences` は `findNgWord(text) === null` のもののみ採用。NG残存／空文字／欠落／不正index／非文字列textはすべて不採用→削除フォールバックを独自テストで実測確認。
  - 非NG文は逐語不変（同上テストで `"でも強いと思う。"` `"普通の反応だけ。"` が原文一致）。
  - 全経路: `buildReactionDisplayLines` を 5ch/reddit（`buildReactionBlocks`）・X（`buildXReactionBlocks`）双方が `llmClient` 付きで呼ぶよう更新済み（grep で他の呼び出し元なし）。**翻訳後の日本語**にNGが出る経路でもsoftenが適用されることを独自テストで確認（翻訳stub→`"この選手はカスだ。応援はしている。"` → `"この選手は批判されている。応援はしている。"`）。
  - moderation整合: soften後本文に `findNgWord` 該当なし→`moderateArticleContent` が `status: "published"`（reddit経路・翻訳経路の両方で確認）。`moderate.ts`／`ng-words.ts` は無変更（`git diff --stat` に含まれない）。
- 基準3: 事実/数値/固有名詞はcompose側で一切書き換えず再検査のみ（コード確認済み）。スキーマ変更なし・新規依存なし（`package.json` 無変更）。NG文が1つも無ければ `softenNgSentences` を呼ばない早期return（5ch/X両経路で呼び出し回数0を実測）。mock既定では `renderNgSoften()` が空文字→空Map→削除フォールバックのため既存テスト回帰ゼロ。

## 発見したバグ・問題点（FAILの原因）
該当なし。

## 軽微な改善点（ブロッカーではない）
- **softenのバッチ粒度が「1記事1回」ではなく「1レス1回」**（要検討・最重要の改善点）: `softenNgSentences` の呼び出しは `cleanNgSentencesInLines`（＝`buildReactionDisplayLines`＝レス単位）の中にあるため、NG文を含むレスが3件ある記事では **ng-soften が3回**発火する（evaluatorが実測: `ng-soften呼び出し回数: 3`、各1文ずつ）。brief F-RS3-2 の「1記事分をまとめて1回LLMへ（翻訳と同様のバッチ）」の文言とは異なる（`translateReactionLines` は記事1回のバッチ）。
  - 受け入れ基準3の「コスト最小（NG含む記事のみ）」および評価基準の「NG無し記事はLLM未呼び出し」は満たしているため判定はPASSとしたが、live運用ではNG語（カス/ゴミ/バカ等）を含むレスは珍しくなく、`Promise.all` により最大レス数（既定12）ぶんの**同時**LLMリクエストが飛びうる（コスト増＋レート制限429のリスク）。将来スプリントで記事単位バッチへ集約することを推奨。
- `NG_REPHRASE_MODE=mask`（非既定・opt-in）は既存 `maskNgWords` を再利用するが、同関数はNFKC正規化しないため `ｶﾞｲｼﾞ` のような半角カナ表記は伏字化されず、`findNgWord`（NFKC正規化あり）を使う `moderateArticleContent` 側では検出されて記事が `held` になりうる。既存E27機構由来の非対称で本スプリントの新規欠陥ではないが、mask運用を選ぶ場合の注意点。
- NG再検査は「文単位」で行い、その後に文を連結して行テキストにする。理論上は連結境界で新たなNG語が形成されうる（例: 末尾「ハ」＋先頭「ゲ」）。従来のremove動作でも同じ性質で実害はほぼ無いが、行連結後に一度 `findNgWord` を通すとmoderation保留の可能性を完全に排除できる。
- `NG_SOFTEN_SYSTEM_PROMPT` は静的で、事実/数値/固有名詞不改変・意味反転禁止・NG語不残存を明記しており設計どおり。ただし実LLMでの言い換え品質（意味保持の妥当性）はmock中心のテストでは検証不能で、compose側の担保は「NG語ゼロ再検査」のみである点は運用上の留意事項。

## 未検証項目（実機確認が必要）
- `GENERATION_MODE=live`（実Anthropic API）での実際の言い換え文の品質・意味保持・固有名詞不改変。課金/外部API依存のため未実施（compose側の再検査でNG語ゼロは保証済み）。
- ブラウザ実機でのNG言い換え表示の見た目。mock既定ではNG文が従来どおり削除されるため、UI上に差分が出るサンプルを作れない（本変更の性質）。表示コンポーネント（`ReactionGroupView`）は無変更のため、レンダリング回帰リスクは実質なし（反応記事5本のHTTP 200レンダリングは確認済み）。
- 当セッションではPlaywright MCPツールが露出しておらず、ブラウザ内コンソールエラーの直接取得は未実施（サーバーログ・ビルドのエラー0で代替確認）。

## プレビュー画像
- 該当なし（Playwright MCP未使用の検証モードのため。UI差分も本スプリントでは発生しない）

## 関連ドキュメント
- [[resel-s3-selfeval]]（ジェネレーターの自己評価レポート）
- [[resel-s3-brief]]（本スプリントの仕様抜粋）
