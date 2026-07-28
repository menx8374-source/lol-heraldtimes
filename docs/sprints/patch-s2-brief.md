# パッチ刷新S2 — DOM抽出を記事本文へ反映（patchChangeブロック・compose置換）

`docs/patch-accuracy-research.md` §3・§7 S2。S1で作った正確なDOM抽出（`parsePatchNotesHtml`）を、実際のパッチ記事本文に反映する。
既存の平テキスト経路はフォールバックに降格。**AI不使用（純ルール）**。対象: Web。

## 背景（S1の成果と本スプリントの位置づけ）
- S1で `patch-notes-parser.ts` の `parsePatchNotesHtml(html): PatchChangeTarget[]` が完成（誤帰属ゼロ・アジール=W/R、コーキ=base(2⇒2.5)/R・id=Corki・スキルキー・意図・アイコンURL抽出済み）。`riot-datadragon.ts` は生HTML `html` を保持済み。
- 現状 `composeDetailedPatchBody`（compose.ts）は**平テキスト抽出**（`extractPatchSectionsDeterministic`）を使っており、これが誤帰属の温床。S2でこれを**DOM抽出ベースに置換**する。
- S1 generator が発見した既知課題: 既存 `classifyChange` は公式HTML表記（`2秒～4秒（…）`のような範囲＋括弧付随数値・スペース入りスラッシュ）で直感と異なる分類を返す。S2の direction 算出で対処する（下記 F-S2-3）。

## 含まれる機能

### F-S2-1: patchChangeブロック型（article-body.ts）
`src/lib/article-body.ts` の `ArticleBodyBlock` に**対象単位**の新ブロックを追加（後方互換）:
```ts
type ArticleBodyPatchChangeBlock = {
  type: "patchChange";
  targetName: string;                              // 対象名（h3。例 "コーキ"）
  targetIconUrl?: string;                          // 対象アイコン（champion square / item icon）
  targetKind: "champion" | "item" | "rune" | "system" | "bugfix" | "other";
  direction: "buff" | "nerf" | "adjust";           // 対象単位の総合方向（F-S2-3）
  intent?: string;                                 // 変更意図（blockquote）
  groups: {
    abilityKey?: "passive" | "Q" | "W" | "E" | "R" | "base";
    abilityName?: string;                          // "R - 連発ミサイル"
    abilityIconUrl?: string;                       // スキルアイコン（S3で表示）
    changes: { stat: string; before: string; after: string }[]; // 逐語
  }[];
};
```
- `parsePatchChangeBlock` 検証（既存 `parse*Block` 慣行に合わせる）: 画像URLは既存 `isSafeImageUrl` で検証、必須フィールド欠落は捨てる/正規化。逐語（stat/before/after）は改変しない。
- **S2では型追加は後方互換**（既存ブロックは不変）。search.ts/seo.ts等が `ArticleBodyBlock` を網羅走査していれば `patchChange` を無視/テキスト抽出に対応（未処理で落ちない）。

### F-S2-2: composeDetailedPatchBody を DOM抽出ベースに置換
`compose.ts`：
- **生HTMLの取得経路**: S1で `riot-datadragon` が保持した生HTMLを、`GenerationCandidateInput`（またはcompose入力）から受け取れるよう配線する（S1で candidate まで届いていなければここで繋ぐ）。パッチ記事生成時に `parsePatchNotesHtml(html)` を呼ぶ。
- `composeDetailedPatchBody` を、`PatchChangeTarget[]` から本文を組み立てる形に置換:
  - **G3の構造を踏襲**: 冒頭バナー画像 → 冒頭1文サマリ（`buildPatchIntroSummary` 流用、強化/弱体化/調整の体数集計） → 目次(toc) → **3グループ見出し「主な強化／主な弱体化／その他の調整」** に対象を direction で振り分け → 各対象を `patchChange` ブロックで出力 → 非チャンピオン章（アイテム/システム/バグ修正）。
  - チャンピオン対象は3グループへ、アイテム/システム/バグ修正対象はセクション（targetKind/section）ごとにまとめる。**総称に潰さず対象名(h3)を各カードに残す**（③解消）。
- **フォールバック（research §3.5）**: `parsePatchNotesHtml` が空（DOM構造変化・取得失敗）なら、**既存の平テキスト経路 `extractPatchSectionsDeterministic`→`composeDetailedPatchBody(旧)` に落とし、それも空なら `composePatchFactFlashBody`（事実速報）**。優先順位 DOM > 平テキスト > 事実速報。既存の平テキスト経路は削除しない。

