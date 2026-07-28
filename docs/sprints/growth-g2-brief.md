# 成長G2 — 記事末の回遊ウィジェット強化（同カテゴリ最新＋同タグ人気＋ハブ導線・AI不使用）

成長提案書(docs/growth-research.md 観点④⑥・G2)の回遊強化。**1訪問あたりPV（回遊率）**はPV総量に直結する最も費用対効果の高い施策。
AIは使わない（純ルール・テンプレ）。DBスキーマ変更なし。対象: Web。

## 背景（現状と差分）
現状の記事末回遊は **`listRelatedArticles(article, 3)` の「関連記事3件（同タグ＋同カテゴリ混合スコア）」の単一ブロックのみ**。一方で以下は**既に整備済み**なので新規作成しない（再利用する）:
- 5点セットの記事カード `article-card.tsx`（サムネ＋カテゴリ＋見出し＋抜粋＋日付）と `ArticleList`
- サイドバー `page-with-sidebar.tsx`（人気ランキング `PopularRanking`／注目コメント／タグクラウド／アーカイブ）
- ハブページ `champions/[slug]`・`patches/[version]`・`tags/[tag]`・`archive/[key]`
- 取得関数 `listArticlesByCategory`・`listArticlesByTag`・`listPopularArticlesByPeriod`・`listRelatedArticles`（すべて `src/lib/articles.ts`）
- 純関数 `selectRelatedArticles`（`src/lib/related-articles.ts`）

**足りないのは記事末の回遊の厚み**。研究提案どおり「同カテゴリ最新」「同タグ人気」を分離し、件数を増やし（R8: 6〜10件）、チャンピオン/カテゴリのハブへキーワードアンカー（R7: `こちら`不可）で導線を張る。

## 含まれる機能

### F-G2-1: 回遊選定の純関数（related-articles.ts に追加。既存 selectRelatedArticles は残す）
`src/lib/related-articles.ts` に、DB非依存の純関数を追加（単体テスト可能に保つ）:
- `RelatedCandidate` に `viewCount: number` を追加（同タグ人気のソートキー。既存呼び出し側は0を渡してよい）。
- `selectSameCategoryLatest(current, candidates, limit)`: `category` が一致し `slug !== current.slug` の候補を **publishedAt 降順**で `limit` 件。
- `selectSameTagPopular(current, candidates, limit)`: `current.tags` と1つ以上一致し `slug !== current.slug` の候補を **①一致タグ数降順 → ②viewCount降順 → ③publishedAt降順**で `limit` 件（人気＝閲覧数の高い同タグ記事を拾う）。一致タグ0件は含めない（フォールバック無し。無ければ空でよい＝ウィジェット側で非表示）。
- 3ウィジェット間の**重複表示を避ける**ため、選定は呼び出し側で「関連 → 同カテゴリ最新 → 同タグ人気」の順に既出slugを除外しながら埋める（純関数はスコアリングのみ担当し、除外セットは引数か呼び出し側で管理。決定論を保つ）。

### F-G2-2: 記事末回遊データの取得（articles.ts。既存関数を再利用・新規DB列なし）
`src/lib/articles.ts` に記事末回遊用の取得を用意する（既存の `listArticlesByCategory`/`listArticlesByTag`/`listRelatedArticles` を組み合わせる。新しい Prisma クエリを増やす場合も **published のみ・自分除外**を守る）:
- 関連記事: `listRelatedArticles(article, 6)`（現状3→**6件**に増やす。R8）。
- 同カテゴリ最新: 同カテゴリの published 最新（自分除外）を必要数取得（`listArticlesByCategory` を利用、`ArticleSummary` を返す）。
- 同タグ人気: `current.tags` のうち**件数の多い主要タグ（最大2つ程度）**に限定して `listArticlesByTag` で候補を集め、F-G2-1の `selectSameTagPopular`（viewCount順）で絞る（全タグを引かない＝クエリ数を抑える）。タグが無い/候補0なら空配列。
- これらは記事詳細ページで `Promise.all` により**関連・コメント取得と並列**で取得し、逐次化しない。

