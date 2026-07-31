---
tags: [sprint-evaluation]
sprint: resel-S1
result: PASS
---

# Sprint resel-S1 評価レポート（再検証: FAIL修正後）

## 総合判定: PASS

## 検証モード: テスト＋静的確認（Playwright不適用）
- UI・選定・表示を変えない「データ配管」スプリントのため、briefの評価基準どおりブラウザ検証は行わず、テスト実行・型/ビルド/lint・コード静的確認・**実データ相当入力での挙動再現（tsxスクリプトで独立検証）**で判定した。
- 未検証項目は「未検証項目」節参照。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 前回FAILの選定回帰（12件→3件）が解消。独立スクリプトで parent_id 有無の選定index集合が完全一致（後述） |
| コンソールエラー0件 | PASS | `npx tsc --noEmit` エラー0 ／ `npm run build` 成功(exit 0) ／ `npm run lint` **0 errors**（warning 7件は既存パターンの未使用`_xxx`/`<img>`、ビルド非ブロッキング） |
| 受け入れ基準充足率100% | PASS | 基準1・2・3すべて充足（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **122 files / 1729 tests 全passed**（32.9s、exit 0） |

## 前回FAIL点の解消確認（最重要・evaluator独立検証）
generator提供テストとは別に、`npx tsx` でアダプタ関数を直接呼ぶ独立スクリプトを作成し、**実データ相当（コメント20件・全件に`parent_id`・深い返信チェーン c2→c1→…、一部`t3_`）** で `buildRedditThreadDump` → `parseThreadReses` → `selectMajorConversationCluster` を通した結果:

- 本文への `>>N` 単独行: **0件**（`/^>>\d+$/m` 不一致）。さらにダンプ全体に文字列 `>>` を一切含まない。
- `lines`（本文）に `score:` / `parent:` 文字列の混入: **なし**。
- **選定件数: parent_idあり=12 / parent_idなし=12、選定index集合も完全一致**（`[0..11]`）→ 回帰ゼロ。
- `lines` 配列は parent_id 有無で完全一致（本文不変）。`extractAnchors` は全レス空配列、`computeLineEmphasis` 一致、`threadBodyText`（タイトル生成入力）一致 → **表示・強調・翻訳入力・anchors表示すべてS1前と不変**。
- 配管は成立: `score` = [100,95,…,5]、`parentNumber` = チェーンどおり（例 res3→2, res4→3, res5→4, res16→3）。
- 注釈パースの網羅: `(score:M parent:P)` / `(parent:P score:M)`（順不同）/ `(parent:P)` / `(score:-7)`（負値）/ 注釈なし をすべて正しくパースし、いずれも本文に混入しない。
- 5chダンプ（`"1: OP\n\n2: >>1\n本文"`）のパース結果は従来と完全一致。

コード静的確認:
- `reddit.ts` `buildRedditThreadDump`: 本文への`>>N`埋め込みは削除済み。行頭注釈 `N (score:M parent:P): body` のみ。`resolveParentAnchorNumber` は `t1_` かつ選抜済みのみ解決、`t3_`（OP）/parent_id無し/ダングリングは注釈なし。`selectTopComments` は無改修。
- `thread-format.ts`: `RES_START = /^(\d+)(?:\s*\(([^)]*)\))?\s*:\s*(.*)$/` の単一括弧グループ＋`score:(-?\d+)`/`parent:(\d+)`の独立抽出。`extractAnchors`/`computeLineEmphasis`/`threadBodyText` は無改修。
- X（`x.ts`）: `toXReplyItem` が `inReplyToId` を逐語保持（null/未設定→undefined）。`defaultRepliesPoolMax()`（既定15）はexportのみで、唯一の本番呼び出し `post-pipeline.ts:311 fetchTopReplies(post.externalId, apiKey)` は `max` 省略＝`X_REPLIES_MAX`(8) のまま → 保存プール・表示件数は不変。`buildXReactionBlocks` 無改修。
- スキーマ/依存/LLM: 変更ファイルは7件のみ（`.env.example`＋src 6件）。`prisma/schema.prisma`・`package.json`・`package-lock.json` に差分なし。差分内に新規 `llmClient.generate` 呼び出しなし。
- 生contentを使う下流の監査: タイトル生成は `threadBodyText` 経由（`pipeline.ts:299`, `generate-article.ts:211`）で注釈が除去済み。`detectClipEmbedBlocks`（URL抽出）・`detectChampionSplashUrl`・`buildRedditSourceBlocks`（title/author/urlのみ）は注釈の影響を受けない。

## 発見したバグ・問題点（FAILの原因）
- 該当なし。

## 軽微な改善点（ブロッカーではないもの）
- `RES_START` の正規表現拡張により、**本文行が `<数字> (任意文字列): テキスト` 形式の場合に新しいレス開始として誤認**される余地が新設された（旧正規表現では本文行のまま）。リポジトリ全体（src/prisma/fixtures 303ファイル）と dev.db の Post.body を走査した結果、該当行は**0件**で実害なし。将来の対策としては括弧内を `score:`/`parent:` 限定にすると誤爆余地が消える。なお `12:34 に開始した` を「レス12」と誤認する挙動はS1以前から存在（本変更とは無関係）。
- F-RS1-3のプール拡大は**実経路未適用**（`defaultRepliesPoolMax()`はexportのみ・`X_REPLIES_POOL_MAX`は現状どこからも参照されない）。表示件数の回帰ゼロを優先した妥当な判断だが、S2で `fetchTopReplies(..., { max: defaultRepliesPoolMax() })` の明示配線が必須。S2 briefに前提として明記すること。
- `parentNumber` はscore降順のレス番号を指すため、親が子より大きい番号になる「前方参照」が普通に起きる（掲示板慣習と逆）。S2で表示にアンカーを出す場合は並べ替え・表記の検討が必要。
- 新規lint warning 1件（`collection-reddit.test.ts:363 '_parent_id' is defined but never used`）。既存コードにも同型の警告が複数あり、0 errorsでビルド非ブロッキング。

## 未検証項目（実機確認が必要）
- GetXAPI（`X_API_KEY` 必須）の実応答に `inReplyToId` の実値が入るか（キー未設定のため実HTTP未実施）。型・逐語保持実装とテストは整合。S2で実データ確認が必要。
- Arctic Shift `comments/search` の `parent_id` 実応答形状（`t1_`/`t3_`）は前スプリントの実curl結果の記載を前提に検証（本評価では実HTTPを叩いていない）。
- ブラウザ実機での記事表示は未実施（UI・レンダリング層に差分がなく、本文・強調・アンカーの不変を関数レベルで確認済みのため）。

## プレビュー画像
- 該当なし（UIを持たないデータ配管スプリント／検証モードがブラウザ非使用のため）

## 関連ドキュメント
- [[resel-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[resel-s1-brief]]（本スプリントの仕様抜粋）