### F-S2-3: direction（3分類）の複雑表記対応
対象単位の `direction`（buff/nerf/adjust）を算出する。**既存 `classifyChange`/`classifyChampion` を壊さず**（G3テスト維持）、公式HTML表記に頑健な判定を用意する:
- before/after から**代表数値**を抽出（範囲 `2秒～4秒` は末尾/最大値、括弧内 `（0.5秒ごとに…）` の付随数値は除外、単位「秒/%」やスラッシュ複数値に対応）。前後の代表数値を比較。
- **反転ステータス**（クールダウン/マナ/コスト/再使用/消費/詠唱時間 等 `LOWER_IS_BETTER_TERMS`）は減少=強化で反転（G3と同じ思想）。ただし「短縮量」「軽減量」のように**"量"が増える=強化**の語もあるため、少しでも曖昧なら **adjust に安全に倒す**（誤って強化/弱体を断定しない＝正確性優先。research の大原則）。
- 対象単位の集約: 全 group の全 change を分類し、全て buff→buff／全て nerf→nerf／混在・判定不能→adjust。
- 既存 `classifyChange` をそのまま使うと誤るケース（S1発見）は、この新しい代表数値抽出で吸収する。既存関数を変更する場合はG3の既存テストが回帰しないこと。

### F-S2-4: 最低限のレンダリング（article-body-view.tsx・素朴版）
記事が表示できるよう、`patchChange` ブロックの**素朴なレンダリング**を追加する（**デザインはS4・画像はS3**。S2はプレーンで良い）:
- 対象名（＋direction のラベル「強化/弱体化/調整」）、各 group のスキルキー/abilityName、`before ⇒ after`（statとともに）、intent を、既存の見た目に沿ったプレーンなHTMLで表示。
- 画像（targetIconUrl/abilityIconUrl）はS3で追加するため、S2では**未表示 or alt文字のみ**でよい（URLはブロックに保持済み）。
- 既存記事（patchChangeを持たない）・他ブロックの表示は不変。

## 制約・非目標
- **AIは使わない**（抽出・分類・組み立ては純ルール）。翻訳/SEO/反応記事/他ソースは変更しない。
- **逐語維持・捏造禁止**：stat/before/after/intent は本文の文字をそのまま。数値・文言を作らない。3分類は表示のグルーピングのみ。
- **デザイン（黒/紺・金/teal）と画像転用はS2では行わない**（S3/S4）。S2は「正しい対象・スキルキー・変更前後・意図が本文に出る」ことが目的。
- 既存の平テキスト経路（`extractPatchSectionsDeterministic`/旧`composeDetailedPatchBody`ロジック）は**フォールバックとして温存**。`fact`/`summary`モード・非パッチ記事は不変。DBスキーマ変更なし・新規依存なし。

## テスト（必須・S1フィクスチャ流用・実ネット非依存）
1. 26.14フィクスチャ（S1の`__fixtures__/patch-26-14.html`）で `composeDetailedPatchBody`（新）が: アジール=W/R、コーキ=base(2⇒2.5)/R を**正しい対象カード**で出す。対象名・スキルキー・before/after・意図が本文ブロックに乗る。
2. direction: 攻撃力2⇒2.5=buff、CD短縮=buff、曖昧な範囲表記=adjust（安全側）。3グループ振り分け・冒頭サマリ・目次が出る。
3. アイテム/システム/バグ修正が**対象名付き**で出る（総称に潰れない）。
4. フォールバック: 空HTML/構造不一致で平テキスト経路→事実速報に落ちる（既存挙動）。DOM成功時は平テキストを使わない。
5. patchChangeブロックの検証（parsePatchChangeBlock）・article-body-viewの素朴レンダリング（renderToStaticMarkup）。既存の compose/article-body/article-body-view/seo/search テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. パッチ記事本文が、DOM抽出由来で**正しい対象・スキルキー・変更前後・意図**を表示し、アイテム/バグ修正/システムも個別対象名で出る（誤帰属ゼロが記事に反映）。3分類・サマリ・目次は維持。
3. DOM失敗時は既存平テキスト→事実速報にフォールバックし壊れない。AI不使用・逐語維持・DBスキーマ変更なし・新規依存なし・非パッチ記事とfact/summaryモード不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 26.14記事で誤帰属ゼロが本文表示に反映（アジール/コーキの実例）。スキルキー・対象名・意図が出る。direction が曖昧表記をadjustに安全に倒す。
- フォールバックが機能し既存挙動が壊れない。S3(画像)/S4(デザイン)に踏み込みすぎていない（素朴表示に留める）。
- 受け入れ基準1〜3を満たす。
