# パッチノート記事の正確性刷新＋LoL公式風デザイン化 ディープリサーチ

> 調査日: 2026-07-28 / 対象: `src/lib/generation/compose.ts`（detailedパッチ本文）・`src/lib/collection/adapters/riot-datadragon.ts`・`src/components/article-body-view.tsx`
> 本ドキュメントは**実装ではなく設計・根拠・ロードマップ**。すべての主張は実データ（DDragon実JSON・CDragon実JSON/PBE・公式パッチノート26.14の実HTML）で裏取り済み。

---

## 0. TL;DR（結論）

1. **誤帰属の真因は「HTML平テキスト化 → チャンピオン名を目印に⇒行を紐付ける」方式**。実HTMLは `patch-change-block` 単位でチャンピオン/アイテムごとに完全に構造化されており、平テキスト化がこの階層を破壊している。
2. **実データで犯人を特定**: 「レベルアップごとの攻撃力：2 ⇒ 2.5」は**アジールではなくコーキ（Corki）の基本ステータス変更**。コーキは `CHAMPIONS`/`JP_NAME_TO_CHAMPION_ID` に存在せず、チャンピオン境界として認識されないため、直前に開いた**アジール節に吸い込まれて**誤表示される。
3. **本命は「公式パッチノートHTMLのDOM構造解析」**（平テキスト化しない）。`patch-change-block > h3(対象名) > change-detail-title(スキルキー) > li(before ⇒ after)` を辿るだけで、対象・スキルキー(passive/Q/W/E/R)・変更前後が**曖昧さゼロ**で取れる。しかもDOMには**チャンピオン/スキル/アイテムのアイコンURLが埋め込まれており**、対象IDまで確定できる。
4. **DDragonの構造diffは balance変更の抽出には使えない（重要）**。16.13.1→16.14.1のDDragon champion diffは**変更ゼロ**（後述）。近年のDDragonは spell の `datavalues` が空・`effect` がほぼ全ゼロで、レシオ/ダメージ等の数値がそもそも入っていない。DDragonは**画像・名前ID解決・アイテム価格**に使い、変更抽出には使わない。
5. **未適用パッチ（PBE/本番反映前）**は、live専用のDDragonでは扱えない。**CDragon PBE**（実測で本番の1パッチ先＝16.15を先行公開）と**公式HTML DOM**で先行記事化し、**本番反映後にDDragon/CDragon latestで正確版へ自動更新**するハイブリッドにする。
6. **AIは使わない**（数値・純ルールの構造抽出）。既存の `SourceAdapter`/`compose`/`ArticleBodyView` と `ArticleBodyBlock` 型に新ブロック（`patchChange`）を1つ足すだけで収まる。

---

## 1. 現状の根本原因（実データ裏取り）

### 1.1 現行フローとコード箇所

現行のdetailedパッチ記事は次の経路（`compose.ts`）:

```
公式HTML → stripHtmlToText()（riot-datadragon.ts:105）で平テキスト化
  → extractPatchSectionsInternal()（compose.ts:1161）が
     「行が CHAMPIONS に一致 → チャンピオン節開始／⇒を含む行 → 変更点」で紐付け
  → composeDetailedPatchBody()（compose.ts:1345）で本文ブロック化
```

問題の中核は `stripHtmlToText()`（`riot-datadragon.ts:105-117`）:

```ts
const withoutTags = withoutScripts.replace(/<[^>]+>/g, "\n"); // ← 全タグを改行に潰す
```

**この1行でDOM階層（どのチャンピオン配下の・どのスキルの・どのステータスか）が完全に失われる**。以降の `extractPatchSectionsInternal` は、平テキスト化した行列に対して次のヒューリスティックで“復元”を試みる（が原理的に不可能）:

- 単独行が `CHAMPIONS`（`title.ts:78`）に完全一致 → その行を新チャンピオン節の開始とみなす（`compose.ts:1176`）
- 節内で `⇒` を含む行 → 変更点。直前の非空行（`prevLine`）をスキル名/項目名として前置（`consumeChangeLine`, `compose.ts:1108`）
- チャンピオン名に一致しない短い行（スキル記号 Q/W/E/R・ステータス名）は**見出しにしない**＝単なる文脈行として次の`⇒`行に前置されるだけ（`compose.ts:1211`）

### 1.2 4つの不具合が生まれる機序（それぞれコード対応）

