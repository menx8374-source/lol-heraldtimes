# リファクタリング S7b — RiotNewsAdapter（公式ニュース収集）＋ニュース記事生成・公開

S7の後半。S7aのカテゴリ基盤の上に、Riot公式ニュースを実際に収集し、記事化・公開する。対象: Web。

## 背景（実データ確認済み）
`https://www.leagueoflegends.com/ja-jp/news/` は 200 で取得でき、記事リンクを抽出可能。第3パスセグメントで種別が分かる:
`game-updates` / `dev` / `esports` / `community`。個別記事ページは og:image・og:title・本文がサーバー描画で取得可能
（例 `/ja-jp/news/dev/...` で og:image・本文確認済み）。公式ニュースは"話題性"で測らず**常に記事化**（hotness免除）。

## 含まれる機能

### F-S7b-1: 新ソース種別 `riot-news`（型・登録）
- `src/lib/collection/types.ts` の `SourceType` に `"riot-news"` を追加、`SOURCE_TYPES` に含める。連動する
  `Record<SourceType,...>`（`CATEGORY_BY_SOURCE`＝既定 "Riot公式"、`ARTICLE_SOURCE_LABEL`＝"Riot公式"、`QUOTE_SOURCE_LABEL` 等）を更新。
- `getExemptSourceTypes()` の既定を `["riot", "riot-news"]` にする（公式ニュースは hotness免除＝常に記事化）。
- カテゴリは記事ごとに `item.category`（S7aで導入）で決まる（下記分類）。CATEGORY_BY_SOURCE は未指定時の保険。

### F-S7b-2: RiotNewsAdapter（`src/lib/collection/adapters/riot-news.ts`）
- ニュース一覧を取得し記事リンクを抽出→**URLルールで分類**（AI分類なし・純関数）:
  - パス `esports` → カテゴリ **eスポーツ**
  - slug にチャンピオン/スキン系キーワード（`champion`/`skin`/`reveal`/`cinematic` 等）→ **Riot公式**
  - パス `dev` → **パッチ/メタ**（Dev Blog）
  - パス `game-updates` → **パッチ/メタ**。ただし**パッチノート**（slug が `*patch*notes*` 相当）は**除外**（現行のData Dragonパッチアダプタが担当・重複回避）
  - `community` その他 → 対象外（今回のスコープ外＝スキップ）
- 各対象記事について: 記事ページを取得し `og:image`(&amp;復号)・`og:title`・本文テキスト（`stripHtmlToText` 相当で抽出）を得る。
  - `RawCollectionItem`: `sourceType:"riot-news"`、`externalId`=記事slug（安定一意）、`title`=og:title、`content`=本文抜粋、
    `sourceUrl`=`https://www.leagueoflegends.com<path>`、`imageUrl`=og:image、`category`=分類結果。
- **有界化・重複防止・作法**: 最新 `RIOT_NEWS_MAX_ITEMS`（env・既定4）件まで。`externalId` で重複排除（既存Postは再取得しても
  Post upsert＝1記事1回）。リクエスト間ディレイ（sleep注入可）・直列。全失敗はグレースフル（空配列・例外を投げない）。UA付与。
- `src/lib/collection/adapters/index.ts` の `getAllAdapters()`（live）に登録。config に riot-news の設定を追加（件数上限・間隔）。

### F-S7b-3: ニュース記事の生成（composeArticleBody riot-news 分岐）
- `sourceType==="riot-news"` の本文構成を追加（パッチ記事E42と同系統の"公式もの"体裁）:
  1. `imageUrl`（og:image）があれば先頭に image ブロック（alt=タイトル・credit「画像: Riot Games 公式サイトより」）。
  2. 見出し（記事タイトル）。
  3. **短い要約（AI・生成＝許容用途）**: 本文テキストから**忠実な2〜4文の日本語要約**（`composePatchSummaryBody` と同様の
     堅牢パース・失敗時フォールバック）。**捏造禁止**（本文に無い事実・数値・固有名詞を作らない）。AI要約が失敗/空なら、
     クリーンな定型文（「Riot Games 公式より〇〇に関するニュースが公開されました。詳しくは公式サイトをご覧ください。」）に
     フォールバック（＝壊れない・捏造しない）。AI呼び出しはニュース1本につき要約1回（＋既存のSEO1回）。
  4. 公式リンクボタン（`linkButton`＝E42、url=sourceUrl・label「▶ 公式サイトで読む」）。
- カテゴリは `candidate.category`（=item.category）で決まる（S7a）。タイトルは og:title（事実）そのまま＝riotと同様に煽りLLMは通さない
  （`generate-article.ts` の riot タイトル事実化を riot-news にも適用）。SEO（S5b）は通常どおり生成。
- moderation は通常どおり通す。Post経路（post-pipeline）で hotness免除により常に記事化（S5c/S7a の仕組み）。

## 制約・非目標
- community 種別・チャンピオン個別数値の構造化（新チャンピオン/スキンの属性化）は今回対象外（種別分類＋カテゴリ付与＋記事化まで）。
- 5ch/reddit・既存riot(パッチ)・hotness数値・moderation・翻訳には触れない。新規npm依存なし。
- AIはニュースの「要約・SEO」のみ（分類・話題性判定はしない＝要件遵守）。要約は忠実・捏造禁止・失敗時は定型文。

## テスト（必須・実API/実ネット非依存＝fixture/注入・スタブLLM／専用テストDB）
1. 分類（純関数）: esports→eスポーツ、champion/skin系slug→Riot公式、dev→パッチ/メタ、game-updates(非パッチノート)→パッチ/メタ、
   patch-notes slug→除外、community→除外。
2. RiotNewsAdapter（fixture/fetch注入）: 一覧→分類→個別取得→RawCollectionItem（sourceType/externalId/title/content/sourceUrl/
   imageUrl/category）。件数上限・externalId重複排除・ディレイ(sleep注入)・全失敗で空配列（例外なし）。
3. 生成（スタブLLM）: riot-news の本文が image→見出し→要約(AI成功時)/定型文(失敗時)→公式リンクボタン。タイトルは og:title（煽りLLM非経由）。
   category が item.category になる。moderation通過で published。
4. hotness免除: riot-news Post は score/comment に関わらず記事化される（post-pipeline）。1記事1回・重複防止。
5. 既存の収集/生成/カテゴリ/sitemap テストが回帰しない。新カテゴリ(Riot公式/eスポーツ)は記事が入ればナビ/sitemapに出る（S7a連携）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/既存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. Riot公式ニュース（Dev Blog/チャンピオン・スキン/eスポーツ/ゲームアップデート）が収集・分類され、image＋要約＋公式リンクの記事として
   常に記事化・公開される。カテゴリが正しく付与され、記事が入った新カテゴリがナビ/sitemapに出る。捏造なし・新規依存なし・グレースフル。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- URL分類・RiotNewsAdapter・riot-news生成(image/要約/リンク)・hotness免除・カテゴリ付与がテスト/データで確認できる。
- 受け入れ基準1〜3を満たす。
