# admincms-S4 — フル構造エディタ（パッチ系・目次・画像・リンクボタン）で全ブロック型を編集可能に

仕様書 `docs/spec/admin-cms-v2-spec.md` の **Sprint 4**（F9）を実装する。S3で作ったエディタ基盤に、**現状 `type:"raw"` で素通ししているパッチ系ブロック（patchChange/toc/linkButton）の編集UI**を足し、全ブロック型を編集可能にする。

## 前提（S3で実装済み・利用する）
- 構造化エディタ `src/app/admin/articles/[id]/edit/ArticleEditor.tsx` ＋純関数 `src/lib/admin/article-editor-form.ts`（`blockToDraft`/`draftToRawBlock`/`createDraftBlock`/`validateReactionAnchors`/`moveItem`/`removeItemAt`/`insertItemAfter`）。ブロックの追加/削除/並替/保存/検証エラー時の入力保持は**基盤として動作済み**。
- 反応系＋共通ブロック（reaction/redditSource/heading/paragraph/quote/embed/image）は編集可能。**patchChange/toc/linkButton は現状 `draft.type==="raw"` で元JSONを素通し（編集不可）**。本スプリントでこれらを editable 化する。
- 保存は必ず `parseArticleBody`（`src/lib/article-body.ts`）を通す。ブロック型・検証規則は**変更しない**。

## 対象ブロック型（S4=パッチ系・目次・リンクボタン。article-body.ts の型に厳密準拠）
- **patchChange**: `targetName`(非空), `targetKind`("champion"|"item"|"rune"|"system"|"bugfix"|"arena"|"augment"|"other"), `direction`("buff"|"nerf"|"adjust"), `intent?`, `groups`(配列)。
  - group: `abilityKey?`("passive"|"Q"|"W"|"E"|"R"|"base"), `abilityName?`, `abilityIconUrl?`(検証不正なら捨てる), `changes`(配列)。
  - change: **数値変更**(`stat`/`before`/`after` 全て非空) **または** **記述式変更**(`text` 非空・`stat`は任意ラベル)。
- **toc**: `items`(1件以上・各 `{label 非空, anchor 非空}`)。anchorは同一記事内に存在する heading の anchor に対応。
- **linkButton**: `url`(https のみ=`isSafeLinkButtonUrl`), `label`(非空)。
- （**image** はS3で対応済みだが、S4のAC「画像のalt空で保存拒否」等も併せて再確認する。**heading** の `anchor` 編集＝目次リンク先も本スプリントで担保。）

## 受け入れ基準（仕様書 Sprint 4 原文）
- [ ] カテゴリ「パッチ/メタ」の記事の「編集」を開くと、パッチ変更・目次・見出し・段落・画像・リンクボタンの各ブロックが種別ラベル付きのカードとして並び、生 JSON テキストエリアが表示されない。
- [ ] 「ブロックを追加」の選択肢に、パッチ記事で使う種別（パッチ変更／目次／見出し／段落／画像／リンクボタン）が並ぶ。
- [ ] パッチ変更（patchChange）ブロックのカードに、対象名・対象種別（チャンピオン／アイテム／ルーン／システム／バグ修正／アリーナ／オーグメント／その他の選択）・方向（バフ／ナーフ／調整の選択）・変更意図の編集欄がある。
- [ ] パッチ変更ブロックの対象名を変更して保存すると、プレビューの見出しがその名前に変わる。
- [ ] パッチ変更ブロックの方向を「バフ」から「ナーフ」に変更して保存すると、プレビューでの分類表示がナーフに変わる。
- [ ] パッチ変更ブロック内で「グループを追加」からスキル区分（パッシブ／Q／W／E／R／基礎ステータス）を選んでグループを追加し、スキル名を入力して保存すると、プレビューにそのグループが表示される。「グループを削除」で削除して保存すると消える。
- [ ] グループ内で「数値変更の行を追加」から項目名・変更前・変更後を入力して保存すると、プレビューに「項目名: 変更前 ⇒ 変更後」の形で表示される。
- [ ] グループ内で「記述式変更の行を追加」から本文を入力して保存すると、プレビューにその文が変更行として表示される。
- [ ] 変更行を削除して保存すると、その行がプレビューから消える。
- [ ] 数値変更の行で変更前・変更後のいずれかを空にしたまま保存しようとすると保存が拒否され、どのブロック・どのグループ・何行目が不正かが分かるエラーが表示され、記事は変更されない。
- [ ] 目次（toc）ブロックで項目（表示名・リンク先アンカー）を追加・編集・削除して保存でき、プレビューの目次に反映される。
- [ ] 見出しブロックのアンカーを編集して保存でき、目次の項目からその見出しへページ内リンクできることをプレビューで確認できる。
- [ ] 目次の項目に記事内に存在しないアンカーを指定して保存しようとすると保存が拒否され、原因が分かるエラーが表示され、記事は変更されない。
- [ ] 画像（image）ブロックの URL・代替テキスト・クレジットを編集して保存でき、プレビューに画像とクレジットが表示される。代替テキストを空にして保存しようとするとエラーが表示され保存されない。
- [ ] リンクボタン（linkButton）ブロックのラベルと URL を編集して保存でき、プレビューにボタンとして表示される。`http://`（非 https）や `javascript:` の URL を入れて保存しようとするとエラーが表示され、記事は変更されない。
- [ ] パッチ記事のブロックを「↑」「↓」で並べ替え、削除し、追加した結果が保存され、プレビューの表示順に反映される（S3 の基盤操作がパッチ系ブロックでも同様に効く）。
- [ ] 本追加の前から存在するパッチ記事を編集画面で開き、何も変更せずに保存しても、パッチ変更表・目次・バナー画像・公式リンクボタンの内容が一切変化しない。
- [ ] 反応記事（S3 で対応済み）の編集が本スプリントの変更後も従来どおり動作する（レス編集・強調・アンカー・埋め込みが壊れていない）。
- [ ] Riot公式・eスポーツ カテゴリの記事（見出し／段落／引用中心の構成）も編集画面で開いて編集・保存でき、プレビューに反映される。