| ユーザー報告 | 機序 | 該当コード |
|---|---|---|
| **①誤帰属**（コーキの攻撃力がアジール表示） | チャンピオン節は「次に`CHAMPIONS`一致行が来るまで」開きっぱなし。**リスト外チャンピオン（コーキ）の節が認識されず**、その`⇒`行が直前のアジール節に吸い込まれる | `compose.ts:1176-1216`（節の継続条件）／`title.ts:CHAMPIONS`（コーキ不在） |
| **②スキルキー不明**（passive/Q/W/E/R が分からない） | 平テキストでは「R - 連発ミサイル」の見出しと `⇒` 行の対応が切れる。`prevLine`前置は**直前の1行**しか見ないため、間にステータス名等が挟まるとスキルキーが落ちる | `consumeChangeLine`の`prevLine`（`compose.ts:1128`） |
| **③対象不明**（アイテム/バグ修正が何の話か不明） | 非チャンピオン節は `SECTION_KEYWORD_HEADING_TERMS`（"アイテム"等の総称語, `compose.ts:1041`）でしか括れず、**個々の対象名（アイテム名・チャンピオン名）が見出しにならない**。総称見出し「その他の変更点」に落ちる | `extractPatchSectionsInternal`の非チャンピオン分岐（`compose.ts:1218-1250`） |
| **④画像がスプラッシュのみ** | 平テキスト化で画像タグが消えるため、DOM内のアイコンURLが使えない。`composeDetailedPatchBody`は `championNameToId`→スプラッシュURLしか組めない | `compose.ts:1381-1389`／`champion-splash.ts` |

### 1.3 実データによる決定的証拠

**(a) DDragonの実JSONで「アジールではない」ことを確認**

`ddragon.leagueoflegends.com/cdn/{16.14.1,16.13.1}/data/ja_JP/champion/Azir.json` を両パッチ取得し diff:

- アジールの `stats.attackdamageperlevel` = **0（両パッチとも）**。「2 ⇒ 2.5」はアジールの値ではありえない。
- アジールの cost/cooldown/effect にも 16.13→16.14 の差分なし。

**(b) 公式26.14の実HTMLをDOM解析 → 真犯人はコーキ**

`league-of-legends-patch-26-14-notes`（261KB, 静的HTMLで取得可）を `<style>`除去後にブロック抽出:

```
BLOCK 1  h3=アジール         change-detail-title = ["W - 目覚めよ！", "R - 皇帝の分砂嶺"]
BLOCK 2  h3=コーキ           change-detail-title = ["基本ステータス", "R - 連発ミサイル"]
                             before/after: 「：2 ⇒ 2.5」「：2秒～4秒（…） ⇒ 2秒～6秒」
```

**アジールの実際の変更は W と R**であって攻撃力ではない。「レベルアップごとの攻撃力 2 ⇒ 2.5」は**コーキの基本ステータス**。コーキが `CHAMPIONS`/`JP_NAME_TO_CHAMPION_ID` に無い（`grep コーキ|Corki` → src/lib/generation にヒット0）ため、平テキスト経路がアジール節へ誤紐付けする——報告①の完全再現。

**(c) 公式HTMLのDOMは元から完全構造化されている**（平テキスト化が破壊しているだけ）

コーキ節の実DOM（簡約）:

```html
<div class="content-border"><div class="patch-change-block">
  <p><a class="reference-link"><img src="…/cdn/16.13.1/img/champion/Corki.png"></a></p>
  <h3 class="change-title"><a>コーキ</a></h3>
  <blockquote class="blockquote"><p>…試合終盤の火力を少し高め…（＝変更意図）</p></blockquote>
  <hr class="divider">
  <h4 class="change-detail-title">基本ステータス</h4>
  <ul><li><strong>レベルアップごとの攻撃力</strong>：2 ⇒ <strong>2.5</strong></li></ul>
  <hr class="divider">
  <h4 class="change-detail-title"><img src="…/img/spell/MissileBarrage.png">R - 連発ミサイル</h4>
  <ul><li><strong>通常攻撃による…短縮量</strong>：2秒～4秒（…） ⇒ <strong>2秒～6秒</strong></li></ul>
</div></div>
```

つまり、対象名（h3）・スキルキー（h4のテキスト "R - …" / "基本ステータス"）・ステータス名（li内 `<strong>`）・変更前後（`：before ⇒ <strong>after</strong>`）・**変更意図（blockquote）**・**アイコンURL（champion/spell/item）**が、すべてDOMに揃っている。現行は `stripHtmlToText` でこれを全部捨てている。

