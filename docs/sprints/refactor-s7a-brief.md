# リファクタリング S7a — カテゴリ基盤（Riot公式追加・eスポーツ再追加・空カテゴリ非表示・記事へのカテゴリ付与）

S7（Riot公式ニュース拡張）の前半。ニュース種別を複数カテゴリで見せられるよう**カテゴリ基盤**を整える。実際のニュース収集・
生成（RiotNewsAdapter）はS7b。対象: Web。

## 背景（なぜ）
S7でRiot公式ニュース（Dev Blog/チャンピオン・スキン/eスポーツ/ゲームアップデート）を取り込む。表示カテゴリは
**パッチ/メタ（パッチ+Dev Blog）・Riot公式（チャンピオン/スキン・新設）・eスポーツ（E45で削除→再追加）・5chの反応・海外の反応**。
S7aでは、カテゴリの追加・**空カテゴリの非表示**・**1記事に取得元ルールでカテゴリを付与する仕組み**を用意する
（ニュース本体の収集・生成が入るのはS7b。S7a単体ではまだニュース記事は増えない＝新カテゴリは空のまま＝非表示）。

## 含まれる機能

### F-S7a-1: カテゴリ追加（categories.ts）
- `CATEGORY_GRADIENTS`/`CATEGORY_SLUGS` に追加:
  - `"Riot公式"` → slug `"riot-official"`（配色は任意の適切なトークン）
  - `"eスポーツ"` → slug `"esports"`（E45で削除したものを再追加）
- 既存カテゴリ（パッチ/メタ・5chの反応・海外の反応）は不変。`CategoryLabel` 型が5カテゴリになる。
- `public/default-thumb-riot-official.svg` を追加（`default-thumb-esports.svg` は既存を再利用。無ければ追加）。

### F-S7a-2: 空カテゴリの非表示（ナビ・サイトマップ）
- **公開記事が1件も無いカテゴリは、ヘッダーナビ・カテゴリ一覧・sitemap に出さない**（新カテゴリを追加しても中身が無いうちは
  表示されない＝拡張E45で嫌った「空カテゴリ」を回避）。
  - 実装: 公開記事があるカテゴリ集合を1回のクエリ（`article.groupBy({by:["category"], where:{status:"published"}})` 等）で求め、
    ナビ/サイトマップの対象を「定義済みカテゴリ ∩ 記事があるカテゴリ」に絞る純関数＋結線。
  - カテゴリ個別ページ（`/category/<slug>`）自体は従来どおり存在してよい（直リンクは可）。**一覧導線に空を出さない**のが目的。

### F-S7a-3: 記事へのカテゴリ付与を「取得元ルール」で柔軟化（AI分類なし）
- `src/lib/collection/types.ts` の `RawCollectionItem` に **`category?: CategoryLabel`**（任意）を追加。アダプタが取得元の
  URLパス等の**ルール**で明示カテゴリを設定できるようにする（AI分類はしない）。
- `prisma/schema.prisma` の `Post` に **`category String?`**（nullable）を追加（＋マイグレーション。S1同様の非破壊追加）。
  `persist-posts` は `item.category` を `Post.category` に保存する。
- 生成時のカテゴリ決定を **`candidate.category ?? CATEGORY_BY_SOURCE[sourceType]`** にする:
  - `generate-article.ts` の `GenerationCandidate` に `category?: CategoryLabel` を追加し、Article.category を
    `candidate.category ?? CATEGORY_BY_SOURCE[sourceType]` で決める（未指定は従来どおりソース既定）。
  - `post-pipeline.ts` は `candidate.category = post.category ?? undefined` を渡す（Post.category があればそれ、無ければソース既定）。
  - 旧 `pipeline.ts`（CollectedItem経路）は category 未指定＝従来どおり（回帰なし）。

## 制約・非目標
- **RiotNewsAdapter（ニュース収集）・ニュース記事の生成本体はS7b**。S7aは基盤のみ（新カテゴリは空＝非表示）。
- 既存の収集・生成・hotness・moderation・翻訳・SEOの挙動は不変（category未指定なら従来どおり）。新規npm依存なし。
- eスポーツ再追加に伴い、E45で消したカテゴリ定義を戻すが、**単独ソースのClipAdapterは復活させない**（ニュース由来のeスポーツのみ・S7b）。

## テスト（必須・専用テストDB／レンダリング・実ネット非依存）
1. categories: `CATEGORY_LABELS`/`CATEGORY_SLUGS` に Riot公式(riot-official)・eスポーツ(esports)が含まれ5カテゴリ。既存slug不変。
2. 空カテゴリ非表示（純関数＋結線）: 公開記事のあるカテゴリのみナビ/サイトマップに出る。記事0のカテゴリは出ない。記事があれば出る。
3. category付与: `RawCollectionItem.category` を持つ item から生成した Article の category がそれになる。未指定はソース既定（CATEGORY_BY_SOURCE）。
   `persist-posts` が `item.category` を `Post.category` に保存し、`post-pipeline` がそれを Article.category に反映。
4. マイグレーション適用・既存データ保持（Post.category 追加は非破壊）。既存の生成/表示/sitemap テストが回帰しない。

## 受け入れ基準
1. マイグレーション適用＋`npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. Riot公式・eスポーツ カテゴリが定義され、記事が無いうちはナビ/サイトマップに出ない。記事のカテゴリは取得元ルール
   （`item.category`）で付与でき、未指定はソース既定。既存挙動・既存データは不変。新規依存なし。

## 評価基準（evaluator向け）
- マイグレーション適用済み・テスト全Green・build/tsc/lint通過。mock/生成/表示が回帰しない（コンソールエラー0）。
- 新カテゴリ定義・空カテゴリ非表示・category付与（item→Post→Article）がテストで確認できる。
- 受け入れ基準1〜3を満たす。
