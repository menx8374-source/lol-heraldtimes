# PBE（Public Beta Environment）パッチ記事化 情報源ディープリサーチ

> 調査日: 2026-07-29 / 調査者: Opus（Web調査は本人がWebFetch/WebSearchで実行）
> 対象: PBE段階（公式パッチノート公開より前・毎サイクルの早期テスト期間）の変更内容を「どこから正確に収集するか」の設計・根拠・優先順位・ロードマップ。**実装はしない。**
> 前提資料: `docs/patch-accuracy-research.md`（既存のパッチ抽出刷新）／`src/lib/generation/patch-notes-parser.ts`（公式HTML DOM解析）／`src/lib/collection/adapters/riot-datadragon.ts`（S5速報機構）
> **すべての主張は本調査で実取得したデータ・実ページで裏取り**。取得できなかったものは「未確認」と明記。

---

## 0. TL;DR（結論）

1. **RiotはPBE専用の公式パッチノート（日英とも）を出さない**。PBEは「テスト環境」で、確定変更のみが**本番反映時の公式パッチノート**に載る。PBE段階の変更内容は基本的に**データマイン**か、Riotデザイナーの**非公式な事前予告（X）**に依存する（§1で裏取り）。
2. **英語の老舗PBEまとめ Surrender@20 は事実上終了**（ドメインは2023年7月失効、最終記事2022年11月）。同種のNews of Legends/Reign of Gamingも終了済み。**「毎サイクル網羅するサードパーティまとめ」の定番は消滅**した（§2）。現行の後継は **JungleDiff**（junglediff.net、2026年も稼働）だが著作物のプローズ主体。
3. **CDragon PBE（`raw.communitydragon.org/pbe/`）は本番の1つ先を実データで先行公開**（実測: PBE=**16.16**、live=**16.15**）。champion/item のスキル数値（`effectAmounts`/`coefficients`/`cost`/`cooldown`）に加え、**日本語ロケール（`.../global/ja_jp/...`）で日本語名・スキル名・説明まで配信している**（実測: 268=「アジール」「征服の勅命」）。**構造化・事実データ・ライセンス安全**な唯一の機械取得ソース。
4. **日本語のPBEまとめは既に複数存在し、当サイトの直接競合**（LoL Times・LoL忍者）。彼らは逐語 before⇒after＋出典明記（Riot開発者/Spideraxe/VPBE）＋未確定注記で運用しており、**需要は実証済みだが先行者もいる**（§4）。差別化は「誤帰属ゼロ・逐語・出典明記・本番反映後の自動確定」。
5. **推奨情報源の優先順位**: ①CDragon PBE JSON（数値・日本語名を機械取得＝事実・ライセンス安全）→ ②本番前でも公開される公式N+1パッチノートHTML（既存 `parsePatchNotesHtml`。逐語ja_JP＋変更意図＋アイコンが揃う）→ ③RiotPhroxzon（Riot開発Lead）のパッチプレビュー（方向性・QDF文脈のみ、画像投稿）→ ④まとめメディアは**引用・参考リンクのみ**（プローズは転載しない）。
6. **現実的な設計**: 当サイトの**PBE記事の本命は「公式N+1ノートのDOM解析」（既存S5機構）**に置き、CDragon PBEは「公式ノートがまだ無い早期PBE窓／数値補完」の**opt-in補助**に留める。理由: CDragonの `effectAmounts` は「どのEffectがどのステータスか」がラベル付けされておらず、**人間可読な変更前後の再構成が非自明で誤情報リスクが高い**（§3.4の限界）。**アイテム（`priceTotal`/`stats`/`description`はラベル明瞭）と基本ステータス/cost/cooldownは機械抽出が堅い**が、スキルのレシオ/ダメージは公式ノート待ちが安全。
7. PBE→公式ノート→本番反映 の**3段階ライフサイクル**に拡張する（現行は2段: S5速報→confirm確定）。**AIは翻訳/文体/SEOのみ**、数値・対象・スキルキーの抽出はAI不使用（既存原則を完全踏襲）。