---

## 2. 【必須】未適用パッチ（PBE / 本番反映前）のケース

ユーザー追加要望。DDragonは**本番リリース済みバージョンのJSONしか公開しない**ため、パッチノートが出たが本番反映前のタイミングでは「新旧diff」ができない。実データで裏取りした。

### 2.1 DDragon は live のみ（実測）

- `api/versions.json` は 495件、先頭 = **16.14.1**（＝現行live）。16.15系（PBE中の次パッチ）は**存在しない**。
- `raw.communitydragon.org/latest/content-metadata.json` = **16.14**（DDragon latest と一致＝live）。

→ DDragonは「本番適用済みの断面」しか持たない。反映前は前パッチとの構造diffが原理的に取れない。

### 2.2 CDragon PBE は次パッチを先行公開（実測）

- `raw.communitydragon.org/pbe/content-metadata.json` = **16.15.7991534+branch.releases-16-15**（＝liveの1つ先）。
- `raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/champions/268.json`（Azir）→ **HTTP 200・実データ取得可**。スキーマは latest と同一。
- CDragonのスキル数値は **`coefficients`（例 `coefficient1:0.35`）・`effectAmounts`（Effect1〜NのLv別配列）・`cost`/`cooldown`** を持つ（DDragonの空 `datavalues` と対照的に**実数値が入っている**）。ただし cost/cooldown 表示文字列は `@Cost@` 等のテンプレなので、数値は `effectAmounts`/`coefficients` から取る。

**PBEデータの注意（流動性）**: PBEは本番までに数値が変わりうる。CDragon PBEは「ゲームクライアントのbinをそのまま反映」する非公式ミラーで、更新は自動だが**Riotの公式訳（ja_JP）・変更意図・バグ修正記述は持たない**。数値の速報には使えるが、記事の“意味づけ”は公式HTMLに依存する。

### 2.3 DDragon と CDragon のスキーマ差（要注意）

| 項目 | DDragon (`champion/<Id>.json`) | CDragon (`champions/<key>.json`) |
|---|---|---|
| キー | チャンピオンID文字列（Azir） | 数値key（268） |
| 日本語名 | `ja_JP` あり | `default`＝英語のみ（言語別は別ルート） |
| スキル数値 | `datavalues`空・`effect`ほぼ0（**使えない**） | `coefficients`/`effectAmounts` に実数値 |
| アイコン | `img/spell/<full>.png`（要ver） | `abilityIconPath`（/lol-game-data/…、ver不要のlatest/pbe配信） |
| 変更意図/バグ修正/公式訳 | なし | なし |
| PBE | なし | `/pbe/` で先行取得可 |

### 2.4 反映前の“意味づけ”は公式HTML DOM 一択

反映前でも**公式パッチノートHTMLは先に公開される**（本番clientパッチより先に記事が出るのが通例）。§1.3(c)のDOMは反映前でも同じ構造・同じ日本語訳・変更意図・アイコンURLを持つため、**未適用時の対象/スキルキー/前後/意図/アイコンはすべて公式HTMLのDOMで正確に取れる**（DDragon非依存）。CDragon PBEは「公式HTMLがまだ薄い/未翻訳の速報時に数値を補完する」補助と位置づける。

### 2.5 ハイブリッド＋自動更新（速報性と正確性の両取り）

当プロジェクトには既に「伸びた記事の再生成」等の記事更新機構がある（`generate-article.ts` 周辺・Post再生成）。これを流用し、**同一パッチ記事を状態遷移で更新**する:

```
[速報段階] 公式HTML公開を検知（本番反映前）
   → 公式HTML DOM解析で正確な対象/スキルキー/前後/意図/アイコンを記事化（DDragon不要）
   → 数値の空欄はCDragon PBEで補完可（任意）
   → 記事に patchStage="preview"（PBE/反映前）バッジ
        ↓ 本番反映（versions.json 先頭が当該パッチに更新）を検知
[確定段階] DDragon/CDragon latest で最終数値を照合し、
   → 公式HTML DOM（確定版・改訂される場合あり）を再解析して同じ記事を上書き更新
   → patchStage="live"（確定）へ。externalId=patchLabel（buildPatchItem, riot-datadragon.ts:232）で
     同一パッチを一意特定して差し替え
```

