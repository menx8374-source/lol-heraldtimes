---
tags: [sprint-selfeval]
sprint: S7b
---

# Sprint S7b 自己評価レポート

## 実装した内容
- F-S7b-1: `SourceType`に`"riot-news"`追加。連動する`Record<SourceType,...>`（config/mock/CATEGORY_BY_SOURCE/
  ARTICLE_SOURCE_LABEL/QUOTE_SOURCE_LABEL/hotness既定値）を網羅的に更新（コンパイルエラーで漏れを検知）。
  `getExemptSourceTypes()`既定を`["riot","riot-news"]`に変更。
- F-S7b-2: `src/lib/collection/adapters/riot-news.ts`新規。`RiotNewsAdapter`実装:
  - 一覧(`leagueoflegends.com/ja-jp/news/`)取得→記事リンク抽出→URLルール分類（純関数、AI不使用）。
  - **実データ調査で判明した仕様変更**: eスポーツ記事は`leagueoflegends.com/ja-jp/news/esports/...`ではなく
    別ドメイン`lolesports.com/ja-jp/news/<slug>`（種別セグメント無し）で配信されており、`og:title`/`og:image`
    メタタグを一切持たない（実fetchで確認）。そのため`parseNewsLink`をホスト別に対応させ、`lolesports.com`は
    常に「eスポーツ」に分類、タイトルは`og:title`→`<h1>`の順にフォールバック抽出するよう設計した
    （ブリーフの想定と異なる点だが、実際にeスポーツ記事を収集するために必須の対応）。
  - `leagueoflegends.com`側は当初のブリーフ通り: esports→eスポーツ/champion・skin・reveal・cinematicキーワード
    →Riot公式/dev→パッチ・メタ/game-updates(非パッチノート)→パッチ・メタ/パッチノートslug・community→除外。
  - 件数上限(既定4、`RIOT_NEWS_MAX_ITEMS`)・externalId(slug)重複排除・ディレイ(sleep注入)・直列取得・
    全失敗/個別記事失敗ともグレースフル(例外なし)。`getAllAdapters`/`config.ts`に登録。
- F-S7b-3: `composeArticleBody`に`riot-news`分岐(`composeRiotNewsBody`)追加: image(og:image、任意)→見出し
  (og:title事実)→AI要約2〜4文(失敗時は定型文フォールバック、捏造禁止)→公式リンクボタン。
  `generate-article.ts`のタイトル事実化(煽りLLM非経由)をriot-newsにも適用。カテゴリは`candidate.category`
  優先、未指定は既定「Riot公式」。
- 収集フィルタ調整: `filter.ts`の`isRelevantItem`にriot-newsのキーワード判定バイパスを追加（公式ドメイン発の
  記事は`DEFAULT_LOL_KEYWORDS`に一致しない日本語見出しでも常に関連ありとする。実データのog:titleで確認した
  必要な対応）。
- `generate-article.ts`の受け入れ基準チェック: riot-news(image→見出し→要約→リンクの短い定型構成)は
  300字下限・逐語一致率・引用主従比率のチェック対象外にし、見出しが1件以上あることだけを最低条件にした
  （反応記事(5ch/reddit)と同様の「形式が違うため対象外」の扱い。これがないと短い要約時にGenerationErrorに
  なりうるため必須の設計判断）。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の`fetchTextSafe`/`stripHtmlToText`/`extractOgImageUrl`/`decodeHtmlEntities`
  （riot-datadragon.tsからexport追加して再利用）で完結。
- ホスト別分類（`leagueoflegends.com` vs `lolesports.com`）は実データ調査で必要と判明した設計変更。
  両ドメインとも同じUA/ヘッダー・`fetchTextSafe`で取得可能なため追加のクライアント/依存は不要。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（新規/既存、1116件）。
- [x] 基準2: `npx tsc --noEmit`・`npm run build`・`npm run lint`（エラー0、既存の警告6件のみ・本スプリント由来なし）通過。
- [x] 基準3: 実データでの手動スモークテスト（`RiotNewsAdapter.fetchItems()`を実ネットワークに対して実行）で、
  Dev Blog記事(パッチ/メタ、og:image/og:title取得)とeスポーツ記事3件(lolesports.com、h1フォールバックで
  タイトル取得、カテゴリeスポーツ)の計4件を実際に収集できることを確認済み（後述「実データ確認ログ」）。
  記事は常に記事化される設計（hotness免除）で、カテゴリが正しく付与される。捏造なし・新規依存なし・
  グレースフル（テストで検証）。

