# 拡張E38 — 反応記事サムネの表示側フォールバック（既存記事も再生成なしでチャンピオンアート）

運用フィードバック起点（E37の補完）。対象: Web。

## 背景（なぜ）
- E37で「反応記事の生成時に、チャンピオン未検出なら決定論スプラッシュを thumbnailUrl に保存」を入れた。
- しかし **thumbnailUrl は生成時にDBへ保存され、既存の公開記事はパイプライン再実行でも作り直されない**ため、
  E37より前に生成済みの反応記事（例:「【議論】マッチング操作は存在するのか初心者が語り合う」）は
  thumbnailUrl=null のままで、カテゴリSVG（無地）で表示されてしまう。DBを全消し→再生成すれば直るが、
  恒久運営で記事を毎回全消しするのは避けたい。
- 対策: **表示側（サムネ描画・OG画像）で「反応カテゴリ×サムネ未設定なら記事slugから決定論的に
  チャンピオンアートを出す」フォールバックを入れる**。これで既存記事も再生成なしでチャンピオンアートになり、
  今後サムネのルールを変えても記事の作り直しが不要になる。

## 含まれる機能

### F-E38-1: 純粋スプラッシュモジュールの切り出し（バンドル安全化）
- `src/lib/generation/champion-thumbnail.ts` は `@/lib/collection/adapters/http`（サーバー用fetch）を
  import しているため、そのままReactコンポーネントに import するとサーバー専用コードが混ざる懸念がある。
- 純粋関数だけを新モジュール `src/lib/generation/champion-splash.ts`（http非依存）に切り出す:
  `buildChampionSplashUrl`・`CURATED_SPLASH_CHAMPION_IDS`・`pickDeterministicChampionSplashUrl`。
- `champion-thumbnail.ts` はこれらを新モジュールから import して再export（既存の import 元＝generate-article.ts
  等はパス変更不要）。挙動は不変（純粋な移動）。

### F-E38-2: 反応カテゴリ判定の source of truth 化（categories.ts）
- `src/lib/categories.ts` に反応カテゴリ集合を追加: `REACTION_CATEGORY_LABELS = ["5chの反応","海外の反応"]`
  （既存 CATEGORY_GRADIENTS のラベルを唯一の source of truth に）と、`isReactionCategory(category: string): boolean`。
  マジック文字列の散在を防ぐ。

### F-E38-3: サムネ描画のフォールバック（article-thumbnail.tsx）
- `ArticleThumbnail` に `slug?: string` prop を追加する。
- 描画時の src 決定を次の優先順にする:
  1. `isSafeImageUrl(thumbnailUrl)` ならそれ（従来どおり・E37で保存済みの新記事はここで表示）。
  2. でなく、`isReactionCategory(category)` かつ slug があれば `pickDeterministicChampionSplashUrl(slug)`
     （＝既存の反応記事もチャンピオンアートになる）。
  3. どちらでもなければ従来のカテゴリ別/汎用SVG（`/default-thumb-<slug>.svg` 等）。
- 呼び出し元（`article-card.tsx`・`pickup-carousel.tsx`）で `slug={article.slug}` を渡す。
  ※ 反応カテゴリで slug が無い呼び出しは無い想定だが、slug 無し時は従来SVGにフォールバック（安全側）。

### F-E38-4: OG画像のフォールバック（articles/[slug]/page.tsx）
- `resolveOgImageUrl` を、thumbnailUrl が無く反応カテゴリのときは `pickDeterministicChampionSplashUrl(slug)`
  （絶対URL化。splashは既に https 絶対URL）を返すように拡張する（category と slug を渡す）。
  反応以外・slug無しは従来どおり `${siteUrl}/og-default.svg`。既存記事のOGも無地でなくチャンピオンアートになる。

## 制約・非目標
- 生成側（E37）のロジックは変えない（新記事は引き続き thumbnailUrl に保存。表示側は保存があればそれを優先）。
- reaction以外（パッチ/メタ・eスポーツ）のサムネ挙動は不変（カテゴリSVGのまま）。
- 逐語・本文・NG・強調色・タイトルには触れない。新規npm依存なし。実ネット非依存（URL文字列生成のみ）。
- 決定論キーは表示側=slug（既存記事はcandidate.idを保持しないため）。生成側E37=candidate.id。各記事は
  「保存済みならそれ／未保存ならslug」で常に自己整合（同一記事は常に同じ絵）。両者でチャンピオンがずれても
  見た目上の問題はない（どちらも妥当なチャンピオンアート）。

## テスト（必須・実API/実ネット非依存）
1. `champion-splash.ts`: `pickDeterministicChampionSplashUrl` が決定論（同一key→同一URL）・分散（複数key→複数
   チャンピオン）・`_0.jpg` 形式。`champion-thumbnail.ts` からの再exportも同じ関数を指す（既存importが壊れない）。
2. `isReactionCategory`: 「5chの反応」「海外の反応」でtrue、「パッチ/メタ」「eスポーツ」「未知」でfalse。
3. `ArticleThumbnail`:
   - thumbnailUrl=null + category="5chの反応" + slug指定 → src がチャンピオンスプラッシュURL（`splash/..._0.jpg`）で
     カテゴリSVGではない。同じslugなら同じsrc。
   - thumbnailUrl=null + category="パッチ/メタ" → 従来どおりカテゴリSVG（`/default-thumb-patch-meta.svg`）。
   - thumbnailUrl=有効なURL → そのURL（回帰なし、反応カテゴリでも保存優先）。
   - thumbnailUrl=null + 反応カテゴリ + slug未指定 → カテゴリSVG（安全側フォールバック）。
4. `resolveOgImageUrl`（または generateMetadata）: 反応カテゴリ + thumbnailUrl=null → スプラッシュ絶対URL。
   非反応 + null → og-default。thumbnailUrl有 → それ（回帰なし）。
5. 既存の article-thumbnail / seo-output テストが回帰しない（必要なら反応カテゴリのケースを新仕様に更新）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 既存の反応記事（thumbnailUrl未設定）が**再生成なしで**チャンピオンアートのサムネ・OGになる。記事ごとに絵が分散し
   同一記事は常に同じ絵。保存済みthumbnail・非反応カテゴリは従来どおり（回帰なし）。
4. 新規依存なし・生成側E37ロジック不変・逐語維持。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。実機(mock)で反応記事一覧・詳細のサムネがチャンピオンアートになり、
  パッチ/eスポーツは従来のカテゴリSVGのまま、コンソールエラー0。
- 決定論（同一slug→同一絵）と分散（複数slug→複数の絵）、保存優先（有効thumbnail時）がテストで確認できる。
- 受け入れ基準1〜4を満たす。
