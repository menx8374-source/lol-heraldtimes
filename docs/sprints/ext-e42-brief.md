# 拡張E42 — パッチ記事に公式パッチノートのメイン画像＋大きな公式リンクを載せる

運用フィードバック起点（E41の続き）。対象: Web。

## 背景（なぜ）
パッチ記事は簡潔な事実速報にした（E41）が、**公式パッチノートを大々的に取り上げる記事**にしたい:
- 記事本文の**冒頭に、公式パッチノートのメイン画像（最新パッチのバナー画像）**を大きく埋め込む。
- その下に**分かりやすく目立つ、公式パッチノートへのリンク**を置く。

公式ページには `og:image` にバナー画像URLがある（確認済み。例:
`https://cmsassets.rgpub.io/sanity/images/.../...-1920x1087.jpg?...`。`&amp;` を含むためHTMLエンティティ復号が必要）。

## 含まれる機能

### F-E42-1: 公式パッチノートのメイン画像URLを取得（riot-datadragon.ts）
- パッチノートページHTMLから `og:image`（`<meta property="og:image" content="...">`）のURLを取り出す純関数
  `extractOgImageUrl(html): string | null` を追加（`content` を取り出し、既存 `decodeHtmlEntities` で `&amp;`→`&` 等を復号。
  https のもののみ採用、それ以外/未検出は null）。
- 二重fetchを避けるため、パッチノートページの取得を**1回のfetchで text と imageUrl の両方**を返す形にする
  （例 `fetchPatchNotesData(version): Promise<{ text: string; imageUrl: string | null } | null>`。
  既存 `fetchPatchNotesText` は内部でこれを使うか、薄いラッパにする。取得失敗・本文が短すぎる場合の null 挙動は維持）。
- `buildPatchItem(version, now, patchNotesText?, imageUrl?)` に **imageUrl 引数**を足し、`RawCollectionItem.imageUrl`
  に格納する（imageUrlが無ければ従来どおり未設定）。`RiotDataDragonAdapter.fetchItems` は text と imageUrl の両方を
  取得して buildPatchItem に渡す。

### F-E42-2: linkButton ブロック型を追加（article-body.ts）
- 新ブロック型 `ArticleBodyLinkButtonBlock = { type: "linkButton"; url: string; label: string }` を追加し、
  `ArticleBodyBlock` union に含める。
- `parseArticleBody` に検証を追加: `url` は **https のみ許可**（`isSafeImageUrl` と同様に `^https:\/\//` を必須、
  `javascript:` 等を弾く）、`label` は非空文字列。
- `blockText` に linkButton を追加（`label` と `url` を連結して返す＝検索・文字数計算・安全フィルタ対象に含める）。
- `ArticleBodyDisplayGroup` の `single` 対象に自然に含まれる（reaction以外なので追加対応不要）。

### F-E42-3: linkButton の描画（article-body-view.tsx）
- linkButton ブロックを**大きく目立つボタン風のリンク**として描画する（中央寄せ・十分なパディング・
  ブランド色の背景＋白文字・角丸、`target="_blank"` `rel="noopener noreferrer"`）。ホバーで少し暗くする程度。
  ダーク/ライト両対応。ラベルテキストを表示する（URL文字列は出さない＝すっきり）。

### F-E42-4: パッチ事実速報の本文に画像＋リンクを組み込む（compose.ts）
- `GenerationCandidateInput` に `imageUrl?: string | null` を追加（generate-article から candidate 経由で渡る）。
- `composePatchFactFlashBody` を次の構成にする（**冒頭に画像・その下にリンクボタン**）:
  1. `candidate.imageUrl` が安全なhttps画像URLなら先頭に `image` ブロック
     （`alt`「パッチ<番号> 公式パッチノートのメイン画像」、`credit`「画像: Riot Games 公式パッチノートより」）。
     imageUrl が無ければ画像ブロックは省略（従来どおり文字だけ）。
  2. 見出し「パッチ<番号>が公開」。
  3. 事実段落（一般的事実のみ・捏造なし。E41同様、ただし**簡潔に**）。
  4. `linkButton`（`url` = 出典の公式パッチノートURL(`candidate.sourceUrl`)、`label`「▶ パッチ<番号> 公式パッチノートを読む」）。
  - **注意**: riot は generate-article の「300字以上・逐語率・引用比率」チェック対象。本文テキスト（blockTextの合計）が
    `MIN_BODY_LENGTH`(300) 以上になるよう、事実段落は必要十分な長さを保つ（画像alt/credit・linkButtonのlabel/urlも
    blockTextに数えられる）。300字を割ってGenerationErrorにならないことをテストで担保する。
- summaryモード（`PATCH_ARTICLE_MODE=summary`）の本文構成は変えない（画像・リンクボタンはfactモードのみでよい）。

### F-E42-5: パッチ記事カードのサムネにもメイン画像
- generate-article のサムネ決定は既に「candidate.imageUrl が安全URLなら優先」なので、F-E42-1で imageUrl を
  設定すれば**riotカードのサムネが公式バナーになる**（追加実装は基本不要）。動作をテストで確認する。

## 制約・非目標
- 捏造禁止（事実速報の文言は一般的事実のみ・具体数値/チャンピオン名は書かない）。逐語維持。新規npm依存なし。
- 画像は公式 `og:image`（https）を hotlink で表示（クレジット＋公式リンク併記＝出典明示）。ローカル保存はしない。
  読み込み失敗しても記事表示は壊れない（imgのlazy表示、失敗は空表示）。
- linkButton の url は https のみ（本用途では自作の公式パッチノートURL）。外部リンクは `rel="noopener noreferrer"`。
- 反応記事・clip・NG・強調色・5ch収集には触れない。mock既定は回帰なし（画像取得はlive時のみ。mockのriot候補はimageUrl無し＝
  従来どおり文字のみのfact記事）。

## テスト（必須・実API/実ネット非依存）
1. `extractOgImageUrl`: og:imageタグからURLを取り出し `&amp;`→`&` 復号。https以外・未検出は null。
2. article-body: `linkButton` が parse・検証される（https必須・label非空、http/javascript:は弾く）。`blockText` が label+url を返す。
3. article-body-view: `linkButton` がボタン風リンク（`<a href>` target=_blank rel=noopener）で label を表示。image ブロックは従来どおり。
4. compose fact: `imageUrl` 有りの riot 候補で、本文先頭が image ブロック→見出し→段落→linkButton の順。imageUrl 無しなら
   画像省略。本文 blockText 合計が `MIN_BODY_LENGTH`(300) 以上（generate-articleでGenerationErrorにならない）。
5. generate-article: imageUrl 有りの riot 記事が生成でき（タイトルは事実タイトルのまま・E40/E41）、サムネ(thumbnailUrl)が
   その imageUrl になる。summaryモードは従来どおり（回帰なし）。
6. riot-datadragon: `fetchPatchNotesData` が text と imageUrl を返す（モックHTMLで確認）。`buildPatchItem` が imageUrl を
   `RawCollectionItem.imageUrl` に格納。既存のURL/タイトル系テストは回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. パッチ記事（factモード）が「冒頭に公式パッチノートのメイン画像＋その下に目立つ公式リンクボタン」構成になり、
   カードのサムネも公式バナーになる。捏造なし・逐語維持・新規依存なし。summaryモードは従来どおり。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。mock/生成パイプラインが回帰しない（コンソールエラー0）。
- factモードのパッチ記事に image ブロック（先頭）と linkButton（目立つ公式リンク）が入り、順序・描画が確認できる。
- 受け入れ基準1〜3を満たす。