---

## 1. Riot公式のPBE情報発信の実態（裏取り）

### 1.1 公式は「PBE専用パッチノート」を出さない

- LoL公式サイトのパッチノートは**本番反映時の確定版のみ**（26.15, 26.14, …と本番番号で公開。[公式patch-notesタグ](https://www.leagueoflegends.com/en-us/news/tags/patch-notes/)）。**PBE番号での公式ノートは存在しない**。
- コミュニティWiki **VPBE**（[wiki.leagueoflegends.com/en-us/VPBE](https://wiki.leagueoflegends.com/en-us/VPBE)）の運用方針にも「PBEの情報は**ゲームから直接**、またはRiot公式アカウントを参照して記載」「documented changes may or may not be final（確定とは限らない）」と明記。**Riotは体系的なPBEノートを別途出さない**ことの傍証。
- したがってPBE段階の変更把握は原理的に **(a) ゲームクライアントのデータマイン**（＝CDragon等）、**(b) Riotデザイナーの非公式予告**の2系統に限られる。

### 1.2 Riotの非公式な事前予告: パッチプレビュー（RiotPhroxzon）

- Riot Lead Gameplay Designer **Matt "Phroxzon" Leung-Harrison（[@RiotPhroxzon](https://x.com/RiotPhroxzon)）** が、各サイクル序盤に **「Patch NN Preview」** を X に投稿。対象チャンピオン/アイテムと**バフ/ナーフの方向**、狙いのテキストを示す（実在確認: 26.14/26.10/26.8/26.6 のプレビューがメディアに引用されている。[escorenews 26.14 preview](https://escorenews.com/en/lol/news/79323-league-of-legends-patch-notes-26-14-16-14-preview-locke-senna-garen-nerfs-mordekaiser-yunara-nami-buffs) 等）。
- **粒度**: 「誰を上げる/下げる」＋意図の散文。**具体数値（before⇒after）は基本含まない**。中核は**インフォグラフィック画像**なので機械可読でない（スクレイプで逐語抽出しづらい）。
- **位置づけ**: 半公式の「方向性・変更意図」ソース。QDF（早い者勝ち）の見出し・導入に使える文脈。**数値の一次ソースにはしない**。
- 未確認: X本文の実ページは本調査で直接取得していない（検索サマリベース）。X はWebFetch非対応のため、実運用でも自動スクレイプは非現実的。

### 1.3 まとめ

| 論点 | 結論 |
|---|---|
| 公式PBEパッチノート（日/英） | **出さない**（本番反映時の確定版のみ） |
| PBE変更の一次性質 | **データマイン**が基本 |
| Riot公式のPBE告知 | デザイナーの**非公式Xプレビュー**（方向性・意図、画像中心、数値なし） |

---

## 2. PBEまとめメディア（英語）の実在・稼働状況

| ソース | URL | 稼働 | 網羅性 | 構造化 | 言語 | 規約/法務 | 信頼性 |
|---|---|---|---|---|---|---|---|
| **Surrender@20** | surrenderat20.net | **終了**（最終2022-11、ドメイン2023-07失効） | — | — | 英 | — | 参照不可。過去の定番だが**今は使えない** |
| **JungleDiff** | junglediff.net | **稼働**（26.16を2026-07-28に投稿＝ほぼ毎サイクル） | 高（Balance/コスメ両カテゴリ。[balance-changes](https://www.junglediff.net/category/balance-changes/)） | 散文＋画像（非構造） | 英 | 著作物。**プローズ転載不可**、免責「may be changed before final release」明記 | Surrender@20の実質後継。信頼できるが二次情報 |
| **LoL Wiki VPBE** | wiki.leagueoflegends.com/en-us/VPBE | 稼働（コミュニティ編集） | 中（コスメ中心、balance数値は薄い） | 表・箇条書き（半構造） | 英 | **CC BY-SA 3.0**（表示＋継承のコピーレフト）。商用転載は継承条件が足枷 | Fandom系。事実確認の裏取りに可、**本文流用はライセンス注意** |
| Sportskeeda / u.gg / escorenews 等 | 各種 | 稼働 | プレビュー記事単位 | 散文 | 英 | 著作物。**転載不可** | RiotPhroxzonプレビューの二次紹介。参考リンク用 |

**要点**:
- **「毎サイクルを機械的に網羅する構造化英語ソース」は事実上存在しない**（S@20消滅後の空白）。JungleDiff/VPBEは**人間が読む散文/表**で、当サイトの逐語自動抽出には向かない（=二次情報の二次利用リスク）。
- reddit（r/leagueoflegends のPBEデイリー、r/PBE）は本調査で実スレを取得できず**未確認**。過去慣行としてデイリー討論スレは存在するが、**構造化ソースではなく信頼性も投稿者依存**のため一次ソースにはしない。
- データマイナー個人（**Spideraxe = @Spideraxe30** 等）はXで数値付き変更を投稿するが、**Xは自動取得非現実的**＋二次情報。日本の競合が出典として名前を挙げている（§4）が、当サイトが自動化する一次ソースには不適。

---

## 3. CDragon PBE の実用性（実測）と抽出設計

### 3.1 先行公開の実測

| エンドポイント | 実測値 | 意味 |
|---|---|---|
| `raw.communitydragon.org/pbe/content-metadata.json` | **16.16.8000032+branch.main.content.beta** | PBE=次々期の先行断面 |
| `raw.communitydragon.org/latest/content-metadata.json` | **16.15.7996036+branch.releases-16-15** | latest=現行live |

→ **PBEはliveの1つ先を実データで公開**（本調査時点 16.16 vs 16.15）。DDragonはliveのみ（`patch-accuracy-research.md §2.1`で既に実測）なので、**本番反映前の数値はCDragon PBEでしか機械取得できない**。

### 3.2 取得できるデータ（実測）

**チャンピオン** `pbe/plugins/rcp-be-lol-game-data/global/default/v1/champions/268.json`（Azir, HTTP 200）:
- 各スキル（q/w/e/r）に `coefficients`・`effectAmounts`・`cost`・`cooldown`・`ammo`・`abilityIconPath` が**すべて実在**（実測）。
- `effectAmounts` はLv別数値配列（実測例: Q Effect4Amount = `[70,70,70,70,70,70,70]`）。
- `default` ロケールは英語。

**★重要: 日本語ロケールも配信** `.../global/ja_jp/v1/champions/268.json`（HTTP 200・実測）:
- `name` = **「アジール」**、`title` =「砂塵の皇帝」、Q=「征服の勅命」、W=「目覚めよ！」…**スキル名・説明まで日本語**。`alias` に英語 "Azir"。
- → **チャンピオン名・スキル名は自前翻訳不要でCDragonから日本語取得できる**（§4の帰結に直結）。

**アイテム** `pbe/.../v1/items.json`（実測 193件）:
- 各要素キー: `id, name, description, active, inStore, from, to, categories, maxStacks, requiredChampion, …, price, priceTotal, iconPath` など。
- 実測例: id=1001「Boots」`priceTotal:300`、stats「25 Move Speed」。**価格・stats・説明がラベル明瞭**。ja_jp ロケールで日本語名も同様に取得可能と推定（要実装時確認）。

### 3.3 数値diffの再構成手順（`/pbe/` vs `/latest/`）

```
1. content-metadata.json で pbe と latest のバージョン差を確認（差が無ければPBE=live、diff無し）。
2. アイテム: items.json を pbe/latest で取得し、id一致でフィールド比較
   （priceTotal, description, stats, from/to）。差分＝変更前後。★ラベル明瞭＝機械抽出が堅い。
3. チャンピオン: champions/<key>.json を pbe/latest で取得し、
   spell.cost / spell.cooldown / spell.ammo / stats(基本) を比較 → before/after。
   effectAmounts/coefficients も比較可能だが §3.4 の限界に注意。
4. 表示名は ja_jp ロケールから取得（自前翻訳不要）。アイコンは abilityIconPath を
   raw.communitydragon.org/pbe/game/<path小文字> で配信。
```

### 3.4 限界（誤情報リスクの核心）

- **`effectAmounts`/`coefficients` は「どのEffectがどのステータス（ダメージ/シールド/スロー…）か」のラベルを持たない**。公式ノートの「Q ダメージ 70 ⇒ 80」に相当する**人間可読なひも付けが非自明**で、機械的に再構成すると**誤ラベル＝誤情報**になりうる。これは `patch-accuracy-research.md §8.4` の既知結論と一致。
- **PBEの流動性**: CDragonはクライアントbinの自動ミラーで、**PBEは本番までに数値が変わる/差し戻される**。速報向きだが「確定」ではない。
- **変更意図・バグ修正の散文・Riot公式訳の文脈は持たない**（数値と名前のみ）。「なぜ変えたか」は公式ノート待ち。
- 帰結: **CDragon PBEを一次にできるのは「ラベルが明瞭な領域」に限定**すべき。
  - **堅い**: アイテム（`priceTotal`/`stats`/`description`）、チャンピオン基本ステータス・`cost`・`cooldown`・`ammo`。
  - **危うい**: スキルのレシオ/ダメージ/効果量（`effectAmounts` の意味づけ）。→ **公式N+1ノート（§5）で確定するまで数値化しない**（曖昧はadjust／記述式扱いにする既存原則と整合）。

---

## 4. 日本語のPBE情報源（競合分析）

**日本語PBEまとめは既に複数稼働しており、当サイトの直接競合**:

| ソース | URL | 内容 | 逐語数値 | 出典明記 | 未確定注記 | 更新頻度 |
|---|---|---|---|---|---|---|
| **LoL Times** | [lol-times.com PBEカテゴリ](https://lol-times.com/archives/category/pbe-patch-note) | チャンピオン/アイテム/システム/スキン。26.06〜26.15を継続 | **あり**（実測: 「Basic HP: 655 ⇒ **620**」形式） | **あり**（Matt Leung-Harrison氏・**Spideraxe氏**・**VPBE**を明記） | **あり**（「テスト環境のため正式リリース時に変更の可能性」） | **サイクル中ローリング**（実測: 【7/22更新】【7/19更新】） |
| **LoL忍者** | [lolninja.net](https://lolninja.net/2026/06/17/49918/) | PBEパッチのチャンピオン/アイテム強化・弱体まとめ | あり | 要確認 | あり | パッチ毎 |
| **eSports World** | [esports-world.jp](https://esports-world.jp/column/56926) | パッチ先取り「解説」コラム（ロールクエスト等） | 部分 | — | — | 特集単位 |

**含意**:
1. **需要は実証済み**（複数サイトが継続運用＝PVが取れる領域）。だが**先行者がいる**。当サイトの差別化は既存強み＝**誤帰属ゼロ・逐語・出典明記・LoL公式風デザイン・本番反映後の自動確定**。
2. 競合の出典（Riot開発者Xプレビュー＋Spideraxe＋VPBE）は本リサーチ§1〜§2の結論と一致＝**業界標準の情報経路を裏取りできた**。
3. **自前翻訳の要否**: チャンピオン名・スキル名・アイテム名は**CDragon ja_jp ロケールで取得可能**（§3.2）＝翻訳不要。**英語まとめの散文は転載しない**方針なので、翻訳が要るのは「導入/文体/煽り」だけ（既存のAI翻訳/文体経路で足りる）。→ **英語ソース＋自前翻訳に全面依存する必要はない**。

---

## 5. 正確性・逐語・法務と、記事化の現実的設計

### 5.1 著作権・規約の切り分け（最重要）

| 種別 | 例 | 性質 | 当サイトでの扱い |
|---|---|---|---|
| **構造化データ（事実）** | CDragon の数値・名前・価格、DDragon | 事実データ＝著作物性が薄い | **機械抽出して自作の記事に再構成してよい**。出典明記（「データ: CommunityDragon / Riot Games」） |
| **公式パッチノートHTML** | leagueoflegends.com のノート | Riotの著作物。ただし**逐語引用＋出典明記＋主従**なら既存方針で運用中 | 既存 `parsePatchNotesHtml` の逐語抽出＋公式リンク（現行踏襲） |
| **まとめメディアの散文** | JungleDiff, LoL Times, VPBE本文 | 第三者の著作物 | **転載しない**。必要時のみ参考リンク。**VPBEはCC BY-SA 3.0（継承）で商用転載は足枷**＝本文流用しない |
| **Xの画像/投稿** | RiotPhroxzon, Spideraxe | 著作物＋規約 | 自動転載しない。方向性の裏取り・文脈のみ |

**原則の両立**: 当サイトの「逐語維持・捏造禁止・引用の主従・出典明記」は、**CDragon（事実データ＝再構成OK）と公式ノート（逐語引用＋主従）**の2本柱で満たせる。二次まとめは**参照するが取り込まない**。

### 5.2 「未確定」の明示（誤情報リスク緩和の必須要件）

- PBE由来の記事には**必ず「PBE段階・未確定・本番で変わりうる」バッジ＋注記**を出す（競合も全社が付けている＝業界標準）。既存S5の `isPreview`＝「【速報】」プレフィックス＋ `patchStage` バッジを流用。
- 数値は**ラベルが明瞭な領域のみ**を機械化（§3.4）。スキル効果量など曖昧は**記述式（`PatchChange.text`）または公式ノート待ち**にし、`direction` は既存原則どおり**曖昧はadjust**。

### 5.3 既存機構との連携（現状コードに接続）

現行 `src/lib/collection/adapters/riot-datadragon.ts`（`fetchItems`）の S5 速報は、`PATCH_PREVIEW_MODE=on` のとき **次バージョンN+1の公式パッチノートHTMLが既に公開済みなら**先行記事化する（`fetchPatchNotesData(nextVersion)` → `parsePatchNotesHtml`）。
- **限界**: 公式N+1ノートは**PBEサイクル後半（本番の数日前）にならないと出ない**。**早期PBE窓（本番の約2週間前〜）ではこの経路は空振り**（`fetchPatchNotesData` が null）。
- **拡張の勘所**: 早期窓を埋めるのが **CDragon PBE**。つまり「**CDragon PBE（早期・数値/名前）→ 公式N+1ノート（後半・逐語＋意図）→ 本番反映（確定・自動更新）**」の3段に伸ばす。段の切替は**同一 `externalId=publicPatchNumber`（例 "26.16"）で同じ記事を上書き**（重複記事を作らない。既存 `confirm-patch-preview` と同じ一意化）。

### 5.4 CDragon PBE 数値diff からの「変更前後」再構成: 具体手順と限界（まとめ）

- **手順**: §3.3（items/champions を pbe vs latest でフィールド比較、ja_jp で日本語名、abilityIconPath でアイコン）。
- **限界**: §3.4（effectAmounts の意味づけ非自明＝スキル効果量は誤ラベルリスク／PBEは流動的／意図・散文なし）。
- **設計判断**: 早期窓の自動記事は**「アイテム変更・チャンピオン基本/cost/cooldown」に限定した数値速報**とし、スキル効果量とバグ修正・意図は**公式N+1ノート段（既存パーサ）で確定**。**チャンピオン変更・アイテム変更のみ・逐語・出典明記・未確定明示**という要件は、この限定でこそ「誤帰属ゼロ」を保てる。

---

## 6. 実装ロードマップ（小スプリント分割・AIは翻訳/文体/SEOのみ）

> いずれも**opt-in（既定off）**で現行挙動に回帰ゼロ。抽出はAI不使用（数値/構造/URL）。新規外部APIキー不要（CDragon/DDragon/公式HTMLは全てキー不要）。

### P1: CDragon PBE クライアント（事実データ取得層）
- `content-metadata.json` で pbe/latest のバージョン差判定（差が無ければ何もしない）。
- `items.json`（pbe/latest, `default`＋`ja_jp`）取得の純関数フェッチャ（既存 `fetchJsonSafe`/`fetchTextSafe` 再利用、信頼境界のエラーハンドリング）。
- **受け入れ**: pbe=16.16/latest=16.15 を実取得し、両者を返す単体テスト（固定フィクスチャ）。取得失敗時は空配列（本体を止めない）。

### P2: アイテム数値diff（最も堅い領域から）
- items を id一致で比較 → `priceTotal`/`stats`/`description`/`from` の before⇒after を `PatchChangeTarget`（kind:"item"）に組み立て。名前は ja_jp、アイコンは iconPath。
- **受け入れ**: 実PBE/liveのアイテムdiffで、変更アイテムのみが逐語 before⇒after で出る。変化なしは0件。捏造なし。既存 `patchChange` ブロックで表示（デザイン流用）。

### P3: チャンピオン基本/cost/cooldown diff（ラベル明瞭分のみ）
- champions/<key>.json を pbe/latest 比較。**基本ステータス・cost・cooldown・ammo のみ**を diff（effectAmounts/coefficients は**この段では数値化しない**＝誤情報回避）。
- **受け入れ**: 変更のあったチャンピオンの基本/cost/cooldownのみ逐語表示。スキル効果量は出さない（または「詳細は公式ノートで確定」注記）。誤帰属ゼロ（対象IDは数値key→alias解決）。

### P4: 3段ライフサイクル統合（既存S5/confirmへ接続）
- 早期窓（公式N+1ノート未公開）は P2/P3 の CDragon 速報を `【速報/PBE】`＋未確定バッジで記事化。
- 公式N+1ノート公開を検知したら**同一 `externalId` の記事を既存 `parsePatchNotesHtml` の逐語版へ上書き**（意図・スキル効果量・バグ修正が加わる）。
- 本番反映（versions.json 先頭変化）で既存 `confirm-patch-preview` により**確定版へ**。
- **受け入れ**: 1つのパッチ番号で「CDragon速報→公式ノート→確定」が**重複記事を作らず**遷移。各段で未確定/確定バッジが正しい。offでは完全に現行挙動。

### P5（任意）: 文脈・QDF強化（AI＝文体/翻訳/SEOのみ）
- RiotPhroxzonプレビューやまとめは**手動キュレーションの参考リンク**として本文末に出典列挙（自動転載しない）。タイトル煽り・導入文はAI（数値には触れさせない）。
- **受け入れ**: 出典リンクが主従を守り、数値・対象・スキルキーはAI非経由（捏造リスク源を断つ）。

**コスト**: 追加API/キー無し。追加npm依存なし（既存パーサ同様、正規表現/JSONパースで足りる）。AI利用は既存の翻訳/文体経路のみで増分小。CDragon叩きは1サイクル数回のJSON取得＝軽量。

---

## 7. 自己批判（未確認事項・リスク・緩和）

1. **effectAmounts の意味づけ**（最大リスク）: スキル効果量の human-readable 再構成は非自明で誤情報化しうる。→ **P3でスキル効果量を数値化しない**設計で回避。スキル数値は公式N+1ノート待ち。
2. **PBEの流動性**: PBEは本番までに変わる/差し戻る。→ **未確定バッジ必須＋本番反映で自動確定**（3段）で緩和。誤報が残っても確定段で上書き修正される。
3. **RiotPhroxzon/Spideraxe（X）は実ページ未取得**（検索サマリ依存＋X自動取得は非現実的）。→ 一次ソースにしない設計なので影響限定。手動キュレーションに留める。
4. **reddit（PBEデイリー/r/PBE）は実スレ未確認**。構造化されず信頼性が投稿者依存のため一次にしない方針で回避。
5. **CDragon非公式ミラーの可用性/更新遅延**: 公式保証のない第三者ホスト。落ちる/遅れる可能性。→ 取得失敗は空で本体を止めない（既存方針）。可用性は公式N+1ノート段が担保。
6. **CDragon items の ja_jp 名の実在**は本調査で champion ja_jp までは実測、**items の ja_jp は未実測**（推定）。→ P1で実装時に実取得確認（無ければ英名＋既存翻訳経路）。
7. **法務**: 二次まとめ（JungleDiff/VPBE/LoL Times）の**散文は転載しない**。VPBEの CC BY-SA 3.0 継承条件は商用で足枷＝本文流用回避で対応。アイコン/画像はホットリンク＋出典明記の現行方針を踏襲（Riot [Legal Jibber Jabber](https://www.riotgames.com/en/legal) 下のファンコンテンツ扱い、規約変更リスクは残る）。
8. **競合の先行**: 日本語PBEまとめは既存（LoL Times等）。速報だけでは差別化不足＝**誤帰属ゼロ・逐語・出典明記・自動確定・公式風デザイン**の質で勝負する前提。

---

### 参照した実データ・実ページ（本調査で実取得）

- CDragon: `pbe/content-metadata.json`（**16.16**）、`latest/content-metadata.json`（**16.15**）、`pbe/.../default/v1/champions/268.json`（Azir、effectAmounts/coefficients/cost/cooldown/abilityIconPath 実在）、`pbe/.../ja_jp/v1/champions/268.json`（**「アジール」**等 日本語名・スキル名）、`pbe/.../v1/items.json`（193件、priceTotal/stats/description）。
- 公式: [LoL patch-notes タグ](https://www.leagueoflegends.com/en-us/news/tags/patch-notes/)（本番番号のみ）。
- Wiki: [VPBE](https://wiki.leagueoflegends.com/en-us/VPBE)（CC BY-SA 3.0・情報源方針・未確定注記）。
- 英語まとめ: [JungleDiff 26.15](https://www.junglediff.net/2026/07/14/26-15-pbe-update-14-07-2026/) / [balance-changes](https://www.junglediff.net/category/balance-changes/)、[Surrender@20 現状（最終2022-11・2023失効）](https://wiki.archiveteam.org/index.php/Surrender_at_20)。
- 日本語競合: [LoL Times PBE 26.15](https://lol-times.com/archives/8250)（逐語「655⇒620」・出典Spideraxe/Phroxzon/VPBE・未確定注記・ローリング更新）、[LoL Times PBEカテゴリ](https://lol-times.com/archives/category/pbe-patch-note)、[LoL忍者](https://lolninja.net/2026/06/17/49918/)、[eSports World](https://esports-world.jp/column/56926)。
- Riot開発: [@RiotPhroxzon](https://x.com/RiotPhroxzon)（パッチプレビュー、実ページ未取得＝検索ベース）、[escorenews 26.14 preview](https://escorenews.com/en/lol/news/79323-league-of-legends-patch-notes-26-14-16-14-preview-locke-senna-garen-nerfs-mordekaiser-yunara-nami-buffs)。
- 既存コード: `src/lib/generation/patch-notes-parser.ts`、`src/lib/collection/adapters/riot-datadragon.ts`（S5 `PATCH_PREVIEW_MODE`/`buildPatchItem` preview）、`docs/patch-accuracy-research.md`。
