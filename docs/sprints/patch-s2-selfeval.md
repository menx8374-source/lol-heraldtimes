---
tags: [sprint-selfeval]
sprint: patch-s2
---

# パッチ刷新S2 自己評価レポート

## 実装した内容
- `src/lib/article-body.ts`（F-S2-1）: `ArticleBodyPatchChangeBlock`/`ArticleBodyPatchChangeGroup` 型を追加し `ArticleBodyBlock` union に合流（後方互換）。`parsePatchChangeBlock`/`parsePatchChangeGroups`/`parsePatchChangeGroupChanges` で検証（targetName/targetKind/direction/groups必須、targetIconUrl/abilityIconUrlは既存`isSafeImageUrl`で検証し不正なら例外にせず捨てる、stat/before/after欠落は例外）。`blockText`に`patchChange`ケースを追加（targetName＋intent＋abilityName＋stat：before ⇒ after）。groups/changesが空配列でも許容（誤帰属ゼロの数値なし対象・捏造しない）。
- `src/lib/generation/patch-notes-parser.ts`: 変更なし（S1のまま利用）。
- `src/lib/generation/compose.ts`（F-S2-2/F-S2-3）:
  - `GenerationCandidateInput`に`html?: string | null`を追加。
  - 既存の平テキストベース`composeDetailedPatchBody`を`composeDetailedPatchBodyFromText`にリネームし、ロジックは無変更のままフォールバックとして温存。
  - 新規`composeDetailedPatchBody(candidate, targets: PatchChangeTarget[])`（DOM抽出ベース）を追加。G3構造踏襲: バナー画像→冒頭サマリ→目次→3グループ(主な強化/主な弱体化/その他の調整、チャンピオン対象のみ)→各対象を`patchChange`ブロックで出力→非チャンピオン対象(アイテム/システム等)を`target.section`ごとにグルーピングして同様に出力→出典リンクボタン。対象名(h3)は各`patchChange`ブロックのtargetNameに個別のまま残す(総称に潰さない)。
  - `composeArticleBody`のriot/detailed分岐: 優先順を「`candidate.html`があれば`parsePatchNotesHtml`→非空ならDOM版採用」→「空/未取得なら`extractPatchSectionsDeterministic`→平テキスト版(フォールバック)」→「それも空なら事実速報」に変更。
  - F-S2-3: `classifyPatchChange`/`classifyPatchTargetDirection`(新規export)を追加。DOM抽出済み`{stat,before,after}`から代表数値を抽出して比較する新ロジック（既存`classifyChange`/`classifyChampion`は一切変更していない＝G3テスト無変更で回帰なし）。
    - 代表数値抽出`extractPatchRepresentativeValue`: 括弧内付随数値を除外、範囲表記(`2秒～4秒`、数値と`～`の間に単位文字が挟まる実データ表記に対応)は最大値、スラッシュ複数値(`150 / 250 / 350`)は合計値、単一値はそのまま。ただし単一値候補が文中に2件以上ある(例:`魔力100ごとに10%`)場合は判別不能として抽出失敗(null)にする(安全側)。
    - 比較時、代表値の種類(単一/範囲/スラッシュ)が前後で食い違う・スラッシュの個数が食い違う・同値の場合は`adjust`（誤って強化/弱体を断定しない）。
    - 反転語(`LOWER_IS_BETTER_TERMS`)を含むstatは「減る=強化」に反転するが、statに「量」を含む場合(短縮量/軽減量等、量自体の増加が強化を意味する語)は反転しない。
    - 対象単位(`classifyPatchTargetDirection`)は全groupの全changeを集約し、全てbuff→buff/全てnerf→nerf/混在・変更点0件・全て判定不能→adjust。