- **QDF/速報の価値**: 公式HTMLは反映前に出るので、先行して正確な記事を出せる（現状より速く・正確）。
- **正確性**: 反映後にDDragon実数値で「アイコンver・アイテム価格・最終数値」を確定し、公式HTMLの改訂（hotfix）も取り込む。
- **一意性**: `externalId = publicPatchNumber`（例 "26.14"）を既に持つため、preview→liveの差し替え先を確実に特定できる。

---

## 3. 正確な抽出の設計（本命）

### 3.1 方針: 「公式HTML DOMパース」を第一データ源、DDragon/CDragonは補助

平テキスト化（`stripHtmlToText`）をパッチ抽出経路から外し、**構造化パーサ**を新設する。誤帰属がゼロになる根拠は「対象・スキル・前後がDOMで既にネストしている（推測で紐付けない）」こと。

### 3.2 パースアルゴリズム（純関数・AI不使用）

軽量HTMLパーサ（後述の依存判断）で以下を抽出:

```
セクション見出し = <h2>（"チャンピオン"/"アイテム"/"システム"/"バグ修正＆QoLの変更" 等、§1.3(c)で実在確認）
各 <div class="patch-change-block"> ごとに 1 ChangeTarget:
  target.name      = h3.change-title のテキスト（例 "コーキ"）
  target.iconUrl   = ブロック先頭の <img src> （champion/ item / spell いずれか）
  target.kind      = iconUrl のパスで判定: /img/champion/→champion, /img/item/→item, それ以外→system/bugfix
  target.id        = iconUrl から抽出（例 champion/Corki.png → "Corki", item/3168.png → "3168"）★名前マップ不要
  target.intent    = blockquote.blockquote のテキスト（変更意図。現状は捨てている）
  各 <h4 class="change-detail-title"> ごとに 1 ChangeGroup:
    group.abilityKey = テキスト先頭の "Q "/"W "/"E "/"R "/"基本ステータス"/"パッシブ" を判定（passive/Q/W/E/R/base）
    group.abilityName= h4テキスト全体（例 "R - 連発ミサイル"）
    group.iconUrl    = h4内 <img src>（スキルアイコン。基本ステータスは無し）
    直後の <ul><li> ごとに 1 Change:
      change.stat   = li内 先頭 <strong> のテキスト（例 "レベルアップごとの攻撃力"）
      change.before = "：" と "⇒" の間のテキスト（例 "2"）
      change.after  = "⇒" 以降の <strong> のテキスト（例 "2.5"）
      change.dir    = classifyChange 相当（既存の buff/nerf/adjust ロジックを再利用, compose.ts:978）
```

**キー設計上の勘所**:
- 対象IDは**アイコンURLのファイル名から取る**（`Corki.png`→Corki, `3168.png`→3168）。これで `JP_NAME_TO_CHAMPION_ID`（表記ゆれ・欠落＝コーキ問題）に依存せず、リスト外チャンピオンも100%解決。名前表示は h3 の日本語をそのまま使う。
- スキルキーは h4 見出しの先頭トークンで確定（"R - 連発ミサイル"→R）。②を解消。
- アイテム/バグ修正/システムも同じ `patch-change-block` 構造で、h3 に個別の対象名（アイテム名等）が入る。③を解消（総称見出しに落とさない）。

### 3.3 「バフ/ナーフ/調整」分類は既存ロジックを再利用

`classifyChange`/`classifyChampion`（`compose.ts:978-1017`）は `⇒` 前後の数値比較＋`LOWER_IS_BETTER_TERMS`反転で既に妥当。DOM抽出後の `change.before/after` に対してそのまま適用でき、冒頭サマリ（`buildPatchIntroSummary`）も流用できる。

### 3.4 DDragon/CDragonの役割（変更抽出には使わない・実測根拠）

DDrago構造diffが**変更抽出に使えない**ことの実測:

- 16.13.1→16.14.1 の全チャンピオン（173体）diff:
  - 基本ステータス差分 **0件**、spell cost/cooldown差分 **0件**、effect差分 **0件**、datavalues差分 **0件**、vars差分 **0件**。tooltipテキスト差分 **1件のみ**（Anivia）。
  - 全692スキル中 `datavalues` が空 = **692/692**、`effect` が実質全ゼロ = **451/692**。
- → 公式26.14には多数のchampion balance変更があるのに、**DDragon diffはほぼ何も検出しない**。レシオ/ダメージ/短縮量などの数値がDDragonの構造フィールドに載っていないため。

