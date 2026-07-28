# パッチ刷新S1 — 公式パッチノートHTMLのDOM構造抽出基盤（誤帰属ゼロの心臓部）

`docs/patch-accuracy-research.md`（ディープリサーチ）の実装第1歩。現状の「HTML平テキスト化→チャンピオン名を目印に⇒行を紐付け」方式が
誤帰属・スキルキー不明・対象不明を生んでいる。これを**公式HTMLのDOM構造をそのまま辿る純関数パーサ**に置き換える基盤を作る。**AI不使用**。対象: Web（バックエンド抽出）。

## 背景（実データで確定済み・research §1〜§3）
- 公式パッチノートHTMLは**元から完全に構造化**されている（`stripHtmlToText`が潰していただけ）。1対象=1 `patch-change-block`。
- **誤帰属の真因**: 「レベルアップごとの攻撃力：2 ⇒ 2.5」は**コーキ(Corki)**の基本ステータス変更だが、コーキが `CHAMPIONS`/`JP_NAME_TO_CHAMPION_ID`（title.ts/champion-splash.ts）に無いため、平テキスト経路が直前のアジール節へ誤紐付けしていた。
- **対象IDはアイコンURLのファイル名から取る**（`.../img/champion/Corki.png`→`Corki`、`.../img/item/3168.png`→`3168`）ので、名前マップの欠落に依存せず**リスト外チャンピオンも100%解決＝誤帰属ゼロ**。

### 実HTMLのDOM構造（research §1.3(c) 実データ）
```html
<h2>チャンピオン</h2>   <!-- セクション見出し: チャンピオン/アイテム/システム/バグ修正＆QoLの変更 等 -->
<div class="content-border"><div class="patch-change-block">
  <p><a class="reference-link"><img src="…/img/champion/Corki.png"></a></p>  <!-- 対象アイコン -->
  <h3 class="change-title"><a>コーキ</a></h3>                                 <!-- 対象名 -->
  <blockquote class="blockquote"><p>試合終盤の火力を少し高め…</p></blockquote> <!-- 変更意図 -->
  <hr class="divider">
  <h4 class="change-detail-title">基本ステータス</h4>                          <!-- スキルキー: 基本ステータス -->
  <ul><li><strong>レベルアップごとの攻撃力</strong>：2 ⇒ <strong>2.5</strong></li></ul>
  <hr class="divider">
  <h4 class="change-detail-title"><img src="…/img/spell/MissileBarrage.png">R - 連発ミサイル</h4> <!-- スキルキー: R + アイコン -->
  <ul><li><strong>通常攻撃による…短縮量</strong>：2秒～4秒（…） ⇒ <strong>2秒～6秒</strong></li></ul>
</div></div>
```
- セマンティッククラス（`patch-change-block`/`change-title`/`change-detail-title`/`blockquote`/`divider`）は**安定**（styled-componentsのハッシュクラス `.iKWdAA` 等は使わない）。

## 含まれる機能

### F-S1-1: パッチノート生HTMLの保持（riot-datadragon.ts）
- `fetchPatchNotesData`/`fetchPatchNotesText`（`riot-datadragon.ts`）で、現状の平テキスト（`stripHtmlToText`結果）に加えて**生HTML（またはDOM抽出済み構造）を保持し、記事化(candidate)へ渡せる**経路を追加する。既存の平テキスト経路は**温存**（後方互換・フォールバック用）。
- **取得の堅牢性（research 未確認事項2）**: 公式ノートURLは末尾スラッシュ有無でリダイレクトし、追従しないと0バイトになる場合がある。`fetchTextSafe` がリダイレクトを追うか確認し、追わないなら `/notes`↔`/notes/` の正規化 or リダイレクト対応を入れる（取得失敗時は従来どおり例外を投げず null）。

### F-S1-2: DOM構造パーサ（新規 patch-notes-parser.ts・純関数・AI不使用）
`src/lib/generation/patch-notes-parser.ts` に、生HTML→構造化データの純関数 `parsePatchNotesHtml(html: string): PatchChangeTarget[]` を実装する。型:
```ts
type PatchAbilityKey = "passive" | "Q" | "W" | "E" | "R" | "base";
type PatchChange = { stat: string; before: string; after: string };
type PatchChangeGroup = {
  abilityKey?: PatchAbilityKey;   // h4先頭トークンから判定（"R - …"→R, "基本ステータス"→base, "パッシブ"→passive）
  abilityName?: string;           // h4テキスト全体（例 "R - 連発ミサイル"）
  abilityIconUrl?: string;        // h4内 <img src>（基本ステータスは無し）
  changes: PatchChange[];
};
type PatchChangeTarget = {
  section?: string;               // 直近の<h2>（"チャンピオン"/"アイテム"/"システム"/"バグ修正…"）
  name: string;                   // h3.change-title のテキスト（例 "コーキ"）
  kind: "champion" | "item" | "rune" | "system" | "bugfix" | "other"; // アイコンURLパス/セクションで判定
  id?: string;                    // アイコンURLのファイル名（例 "Corki", "3168"）
  iconUrl?: string;               // ブロック先頭の対象アイコン
  intent?: string;                // blockquote のテキスト（変更意図）
  groups: PatchChangeGroup[];
};
```
- **抽出ルール（research §3.2）**:
  - `<h2>` を辿って現在の section を保持。
  - 各 `patch-change-block` ごとに1 `PatchChangeTarget`。`name`=`h3.change-title`テキスト、`iconUrl`=ブロック先頭 `<img src>`、`intent`=`blockquote`テキスト。
  - `kind`/`id`: `iconUrl` のパスで判定（`/img/champion/`→champion＋id=ファイル名、`/img/item/`→item＋id=数値、それ以外はsection名で system/bugfix/other）。アイコンが無いブロックは section から kind を推定。
  - 各 `h4.change-detail-title` ごとに1 `PatchChangeGroup`。`abilityKey`=先頭トークン判定、`abilityName`=h4全体、`abilityIconUrl`=h4内`<img>`。
  - 直後の `<ul><li>` ごとに1 `PatchChange`。`stat`=li内先頭`<strong>`、`before`=「：」と「⇒」の間、`after`=「⇒」以降の`<strong>`（無ければ⇒以降のテキスト）。**逐語維持・捏造禁止**（本文の文字をそのまま切り出すだけ。数値を作らない）。