### 実データ確認ログ（読み取り専用の手動スモークテスト、DBには書き込んでいない）
```
[riot-news] listed=8 classified/selected=4 collected=4
collected: 4
title: LCP 2026 Split 3のバーチャルミラー配信者 / category: eスポーツ / sourceUrl: lolesports.com/... / imageUrl: null
title: LJL 2026 SUMMER CHAMPIONSHIP FINALS チケット販売開始！ / category: eスポーツ
title: LCP Finals Weekend Taipeiのチケットが7月24日より販売開始！ / category: eスポーツ
title: /dev：リーグ・オブ・レジェンド クラシック / category: パッチ/メタ / imageUrl: あり(og:image)
```

## アプリの起動方法
- `npm install`（初回のみ）
- `npx prisma migrate dev`（初回のみ・本スプリントはスキーマ変更なしのため不要な場合あり）
- `npm run dev`（http://localhost:3000）
- 収集パイプライン確認（mock）: `npm run collect`
- 収集パイプライン確認（live、riot-newsを含む）: `.env`に`COLLECTION_MODE=live`を設定して`npm run collect`
  （キー不要、公式公開ページのみ）
- テスト: `npx vitest run`
- 型チェック/ビルド/lint: `npx tsc --noEmit` / `npm run build` / `npm run lint`

## 既知の問題・懸念点
- **ブリーフとの乖離（実データで判明・意図的な設計変更）**: eスポーツ記事は`leagueoflegends.com/ja-jp/news/esports/`
  ではなく別ドメイン`lolesports.com`で配信され、`og:title`/`og:image`を持たない。`<h1>`フォールバック抽出で
  対応済みだが、`lolesports.com`側の画像は取得できない（`imageUrl: null`のまま）ため、eスポーツ記事のサムネは
  カテゴリ既定画像にフォールバックする（機能上は問題ないが、公式バナー画像は付かない）。
- ニュース一覧ページの初期HTML（JSレンダリング前の静的部分）に含まれる記事リンクは実測で8〜9件程度と少なく
  （サイトの多くがクライアント側で追加ロードされる構成のため）、`maxItems`既定4は現状の範囲内で収まるが、
  将来的にサイト側の初期HTML構成が変わった場合に取得できる記事数が減る可能性がある（グレースフルに0件
  まで縮退するのみで、パイプライン全体は止めない）。
- `community`種別のURLは実データの初期HTMLでは観測できず（構造化テストのみで検証、実データでの往復確認は
  未実施）。分類ロジック自体は純関数テストで担保。
- riot-newsの`isRelevantItem`キーワードバイパス・`generate-article.ts`のMIN_BODY_LENGTH等チェック対象外化は
  ブリーフに明記が無いが、実データ検証の結果これらが無いと機能が成立しない（og:titleがDEFAULT_LOL_KEYWORDSに
  一致しない／短い定型構成がGenerationErrorになる）ため、スコープ内の必要な対応として実施した。

## 追加したテスト
- `src/lib/__tests__/collection-riot-news.test.ts`（新規）: URL分類（leagueoflegends.com各type・
  lolesports.com・community/未知種別・パッチノート除外）、og:title/h1抽出、記事リンク抽出（正規化・重複排除）、
  `RiotNewsAdapter.fetchItems`（一覧→分類→個別取得、件数上限、ディレイ、一覧/個別取得失敗のグレースフル、
  og:title/h1いずれも取得不可時のスキップ）。
- `src/lib/__tests__/generation-compose.test.ts`（追記）: riot-news本文構成（image任意→見出し→要約(成功/
  失敗フォールバック)→linkButton、sourceUrl無し/非https時のlinkButton省略）。
- `src/lib/__tests__/generation-generate-article.test.ts`（追記）: タイトル事実化（煽りLLM非経由）、
  category優先順位、300字未満でもGenerationErrorにならないこと、出典・サムネ反映。
- `src/lib/__tests__/generation-post-pipeline.test.ts`（追記）: riot-newsのhotness免除による記事化・
  Post.category反映・1投稿1回。
- `src/lib/__tests__/collection-filter.test.ts`（追記）: riot-newsのキーワードバイパス。
- 既存テスト更新（回帰対応、機能追加なし）: `collection-adapters-registry.test.ts`（4ソースに件数更新）・
  `generation-article-updater.test.ts`（ローカルRecord網羅）・`hotness-config.test.ts`（既定免除リスト更新）。

## 関連ドキュメント
- [[refactor-s7b-brief]]（本スプリントの仕様抜粋）
- [[refactor-proposal]]（リファクタリング全体設計）