したがってDDrago/CDragonは以下に限定する:
- **画像URL生成**（§4）。
- **アイテムの価格/ステータス**（`item.json` は `gold{base,total,sell}`・`stats`・`plaintext` を持つ＝706件確認）。公式HTMLに無い価格を補える。
- **本番反映検知**（versions.json 先頭の変化）。
- **確定数値の照合・PBE先行数値**（CDragon `coefficients`/`effectAmounts`）。

### 3.5 既存の平テキスト抽出は「削除ではなくフォールバックに降格」

`extractPatchSectionsDeterministic`（平テキスト経路）は**残すが第2フォールバック**にする。優先順位:

```
1. 公式HTML DOMパース成功 → 正確版（新 patchChange ブロック）
2. DOMパース失敗（構造変更・取得失敗）→ 既存の平テキスト決定抽出（現状維持・壊れない）
3. それも空 → composePatchFactFlashBody（事実速報）
```

平テキスト経路の是非: **比較用に残す価値は低い**（誤帰属の温床そのもの）が、**公式がDOM構造を変えた時の保険**として残す意義はある。ただし本文表示では「主な変更点（自動抽出・簡易）」と明示し、DOM成功時は使わない。

---

## 4. 画像転用（チャンピオン/スキル/パッシブ/アイテム/ルーン）

### 4.1 実測済みURLパターン

**DDragon（要バージョン, ja_JP名あり）**:
- チャンピオン square: `https://ddragon.leagueoflegends.com/cdn/16.14.1/img/champion/{ChampId}.png`
- スプラッシュ: `.../cdn/img/champion/splash/{ChampId}_0.jpg`（ver不要, 既存 `buildChampionSplashUrl`）
- ローディング: `.../cdn/img/champion/loading/{ChampId}_0.jpg`
- スキル: `.../cdn/16.14.1/img/spell/{spells[i].image.full}`（実測: Azir Q = `AzirQWrapper.png`, W=`AzirW.png`, E=`AzirEWrapper.png`, R=`AzirR.png`）
- パッシブ: `.../cdn/16.14.1/img/passive/{passive.image.full}`（実測: `Azir_Passive.png`）
- アイテム: `.../cdn/16.14.1/img/item/{itemId}.png`（実測: `1053.png`, `3168.png`）

**公式HTML内の埋め込みURL（そのまま転用可）**: `patch-change-block` の img src は `am-a.akamaihd.net/image?f=https://ddragon.../img/champion/Corki.png` 形式で、champion/spell/item のアイコンが**その場で揃っている**。DOMパースでこれを直接拾えば、ver解決やマップ不要で正確なアイコンが得られる（最短経路）。

**CDragon（ver不要, latest/pbe両対応, PBE先行）**:
- チャンピオン square: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/{key}.png`（実測: `/…/268.png`）
- スキル/パッシブ: `abilityIconPath`（`/lol-game-data/assets/ASSETS/Characters/Azir/HUD/Icons2D/Azir_Q.png`）を小文字化して `https://raw.communitydragon.org/latest/game/{path}` で配信。**PBEは `/latest/` を `/pbe/` に**。
- ルーン: `runesReforged.json`（DDragon）または CDragon perks。ルーン変更は頻度低・優先度低。

### 4.2 記事本文（ArticleBodyBlock）への配置設計

新ブロック型 `patchChange` を1つ追加（`article-body.ts`）。1変更グループ＝1カード:

```ts
type ArticleBodyPatchChangeBlock = {
  type: "patchChange";
  targetName: string;        // "コーキ"（h3そのまま）
  targetIconUrl?: string;    // champion square / item icon（安全https検証）
  abilityKey?: "passive"|"Q"|"W"|"E"|"R"|"base"; // スキルキー
  abilityName?: string;      // "R - 連発ミサイル"
  abilityIconUrl?: string;   // spell/passive icon
  direction: "buff"|"nerf"|"adjust";
  changes: { stat: string; before: string; after: string }[]; // 逐語
  intent?: string;           // blockquote（変更意図。任意）
};
```

- 画像URLは既存の `isSafeImageUrl`（https/データURI/ローカルのみ）で検証（`article-body.ts:168`）。ホットリンク表示（ローカル保存しない）は現行のパッチバナー方針と一致。
- alt/credit を必ず付与（"画像: Riot Games 公式(Data Dragon)より"）。
- レンダリングは `article-body-view.tsx` に `PatchChangeBlockView` を追加（§5でデザイン）。

---

## 5. デザイン刷新（LoL公式風）

### 5.1 カラートークン（HEX）