### F-G2-3: 記事末回遊ウィジェット（表示・キーワードアンカー導線）
`src/app/articles/[slug]/page.tsx` の記事末（現状の「関連記事」セクション）を次の構成に置き換える。**既存の `ArticleList`／記事カードを再利用**し、見た目の一貫性を保つ:
1. **関連記事**（6件）: 既存セクションを6件に。空なら従来の空メッセージ。
2. **同じカテゴリの最新記事**（例: 6件、`sameCategoryLatest` が空なら**セクションごと非表示**）。見出しはカテゴリ名を含む（例: 「『海外の反応』の最新記事」）。
3. **同じタグの人気記事**（例: 6件、空なら非表示）。見出しは主要タグ名を含む（例: 「#ヨネ の人気記事」）。
4. **ハブ導線（キーワードアンカー・R7）**: 記事のタグ（チャンピオン名等）とカテゴリから、`/tags/<tag>`・`/category/<slug>` への**アンカーテキストにキーワードを含む**内部リンクを小さなリンク集として表示する（例: 「ヨネのまとめをもっと見る」「パッチ/メタの記事一覧」）。**`こちら`・`詳しくは` 等の無意味アンカーは使わない**。既存のタグチップ（本文冒頭）とは別に、記事末に「まとめて見る」導線として置く。
- **広告との干渉回避**: 既存の `AdSlot position="matched-content"`／`article-bottom`／`sidebar` の配置は壊さない。回遊ウィジェットは広告枠と交互・分離配置にし、CLS（レイアウトずれ）を増やさない。
- モバイル/PC両方でカードが縦積み・グリッドで破綻しないこと（既存カードのレスポンシブに委ねる）。

### F-G2-4: 内部リンクのアンカーテキスト規約（R7・軽量）
上記ハブ導線・関連リンクの**アンカーテキストは対象キーワード（チャンピオン名・カテゴリ名・パッチ番号）を必ず含める**。テンプレ生成（純ルール）で、記事の主要タグ名・カテゴリ名を差し込む。禁止語（`こちら`/`詳しくは`/`リンク`単体）を使わないことをユニットテストで固定する。

## 制約・非目標
- **AIは使わない**（選定・アンカー生成は純ルール/テンプレ）。翻訳/SEO/生成/収集は変更しない。
- **DBスキーマ変更なし**（既存の viewCount/commentCount/publishedAt/tags/category のみ使用）。新規依存なし。
- サイドバー（人気ランキング・タグクラウド・アーカイブ）とハブページ（champions/patches/tags/archive）は**既存を再利用**し新規作成しない。本文への内部リンク自動挿入（本文書き換え）はG2では**やらない**（記事末の回遊ブロックに限定。本文改変は別スプリントで慎重に）。
- 3ウィジェットの合計で同一記事が重複表示されないこと（既出slug除外）。件数はウィジェットあたり6件目安（R8: 6〜10件の範囲）。
- パフォーマンス: 記事末取得はコメント/関連取得と**並列**。タグ人気は主要タグに限定しクエリ数を増やしすぎない。

## テスト（必須・専用テストDB/純関数・実ネット非依存）
1. `selectSameCategoryLatest`: 同カテゴリのみ・自分除外・publishedAt降順・limit遵守。同カテゴリ0件で空。
2. `selectSameTagPopular`: 一致タグ数→viewCount→publishedAt の順で並ぶ。一致タグ0は除外。自分除外。limit遵守。
3. 3ウィジェットの既出slug除外（関連で出た記事が同カテゴリ最新に重複しない）を純関数レベルで検証。
4. アンカーテキスト生成: キーワード（タグ名/カテゴリ名）を含み、禁止語（こちら等）を含まないことを検証。
5. 記事末取得関数（articles.ts）: published のみ・自分除外・件数上限。既存の `listRelatedArticles`/`listArticlesByCategory`/`listArticlesByTag` の回帰なし。
6. 既存の記事詳細ページ・関連記事・サイドバー・ハブページのテストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. 記事詳細ページ末尾に「関連記事(6件)」「同カテゴリの最新」「同タグの人気」の3ブロック（空ブロックは非表示）＋キーワードアンカーのハブ導線が表示される。
3. 3ブロックで同一記事が重複しない。アンカーテキストにキーワードが入り `こちら` 等の無意味アンカーが無い。
4. AI不使用・DBスキーマ変更なし・新規依存なし・既存挙動（サイドバー/ハブ/カード）不変。広告配置が壊れない。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 記事詳細ページで3つの回遊ブロックとハブ導線が実機表示され、リンク先（/tags/<tag>・/category/<slug>・/articles/<slug>）が正しく機能する。重複表示が無い。
- 空条件（同カテゴリ/同タグ記事が無い記事）でセクションが非表示になり崩れない。
- 受け入れ基準1〜4を満たす。