- `src/components/article-body-view.tsx`（F-S2-4）: `patchChange`ブロックの素朴レンダリング（`PatchChangeBlockView`）。対象名＋directionラベル([強化]/[弱体化]/[調整])・各groupのabilityName/abilityKey・`stat：before ⇒ after`のリスト・intent(あれば)をプレーンなHTMLで表示。`data-patch-change`/`data-patch-direction`属性を付与。画像(targetIconUrl/abilityIconUrl)は未表示(URLはブロックに保持のみ、表示はS3)。デザイン(黒/紺・金)はS4のため未着手、既存ブロックの表示は不変。
- 生HTMLの配線(S1→S2、DBスキーマ変更なし):
  - `src/lib/collection/types.ts`: `RawCollectionItem`/`CollectionItem`に`html?: string`を追加。
  - `src/lib/collection/collect-source.ts`: `toCollectionItems`で`html`を転記。
  - `src/lib/collection/adapters/riot-datadragon.ts`: `buildPatchItem`に`html`引数を追加し(本文が十分な長さのときのみ設定)、`fetchItems`から配線。
  - `src/lib/collection/persist-posts.ts`: `item.html`があれば既存JSON列`Post.media`にキー追加する形で保存(新規カラム追加なし)。
  - `src/lib/generation/generate-article.ts`: `GenerationCandidate`に`html?: string | null`を追加。
  - `src/lib/generation/post-pipeline.ts`: `extractPostHtml(post.media)`を追加し、`candidate.html`へ配線(compose.ts側のDOM抽出に届く)。
  - 旧経路(`generation/pipeline.ts`、CollectedItemベース)は`CollectedItem`にmedia/htmlの概念が無く、既定の生成経路(`GENERATION_SOURCE`未設定は"post")でもないため配線していない(候補の`html`は常にundefined→既存の平テキストフォールバックへ、回帰なし)。

## 技術選定
- 新規npm依存は追加していない（正規表現ベースの純関数のみで代表数値抽出・direction算出を実装。S1の判断を踏襲）。
- 生HTML保持先は新規DBカラムではなく既存の`Post.media`(JSON列)へのキー追加を選択（brief制約「DBスキーマ変更なし」に合致。パッチ検知は月2回程度の低頻度のためJSON列肥大化の運用コストも軽微）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1391 tests / 107 files）、`npx tsc --noEmit` エラー0、`npm run build` 成功、`npm run lint` エラー0（既存の警告6件のみ、本スプリント起因ではない・S1時点と同一）。
- [x] パッチ記事本文がDOM抽出由来で正しい対象・スキルキー・変更前後・意図を表示することを確認: 26.14実HTMLフィクスチャで、アジール(groups=["W","R"]、攻撃力変更を含まない=誤帰属なし)、コーキ(groups=["base","R"]、base changes=[{レベルアップごとの攻撃力,2,2.5}]、R group abilityName="R - 連発ミサイル"、intentに「試合終盤のコーキの出撃時の火力を少し高め」を含む)を正しい対象カード(`patchChange`ブロック)で出すことをテストで確認。アイテム(不滅の道/プロトプラズム ハーネス/ヘクステック ロケットベルト)・システム(ブルーバフ)がtargetName付きで出て、総称(「アイテム」「システム」という文字列)がtargetNameとしては出ないことを確認（見出しとしては「アイテム」「システム」が出る＝グルーピング単位のみ総称、対象自体は個別）。3グループ見出し・冒頭サマリ・目次・末尾リンクボタンを確認。
- [x] direction算出: 攻撃力2⇒2.5(単一値増加)=buff、リチャージ短縮量の範囲最大値増加(2秒～4秒⇒2秒～6秒)=buff(反転しない)、範囲の曖昧表記(200～300⇒100～300、最大値同値)=adjust、コスト/クールダウン増加(反転語)=nerf、を単体テストで確認。曖昧・種類食い違い・判別不能ケースは安全側でadjustに倒すことを確認。
- [x] DOM失敗時フォールバック: `candidate.html`未指定、または構造不一致HTML(`patch-change-block`を含まない→`parsePatchNotesHtml`が空配列)の場合、既存の平テキスト経路(`composeDetailedPatchBodyFromText`)にフォールバックし、`patchChange`ブロックが1つも出ないこと・見出し「アジール」等の旧来表示になることをテストで確認。html・contentともに使えない場合は事実速報にフォールバックすることも確認。
- [x] AI不使用（DOM抽出・direction算出・組み立てはすべて純ルール）。逐語維持（stat/before/after/intentはpatch-notes-parser.tsの抽出結果をそのまま転記、compose.ts側で文字列を作り替えていない）。DBスキーマ変更なし（`Post.media`の既存JSON列にキー追加のみ）。新規依存なし。fact/summaryモード・非パッチ記事(5ch/reddit/riot-news/x)は無変更（既存回帰テスト全Green）。
- [x] S3(画像表示)/S4(デザイン)に踏み込みすぎていない: `article-body-view.tsx`のレンダリングはプレーンなdiv/ul（黒/紺・金のデザインは未実装）。targetIconUrl/abilityIconUrlはブロックのデータとして保持するのみで`<img>`は描画していない。