**一次資料**: 公式パッチノート26.14の実CSSから抽出したブランド金 = **`#C8AA6E`**（リンク/ホバー色）、サマリ灰 = `#999`、区切り線 = `#3b4353`、暗背景基調。これを軸に、Leagueクライアントで広く使われるHextechトークンを採用:

```
/* ゴールド系（枠・見出し・ボタン） */
--lol-gold-bright: #F0E6D2;  /* 明るい金＝見出し文字 */
--lol-gold:        #C8AA6E;  /* ★公式CSS実測。基調の金 */
--lol-gold-2:      #C89B3C;  /* 濃い金＝アクセント */
--lol-gold-3:      #785A28;  /* 枠線・境界 */
--lol-gold-deep:   #463714;  /* 影・沈んだ枠 */
/* ヘックステックブルー（バフ/リンク/強調） */
--lol-blue:        #0AC8B9;  /* 明teal */
--lol-blue-2:      #0397AB;
--lol-blue-3:      #005A82;
--lol-blue-deep:   #0A323C;
/* 背景（黒/紺） */
--lol-bg:          #010A13;  /* 最深部 */
--lol-bg-2:        #091428;  /* パネル背景（紺） */
--lol-bg-3:        #0A1428;
--lol-panel:       #1E2328;  /* カード面 */
--lol-divider:     #3b4353;  /* ★公式CSS実測 */
/* テキスト・意味色 */
--lol-text:        #A09B8C;  /* 本文グレー */
--lol-text-sub:    #5B5A56;
--lol-buff:        #0AC8B9;  /* 強化＝teal */
--lol-nerf:        #E84057;  /* 弱体＝赤 */
--lol-adjust:      #C8AA6E;  /* 調整＝金 */
```

> 注: `#C8AA6E`/`#3b4353` は Riot公式パッチノートページ自身のCSSから直接確認。他のHextechトークンはLeagueクライアントで一般的に使われる値（一次のブランドガイド公開値ではない）。パッチ記事ブロック限定使用のため、多少の値調整は許容。

### 5.2 レイアウト（公式/lol-times風）

- **パッチ記事ブロックだけダークテーマ**にする（サイト全体はライト基調を維持）。パッチ本文を `data-lol-patch` のラッパで囲み、その中だけ上記トークンをCSS変数で適用（Tailwind の任意値 `bg-[#091428]` かCSS Modules/インラインstyle）。ヒーロー/カード/一覧はライトのまま。
- **チャンピオン変更カード**（`patch-change-block` 相当）:
  - 上辺に金グラデの細ライン（`border-top: 2px solid #C89B3C`）、面は `#091428`、角丸、金の薄い枠 `#463714`。
  - 左に**チャンピオン square アイコン**（金の丸枠 `border:2px solid #C8AA6E`）＋右に金文字（`#F0E6D2`）で対象名。
  - 変更意図（intent）を `#999` の小さめ斜体でサブに。
  - スキル行: **スキルアイコン**（小・角丸）＋`R - 連発ミサイル` を金、直下に `before ⇒ after`。**before はグレー取り消し感、after は teal（バフ）/赤（ナーフ）**で色分け（`classifyChange` の結果を反映）。`⇒` は金の矢印。
- **アイテムカード**: アイテムアイコン（正方・金枠）＋アイテム名＋価格（DDragon `gold.total`）＋stats変更。
- **バフ/ナーフの節見出し**: 「主な強化」＝teal下線、「主な弱体化」＝赤下線、「その他の調整」＝金下線。
- **公式リンクボタン**: 現行の `linkButton`（`article-body-view.tsx:110`）を、パッチ記事内では**金枠・紺地・金文字＋ホバーで金地反転**のLoL意匠にする（`bg-[#091428] border border-[#C8AA6E] text-[#C8AA6E] hover:bg-[#C8AA6E] hover:text-[#091428]`）。ラベルは「▶ パッチ26.14 公式パッチノートを読む」。
- **目次(toc)**: 紺地＋金見出し＋teal リンク。
- コントラスト: 金文字 `#F0E6D2`/`#C8AA6E` on 紺 `#091428` はWCAG AA可。本文グレー `#A09B8C` は小文字で不足しがちなので本文は `#CDBE91`〜`#F0E6D2` 寄りに上げる。

### 5.3 サイト全体との両立方針

