# リファクタリング S5c — riot(公式パッチ)をhotness免除で常に記事化＋Post経路の画像取りこぼし修正

S5aの修正。ステージング実データで判明した設計ギャップを直す。対象: Web。

## 背景（なぜ・現象）
ステージング実データ（Post 9件: 5ch5/reddit3/riot1、記事化2件）を確認したところ:
- **riot（パッチ/メタ）は score=0・commentCount=0 のため HotnessEvaluator で永遠に「hot」にならず、パッチ記事が生成されない**。
  公式パッチノートは"話題性"で測るものではなく、出たら必ず載せるべき公式ニュース＝**hotness判定の対象外にすべき**。
- また Post経路では `candidate.imageUrl` を `Post.media.imageUrl` から取るが、riotアダプタは `item.imageUrl`（og:image・拡張E42）に
  画像を入れており `item.media` は未設定のため、**Post.media に og:image が保存されず、Post経路のパッチ記事から公式バナー画像が失われる**恐れがある。

## 含まれる機能

### F-S5c-1: hotness免除ソースの導入（riotは常に記事化対象）
- `src/lib/hotness/config.ts` に `exemptSourceTypes: string[]`（既定 `["riot"]`・env `HOTNESS_EXEMPT_SOURCE_TYPES` でカンマ区切り上書き可）を追加。
- `src/lib/generation/post-pipeline.ts` `generateArticlesFromHotPosts` の対象判定を変更:
  - **`exemptSourceTypes` に含まれる sourceType（既定 riot）の未記事化Postは、hotness判定を経ずに常に記事化対象**にする。
  - それ以外（5ch/reddit）は従来どおり `evaluateHotness(...).isHot` で判定。
  - カテゴリ別上限（maxPerCategory=2）・1投稿1回・重複防止（Post.article）は免除ソースにも適用（＝新パッチは常に1本、既記事化済みはスキップ）。
  - 免除ソースはhotness強度が無いので、カテゴリ内順序は postedAt 降順など決定論で（新しいパッチ優先）。

### F-S5c-2: Post経路の画像取りこぼし修正（imageUrl→media）
- `src/lib/collection/persist-posts.ts`：Post保存時の `media` を **`item.media ?? (item.imageUrl ? { imageUrl: item.imageUrl } : null)`** にフォールバックし、
  `item.imageUrl` しか無いソース（riot等）でも `Post.media.imageUrl` に画像が入るようにする。
- `src/lib/generation/post-pipeline.ts`：Postから GenerationCandidate を組む際の `imageUrl` を `post.media?.imageUrl`（安全に取り出し）から取る（既にそうなっていれば確認のみ）。
  - これにより Post経路のriotパッチ記事でも公式バナー画像（E42）が表示される。

## 制約・非目標
- hotnessの数値閾値（min score/comments 等）の既定値は**変えない**（env で調整可能な旨は案内済み）。免除の仕組みのみ追加。
- 5ch/reddit のhotness判定は不変。旧CollectedItem経路・moderation・逐語・翻訳・SEOには触れない。新規依存なし。DBスキーマ変更なし。
- riotは1回の収集で最大1件（新パッチ検知）なので、免除してもカテゴリ別上限内で過剰生成しない。

## テスト（必須・専用テストDB＋スタブLLM・実ネット非依存）
1. `generateArticlesFromHotPosts`: **riot(score0/comment0)の未記事化Postが hotness を経ず記事化される**（免除）。5ch/redditは従来どおり hot のみ。
   免除riotも既記事化ならスキップ（1投稿1回）・カテゴリ別上限内。
2. `getHotnessConfig`: `exemptSourceTypes` 既定 ["riot"]、env `HOTNESS_EXEMPT_SOURCE_TYPES` で上書きできる。
3. `persist-posts`: `item.media` 無し＋`item.imageUrl` 有りのとき `Post.media.imageUrl` に画像が保存される（riot相当）。`item.media` 有りは従来どおり。
4. Post経路の生成: media.imageUrl を持つ riot Post から生成した Article の thumbnailUrl / 本文に画像URLが反映される（E42のパッチ画像経路が Post経路でも効く）。
5. 既存の post-pipeline/persist-posts/hotness テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. riot(パッチ)がhotness免除で常に記事化され、Post経路でも公式バナー画像が保持される。5ch/redditのhotness判定は不変。
   新規依存なし・DBスキーマ不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- riot免除・免除の重複防止/上限・imageUrl→media フォールバック・Post経路の画像反映がテストで確認できる。
- 受け入れ基準1〜3を満たす。