- **HTMLパース手段の判断**: まず新規依存なしの限定パース（正規表現/軽量スキャン）で `patch-change-block`単位に安全に分割して実装を試みる。構造のネストで脆く保守困難になる場合のみ、**実績ある軽量HTMLパーサ（例 node-html-parser）を最小限追加**してよい（追加時は `npm audit` を実行し Critical/High が無いことを確認・レポートに明記）。どちらでも受け入れ基準（下記フィクスチャテスト）を満たすこと。
- 取得失敗・構造不一致・空入力では**例外を投げず空配列 `[]` を返す**（本体を止めない。呼び出し側が既存フォールバックに落とせる）。

### F-S1-3: バフ/ナーフ分類の再利用
- 抽出した各 `PatchChangeGroup` の `changes`（before/after）に、**既存の `classifyChange`/`classifyChampion`（compose.ts）をそのまま適用**して buff/nerf/adjust を付与できることを確認する（S2で本文組み立てに使う。S1では分類関数がDOM抽出結果に適用可能なことをテストで示せば十分。分類ロジック自体は変更しない）。

## 制約・非目標
- **AIは使わない**（DOMパース・分類・URL判定はすべて純ルール）。翻訳/SEO/他ソース/反応記事は変更しない。
- **逐語維持・捏造禁止**：変更前後・ステータス名・意図は本文の文字をそのまま切り出す。数値や文言を作らない。
- **S1は抽出基盤のみ**：本文ブロック(`patchChange`型)への反映・表示・デザインは**S2以降**（S1では compose の記事組み立てや article-body-view は変更しない。パーサと取得経路と型定義まで）。
- 既存の平テキスト経路（`stripHtmlToText`/`extractPatchSectionsDeterministic`）は**削除せず温存**（S2でフォールバックに降格）。DBスキーマ変更なし。新規依存は上記条件下の軽量HTMLパーサのみ許容（無ければ足さない）。

## テスト（必須・実データフィクスチャ・実ネット非依存）
1. **実HTMLフィクスチャの用意**: 公式パッチノート26.14のHTML（またはその代表的な`patch-change-block`を含む十分な断片）を `src/lib/generation/__fixtures__/`（既存慣行に合わせる）に保存し、`parsePatchNotesHtml` の入力にする。※取得はBashのcurl等で行い（リダイレクト追従に注意）、フィクスチャとしてコミットする。取得できない場合は、research §1.3(c) のDOM構造に忠実な代表フィクスチャを手で用意する。
2. **誤帰属ゼロの検証（最重要）**: フィクスチャで、
   - アジール(Azir)の `groups` が **W と R**（基本ステータスの攻撃力変更を含まない）。
   - コーキ(Corki)が独立した `PatchChangeTarget` として抽出され、`groups` に **基本ステータス（レベルアップごとの攻撃力 2⇒2.5）と R** を持つ。
   - コーキの `id="Corki"`（アイコンURLファイル名から。名前マップ非依存）。
3. スキルキー判定: `"R - 連発ミサイル"`→`abilityKey="R"`、`"基本ステータス"`→`"base"`、`"パッシブ"`→`"passive"`。
4. 対象種別/ID: champion/item のアイコンURLから kind と id（`Corki`/`3168`）が取れる。アイテム/システム/バグ修正ブロックが section から分類され、**対象名(h3)が個別に残る**（総称に潰さない）。
5. 逐語維持: before/after/stat がフィクスチャ本文の文字と一致（改変なし）。
6. 分類適用: 抽出結果に `classifyChange` を適用して buff/nerf/adjust が付く（例 CD短縮=buff、攻撃力増=buff）。
7. 異常系: 空文字/構造不一致HTMLで `[]` を返し例外を投げない。既存の compose/riot-datadragon テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. 26.14フィクスチャで**誤帰属ゼロ**（アジール=W/R、コーキ=基本ステータス(2⇒2.5)/R が正しい対象に）。リスト外チャンピオン（コーキ）も id 解決。スキルキー・対象名・意図・アイコンURLが構造的に取れる。
3. AI不使用・逐語維持・DBスキーマ変更なし・既存の平テキスト経路と他機能が不変。新規依存を足す場合は npm audit で Critical/High 無し。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 誤帰属ゼロがフィクスチャテストで確認できる（アジール/コーキの実例）。スキルキー・対象ID・意図・アイコンURLが抽出できる。異常系で空配列。
- S1のスコープ（抽出基盤）に留まり、表示/デザインS2以降に踏み込んでいない。既存機能が回帰しない。
- 受け入れ基準1〜3を満たす。