- パッチ記事（`sourceType==="riot"` かつ detailed）の本文だけダーク配色。それ以外の記事・一覧・ヘッダ/フッタは不変。
- ダーク配色はパッチ本文ラッパ内にスコープし、既存の `dark:` ユーティリティ（サイトのダークモード）と衝突しないよう**固定色**（`dark:`に依存しない専用トークン）で当てる。パッチ記事は常にLoL公式のダーク意匠＝ライト/ダーク両モードで同じ見た目にする。

---

## 6. AIコスト・アーキ整合

- **抽出はAIゼロ**: DOMパース＋数値比較（`classifyChange`）＋URL組み立ての純ルール。プロジェクト原則「AIは本文生成/翻訳/SEOのみ」に完全準拠。現行 detailed も既にAI不使用で、その原則を維持したまま精度だけ上げる。
- **AIの残る用途（任意・現状踏襲）**: 記事タイトルの煽り化・導入/結びの短文のみ。変更の数値・対象・スキルキーは**AIに触れさせない**（捏造リスク源を断つ）。
- **追加API/依存**:
  - 新規の外部APIキーは不要（DDragon/CDragon/公式HTMLはすべてキー不要）。
  - **HTMLパーサ依存**: 現状は正規表現。堅牢なDOM抽出には軽量パーサ（例 `node-html-parser` 相当のDOM走査）が望ましいが、`patch-change-block`/`change-detail-title` の構造は安定しており、**正規表現ベースの限定抽出でも実装可**（§1.3で実証済み）。新規依存を避けるなら正規表現、堅牢性優先なら保守実績ある軽量パーサを最小限追加（`npm audit` ゲート対象）。
  - CDragon利用は任意（PBE速報/数値照合時のみ）。既存 `fetchJsonSafe`/`fetchTextSafe`（信頼境界のエラーハンドリング済み）を再利用。
- **アーキ配置**: 抽出は `SourceAdapter`（収集）ではなく `compose`（記事化）側が自然。ただし公式HTMLの取得は既に `riot-datadragon.ts` が行うので、**「HTML取得（adapter）→ 生HTMLをcontentに載せる or 別フィールドで渡す → compose側でDOM抽出」**とする。現状 `stripHtmlToText` 済みテキストを content に入れているのを、**生HTML（または構造抽出済みJSON）を別途 candidate に渡す**よう配線変更が要る（下記ロードマップS1）。

---

## 7. 実装ロードマップ（スプリント分割）

各スプリントは独立に受け入れ可能・PASS境界＝コミット境界。

### S1: 公式HTML DOM抽出基盤（変更検出の心臓部）
- `riot-datadragon.ts`: パッチノート取得で**生HTML**（または構造抽出済みJSON）を保持し candidate へ渡す経路を追加（既存の平テキストは温存）。
- 新 `patch-notes-parser.ts`（純関数）: §3.2の `ChangeTarget[]` を抽出。`patch-change-block`/`h3.change-title`/`h4.change-detail-title`/`ul>li`/`blockquote`/アイコンsrc を解析。アイコンURLから target.id/kind を判定。
- **受け入れ基準**: 26.14実HTML固定フィクスチャで、アジール=W/R・コーキ=基本ステータス(2⇒2.5)/R が**正しい対象に**抽出される単体テスト。誤帰属0件。リスト外チャンピオン（コーキ）も対象解決される。バフ/ナーフ分類が既存ロジックで付く。

### S2: 正確抽出への置換（compose）
- `compose.ts`: detailedモードで **DOM抽出成功→ `composeDetailedPatchBody` を新 `patchChange` ブロック生成に置換**、失敗時は既存平テキスト経路→事実速報にフォールバック（§3.5）。
- `article-body.ts`: `ArticleBodyPatchChangeBlock` 型＋`parsePatchChangeBlock` 検証追加（画像URLは `isSafeImageUrl`）。
- **受け入れ基準**: 26.14記事で、各チャンピオンカードに正しいスキルキー・変更前後・意図が出る。アイテム/バグ修正/システムが**総称でなく個別対象名**で出る。旧記事（後方互換）は壊れない。テストGreen。

### S3: 画像転用
- `patchChange` ブロックに DOM埋め込みアイコン（champion/spell/item）を配置。取れない場合はDDragon URL（`spells[i].image.full`/`passive.image.full`/`item/{id}.png`）で補完、最後にスプラッシュ。
- **受け入れ基準**: スキルアイコン・アイテムアイコンが実表示され、alt/credit付き。壊れURLは省略（記事は壊れない）。Playwrightで画像200応答確認。