## テスト観点（自動テストを書く対象・原文）
- パッチ変更ブロックの組み立て: 対象種別・方向の選択値が定義済みの語彙のみを受け付けること。グループと変更行の追加・削除の結果が期待した構造になること。数値変更（項目名・変更前・変更後がすべて非空）と記述式変更（本文が非空）の判別が入出力で正しいこと。
- 検証エラー: 数値変更の欠落、目次の未存在アンカー参照、画像の代替テキスト空、リンクボタンの非 https URL がいずれも保存拒否になり、原因位置を含むメッセージが返ること。
- 往復の同一性: 既存のパッチ記事・Riot公式記事を読み込み、無変更で保存したときに本文が元と完全一致すること。
- 全ブロック型の網羅: 既存の全ブロック種別（レス／Redditソース／見出し／段落／引用／画像／埋め込み／リンクボタン／目次／パッチ変更）について、編集フォームから組み立てた構造が本文検証を通ること。

## 評価基準（evaluator向け・原文）
- 致命的バグ: 0件 ／ コンソールエラー: 0件 ／ 上記受け入れ基準の充足率: 100% ／ テストスイート全体が Green

## 実装ガイド（既存コード結線・オーケストレーターより）
- **`article-editor-form.ts` を拡張**: patchChange/toc/linkButton を `type:"raw"` 素通しから **editable draft** に変える。`BlockDraft` union に3種のドラフト型を追加し、`createDraftBlock`/`blockToDraft`/`draftToRawBlock` の各switchにケースを足す（S3の反応系と同じパターン）。**往復同一性を最優先**: patchChange の任意フィールド（targetIconUrl/abilityKey/abilityName/abilityIconUrl/intent/changesのstatラベル）を落とさない。数値変更/記述式変更の判別は `article-body.ts` の `parsePatchChangeGroupChanges` と同じ規約（数値=stat/before/after全非空、記述式=text非空）に一致させる。
- **toc↔heading アンカー整合の全体検証**: S3の `validateReactionAnchors`（記事全体を見る層）と同じ場所に、**toc.items[].anchor が同一記事内の heading.anchor に存在すること**を検証する純関数を足す（存在しない→保存拒否・どのブロックか明示）。保存アクション(`updateArticleContent`)から呼ぶ。
- **エディタUI（ArticleEditor.tsx の `BlockFields`）**: patchChange カード=対象名(input)/対象種別(select 8値)/方向(select 3値)/変更意図(textarea)＋グループ群(追加/削除・abilityKey select/abilityName input)＋各グループの変更行(数値変更 or 記述式変更の切替・追加/削除)。toc カード=items(label/anchor の追加/編集/削除)。linkButton カード=label/url。「ブロックを追加」の選択肢にパッチ系種別を追加。ネストした配列(groups>changes)の操作は S3 の moveItem/removeItem/insert 相当を流用。
- **保存・検証**: 組み立てたブロックは既存 `parseArticleBody` を必ず通す（`InvalidArticleBodyError.message` は既に「本文ブロック[i]のgroups[g]のchanges[c]…」の粒度）。画像alt空/非https linkButton/数値変更欠落/未存在tocアンカーは保存拒否＋記事不変＋入力保持（S3のuseActionState経路を流用）。
- **プレビュー整合**: 保存後、既存の `ArticleBodyView`（パッチ表・目次・リンクボタン・画像の描画）で正しく表示（表示側は変更しない）。

## 制約・非目標
- ブロック型・`article-body.ts`の検証規則・表示コンポーネント・公開サイトの見た目は変更しない。S1の「要レビュー記事が公開側に出ない不変条件」を壊さない。
- **反応系(S3)の編集が回帰しないこと**＋**既存パッチ/Riot記事の往復同一性**（無編集保存で本文完全一致）を最重要テストに据える。
- 新規依存は最小限（WYSIWYG等は入れない）。テスト必須（パッチ変更の組み立て・数値/記述式判別・検証エラー・往復同一性・全10ブロック型網羅）。横1280pxで崩れない。