## アプリの起動方法
- 本スプリントは本文組み立てロジック（純関数）＋DB配線が中心。UI確認はS3/S4のデザイン確定後が本番だが、既存の記事表示導線で最低限の動作確認は可能:
  - 開発サーバー: `npm run dev`（http://localhost:3000）。パッチ記事は `/articles/[slug]` で `ArticleBodyView` により表示される。
  - 検証コマンド（すべてリポジトリルートで実行）: `npx vitest run`（テスト）、`npx tsc --noEmit`（型検査）、`npm run build`（ビルド）、`npm run lint`（lint）。
  - 本スプリントでは自己確認用にサーバーを起動していない（自動テスト・ビルド・型検査で機能確認が完結する範囲のため）。

## 既知の問題・懸念点
- direction算出の代表数値抽出は正規表現ベースのため、「魔力100ごとに10%」のように文中に数値候補が複数ある単一値表記は判別不能としてadjustに倒している（意図的な安全側設計だが、本来nerf/buffと判定できたはずのケースをadjustに丸めてしまう保守的すぎる面がある）。誤って強化/弱体を断定するリスクよりも安全側を優先した設計判断であり、brief記載の「曖昧はadjustに安全に倒す」方針に沿う。
- レシピ変更（例:「ヘクステック オルタネーター + ... + 300ゴールド ⇒ ... + 350ゴールド」）のように、statが実質「アイテム構成」であるにもかかわらず末尾の金額のみを拾ってbuff/nerf判定してしまう表記は、機械的には代表数値の増減で処理されるため、意味的に正しくない場合がある（briefの必須テスト対象ではなく、実装スコープ外の限界として記載のみ）。
- 旧経路（`generation/pipeline.ts`、`GENERATION_SOURCE=collected`時のみ使用）はhtmlを配線していない。既定経路（`post`）では問題ないが、`collected`を明示指定した運用ではDOM抽出は使われず常に平テキストフォールバックになる（既存挙動どおりで回帰ではない）。
- Riotの公式パッチノートDOM構造は将来変わりうる（S1と同じ既知の限界）。構造変化時は`parsePatchNotesHtml`が空配列を返し、本スプリントで実装した優先順位（DOM→平テキスト→事実速報）により自動的にフォールバックするため、記事生成自体は壊れない。

## 追加したテスト
- `src/lib/__tests__/generation-compose-patch-dom.test.ts`（新規、21件）: composeArticleBody(riot detailed, DOM抽出)の誤帰属ゼロ確認(アジール/コーキ)、アイテム/システムの対象名付き表示、3グループ/サマリ/目次/リンクボタン、`classifyPatchChange`の各種direction算出(buff/nerf/adjust/曖昧/種類食い違い/判別不能)、DOM抽出フォールバック（html未指定・構造不一致・事実速報フォールバック）。
- `src/lib/__tests__/article-body.test.ts`: `parsePatchChangeBlock`の正常系・異常系(targetName空・targetKind不正・direction不正・groups非配列・changes欠落・abilityKey不正)・不正画像URLの正規化(捨てる)・groups空配列許容、`blockText`のpatchChangeケース。
- `src/components/__tests__/article-body-view.test.tsx`: patchChangeブロックの素朴レンダリング(対象名/directionラベル/abilityName/before⇒after/intent/data属性)、他ブロックと混在時の非破壊。
- `src/lib/__tests__/collection-collect-source.test.ts`: `html`の転記・未設定時のキー欠落確認。
- `src/lib/__tests__/collection-persist-posts.test.ts`: `item.html`のPost.media.htmlへのマージ・未設定時の非影響。
- `src/lib/__tests__/collection-riot-datadragon.test.ts`: `buildPatchItem`のhtml引数・本文短すぎ時の非設定・`fetchItems`からの配線。
- `src/lib/__tests__/generation-post-pipeline.test.ts`: `Post.media.html`からcandidate.htmlへの配線→DOM抽出→`patchChange`ブロックがArticle.bodyに反映されるE2E確認。

## 関連ドキュメント
- [[sprint-patch-s2-brief]]（本スプリントの仕様抜粋、`docs/sprints/patch-s2-brief.md`）
- `docs/patch-accuracy-research.md`（設計根拠のディープリサーチ）
- [[sprint-patch-s1-selfeval]]（前スプリントS1の成果）