### S4: LoL公式風デザイン
- `article-body-view.tsx`: `PatchChangeBlockView`＋パッチ本文ラッパ `data-lol-patch`。§5のトークン・カード・before⇒after色分け・金枠アイコン・公式リンクボタン意匠。パッチ本文だけダーク、サイト他は不変。
- **受け入れ基準**: パッチ記事が黒/紺地＋金/teal意匠で表示。一覧・他記事・ヘッダは従来ライトのまま。コントラストAA。Playwrightスクショで確認。

### S5: 未適用/速報経路＋適用後自動更新（§2.5）
- 公式HTML公開検知で preview 記事化（DDragon不要）、`patchStage` バッジ。versions.json 先頭変化＝本番反映を検知し、同 `externalId` の記事を確定版へ上書き更新（既存の記事更新機構を流用）。任意でCDragon PBE数値補完。
- **受け入れ基準**: 反映前は公式HTML由来で正確な対象/スキルキー表示＋previewバッジ。反映後に同一記事がlive確定版へ差し替わる（重複記事を作らない）。CDragon PBE 200取得のフォールバック確認。

### （S1に先行できる調整）平テキスト経路の位置づけ
- 削除せず「DOM失敗時フォールバック」に降格（§3.5）。表示上「簡易抽出」と明示。将来DOM構造が安定運用できたら撤去を再検討。

---

## 8. 未確認事項・リスク（自己批判）

1. **公式HTMLのDOM構造変更リスク**: `patch-change-block`/`change-detail-title` は今回の26.14で確認したが、Riotがマークアップを変える可能性あり。→ フィクスチャテスト＋失敗時フォールバック（平テキスト）＋監視で緩和。クラス名はstyled-components由来のハッシュ（`.iKWdAA`）だが**セマンティッククラス（patch-change-block等）は安定**しているのを確認済み。
2. **取得の堅牢性**: 今回 curl は最初 0バイト→リダイレクト追従（末尾スラッシュ）で261KB取得。既存 `fetchTextSafe` がリダイレクトを追うか要確認（追わないなら `/notes/`→`/notes` の正規化 or redirect対応が必要）。
3. **アイテム/システム/バグ修正ブロックの内部構造は champion ブロックほど深く実検証していない**（h3名＋⇒行がある点は確認、change-detail-title の粒度はチャンピオンほど一定でない可能性）。→ S2で実データ追検証。
4. **CDragon PBEの数値マッピング**: `effectAmounts`/`coefficients` から「人間が読む変更前後」を再構成するのは非自明（どのEffectがどのステータスか）。→ PBE数値は「速報の補助」に留め、確定はDDragon/公式HTMLに委ねる方針で回避。
5. **ルーン変更**: 今回のパッチ検証対象外。頻度低のため優先度低とした。必要なら `runesReforged.json`＋公式HTMLのルーン節で同方式。
6. **ブランドカラーの正当性**: `#C8AA6E`/`#3b4353` は公式CSS実測で確実。その他Hextechトークンは業界慣用値で、Riot一次ガイドの公開値ではない（[検索結果](https://brandpalettes.com/league-of-legends-color-codes/)ではブランドの基本色はokra/黄/黒/青とされ、Hextech詳細トークンは非公式）。パッチブロック限定使用なので実害は小さいが、厳密な公式一致が要件なら公式CSSからのトークン抽出を追加すべき。
7. **著作権**: アイコンはホットリンク表示（ローカル保存なし）・出典明記の現行方針を踏襲。スプラッシュ/アイコンはRiotの[Legal Jibber Jabber](https://www.riotgames.com/en/legal)方針下でファンコンテンツ的に許容されうるが、規約変更リスクは残る。

---

### 参照した実データ（すべて本調査で実取得）
- DDragon `api/versions.json`（495件, 先頭16.14.1）、`cdn/{16.14.1,16.13.1}/data/ja_JP/champion/Azir.json`、`.../en_US/championFull.json`（173体diff）、`.../ja_JP/item.json`（706件）
- CommunityDragon `latest`/`pbe` `content-metadata.json`（16.14 / 16.15）、`pbe|latest/…/v1/champions/268.json`（Azir 実数値・アイコンパス）
- 公式 `league-of-legends-patch-26-14-notes`（261KB 実HTML, patch-change-block×34, change-detail-title×48, ブランドCSS `#C8AA6E`/`#3b4353`）

Sources: [League of Legends Color Codes (brandpalettes)](https://brandpalettes.com/league-of-legends-color-codes/) / [Riot Games Legal](https://www.riotgames.com/en/legal)
