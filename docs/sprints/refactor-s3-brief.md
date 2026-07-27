# リファクタリング S3 — 話題性判定の数値ルール化（設定ファイル＋HotnessEvaluator）＋ AIレス選別を数値ルールへ（旧AIはフラグで残置）

大規模リファクタ（docs/refactor-proposal.md）の第3歩。要件「AIによる話題性判定・分類・スコアリングは禁止／判定は数値ルール、
閾値は設定ファイルで変更可能」を実装する。対象: Web。

## 背景（なぜ）
- 話題性判定は**AI禁止・数値ルール**が要件。S2で溜まり始めた `Post`＋`PostMetricsHistory`（時系列）を使い、Score/コメントの
  現在値・増加量・増加率・経過時間から**ルールで記事化可否を判定**する純粋モジュールを用意する（S4/S5で結線）。
- 反応記事の `selectReactionReses` は**AIによるレス選別**で、要件の「AI選別禁止」に反する。**数値ルールへ置換**し、
  **旧AI選別は `REACTION_SELECT_MODE=llm` のときだけ**使えるようフラグで残す（質の比較用）。

## 含まれる機能

### F-S3-1: 話題性判定の設定ファイル（閾値の一元管理・env上書き可）
- 新規 `src/lib/hotness/config.ts`：`getHotnessConfig()` が env 上書き可能な閾値を返す（`pipeline/config.ts` と同じ envInt/envFloat 方式）。
  - `minScore`（既定 例100）、`minComments`（例30）
  - `minScoreGrowthPerHour`（Score増加率/時 例50）、`minCommentGrowthPerHour`（コメント増加率/時 例10）
  - `minAgeMinutes`（例30）、`maxAgeHours`（例72）＝投稿経過時間の窓
  - **ソース別上書き**を許容（reddit は score 主体、5ch は score=0 なので comment 主体）。少なくとも source ごとに
    閾値を引ける形にする（例 `getHotnessConfig(sourceType)` か per-source テーブル）。
- 秘密情報ではないため `.env.example` にキー名と既定値を記載。

### F-S3-2: HotnessEvaluator（純関数・AI不使用・未結線）
- 新規 `src/lib/hotness/evaluator.ts`：
  - 入力: `{ sourceType, postedAt, metricsHistory: {score, commentCount, capturedAt}[] }`（時系列・昇順）＋ `now` ＋ config。
  - 算出: 最新score/comments、`ageMinutes`、**Score増加量/増加率(毎時)**、**コメント増加量/増加率(毎時)**（履歴の最古〜最新の差分/経過時間）。
    履歴が1点のみ（増加率算出不可）の場合は増加率0扱い（現在値ルールのみで判定）。
  - 判定（ルール・設定閾値）: 経過時間が `[minAgeMinutes, maxAgeHours]` の窓内で、かつ
    「現在値が閾値超（score>=minScore かつ comments>=minComments）」**または**「増加率が閾値超（score/コメントいずれか）」なら **hot**。
    ソース差（5chはscore=0→comment主体、redditはscore＋comment）を config で吸収。
  - 返り値: `{ isHot: boolean, reasons: string[], metrics: { score, comments, ageMinutes, scoreGrowthPerHour, commentGrowthPerHour } }`（判定根拠を明示）。
  - **純関数**（DBに触れない）。DBから Post＋履歴を読む薄いラッパは本スプリントでは作らない（S4/S5で使う）。**まだパイプラインに結線しない**（挙動不変）。
- Hot入り/Rising入り: Arctic Shift はランキング順位を持たないため本スプリントでは対象外（configにフラグだけ用意し、将来公式OAuth併用時に対応）。

### F-S3-3: AIレス選別を数値ルールへ置換（既定）＋旧AIはフラグ残置
- `src/lib/generation/compose.ts` の `buildReactionBlocks` を、**環境変数 `REACTION_SELECT_MODE` で切替**:
  - **既定（未設定 or `"rules"`）＝数値ルール**：`selectReactionReses`（AI）を呼ばず、**`selectMajorConversationCluster`（アンカー会話クラスタ＝既存E43）**でレスを選び、
    強調は決定論（`computeLineEmphasis` の行赤/オレンジ＋`applyMinColorFallback` の色付け）で付与する。
    ＝**AIによる選別・スコアリングを行わない**。E41のアンカー先引用・E47/E49のreddit翻訳（翻訳はAI許容）は従来どおり適用。
  - `"llm"`：従来どおり `selectReactionReses`（AI選別）を使う（＝旧挙動。質の比較用）。
- ＝既定でreddit/5chの反応記事は**AI選別なし**（コスト減）。AIは**本文生成・タイトル・翻訳・（後続SEO）**にのみ残る。
- `.env.example` に `REACTION_SELECT_MODE`（既定 rules／llm で旧AI選別）を追記。

## 制約・非目標
- **HotnessEvaluator・configはまだパイプラインに結線しない**（S4でメトリクス更新、S5で記事化のPost移行時に使用）。公開挙動は
  「反応レス選別の既定が数値ルールになる」以外は不変。
- AIは生成・翻訳・SEOのみ（本スプリントで判定・選別からAIを外す）。moderation・サムネ・収集・DBスキーマには触れない。新規依存なし。
- 旧AI選別コード（`selectReactionReses`）は削除せず `llm` モードで残す。

## テスト（必須・実API/実ネット非依存＝純関数/スタブ）
1. `getHotnessConfig`: 既定値を返し env で上書きできる。ソース別に閾値が引ける（reddit/5ch）。
2. `HotnessEvaluator`（純関数）: 履歴から score/コメント増加率・経過時間を正しく算出。現在値ルール／増加率ルール／経過時間窓の
   各分岐で isHot と reasons が期待どおり。履歴1点（増加率0）・空履歴の安全動作。ソース差（5ch=comment主体）を確認。
3. `buildReactionBlocks`（既定=rules）: `selectReactionReses`(AI)を**呼ばず**、cluster選定＋決定論強調でブロックを組む
   （AIスタブが呼ばれないことをスパイで確認）。reddit翻訳・アンカー先引用は従来どおり。
4. `buildReactionBlocks`（`REACTION_SELECT_MODE=llm`）: 従来どおり `selectReactionReses`(AI)を使う（旧挙動・回帰なし）。
5. 既存の compose/reaction/pipeline テストが新既定（rules）に沿って回帰しない（AI選別前提だったものは mode 明示 or rules 期待に更新）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 話題性判定の設定ファイル＋純粋 HotnessEvaluator が用意され（未結線）、反応レス選別が**既定で数値ルール**（AI不使用）、
   `REACTION_SELECT_MODE=llm` で旧AI選別に戻せる。逐語維持・新規依存なし・翻訳等のAIは残る。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0・反応記事が既定rulesで表示）。
- HotnessEvaluatorの増加率/窓/ソース差判定、reaction選別のrules既定＋llmフラグがテストで確認できる。
- 受け入れ基準1〜3を満たす。
