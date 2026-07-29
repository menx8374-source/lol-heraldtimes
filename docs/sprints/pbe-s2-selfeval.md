---
tags: [sprint-selfeval]
sprint: PBE-S2
---

# PBE-S2 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/cdragon-pbe.ts`（追加、既存コードは無変更）
  - `fetchPbeChampionSummary()`/`fetchLatestChampionSummary()`: `.../v1/champion-summary.json` を取得（id<=0の無効エントリ除外）。
  - `resolveCandidateChampionKeys(pbeSummary, latestSummary)`: pbe/latest両方に存在するidだけを候補にする（新規/削除は除外、`diffItems`と同じ思想）。
  - `fetchPbeChampion(key, locale)`/`fetchLatestChampion(key, locale)`: `.../v1/champions/<key>.json` を取得し、`locale==="default"`時のみ基本ステータス（後述）を合成。
  - `fetchPbeChampions(keys, locale, intervalMs)`/`fetchLatestChampions(...)`: 候補キーから`MAX_CHAMPIONS_PER_FETCH=40`件に切り捨て、順次＋`CHAMPION_FETCH_INTERVAL_MS=30ms`待機で個別取得（負荷配慮、F-PBE2-1）。
  - `buildCDragonChampionIconUrl`/`buildJaChampionNameMap`: アイコンURL組み立て・日本語名マップ組み立て（既存`buildCDragonItemIconUrl`/`buildJaNameMap`と対）。
  - **実測に基づく設計変更（重要）**: リサーチ想定と異なり、`champions/<key>.json`には基本ステータス(`stats`)が実在せず、`cost`/`cooldown`生フィールドは未解決の表示テンプレート文字列（例`"@Cost@ @AbilityResourceName@"`）で数値diffに使えないことを実測で確認。代わりに以下を実データ確認のうえ採用:
    - スキルのcost/cooldown/ammo: 同エンドポイントの`costCoefficients`/`cooldownCoefficients`/`ammo.{maxAmmo,ammoRechargeTime}`（ランク別配列、ラベル明瞭・実測で複数チャンピオン確認）。
    - 基本ステータス: `raw.communitydragon.org/{pbe,latest}/game/data/characters/<alias小文字>/<alias小文字>.bin.json`の`CharacterRecords/Root`（`baseHPModifiable`/`baseArmorModifiable`等、フィールド名自体がラベル明瞭。Azir/Ahri/Jinx/Yasuoの4チャンピオンで命名一貫性を実測確認済み）。ハッシュ化された未知キー（例`{01262a25}`）は一切参照しない。
- `src/lib/generation/pbe-champion-diff.ts`（新規、純関数）
  - `diffChampions(pbeChamps, latestChamps, jaNames?)`: id一致で基本ステータス11項目・各スキル(passive/Q/W/E/R)のコスト・クールダウン・弾数・弾薬回復時間を比較し、変更のあったチャンピオンだけを`PbeChampionChange[]`で返す。`before`=latest(現行)、`after`=pbe(次パッチ候補)。対象ID(`id`)は常にalias（英名）で解決（誤帰属ゼロ）。
  - `toArticleBodyPatchChangeBlock(change)`: `PbeChampionChange`を`ArticleBodyPatchChangeBlock`(`kind:"champion"`)へ変換。既存`classifyPatchChange`(compose.ts)を流用し、cost/クールダウンは減少=強化（反転、`LOWER_IS_BETTER_TERMS`に該当）、基本ステータスは増加=強化、混在・判定不能はadjust。

## 技術選定
- 追加ライブラリなし。既存`fetchJsonSafe`（http.ts）を再利用。
- 基本ステータス取得元を「`champions/<key>.json`の`stats`フィールド」（研究時の想定）から「`game/data/characters/<alias>/<alias>.bin.json`の`CharacterRecords/Root`」に変更した。理由: curlで実際にAzir(268)の`champions/268.json`を取得したところ`stats`フィールドが存在しないことを確認したため（研究doc §3.2の記載は未実装確認の推定だった）。bin.jsonは複数チャンピオンで命名の一貫性を実測確認済みで、フィールド名自体が自己記述的（`baseHPModifiable`等）なため「ラベル明瞭」の原則に適合すると判断。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（114ファイル / 1533テスト全パス。新規テスト25件含む）。
- [x] `npx tsc --noEmit` エラー0。
- [x] `npm run build` 成功。
- [x] `npm run lint` エラー0（既存の無関係な警告6件のみ、今回のファイルは対象外）。
- [x] チャンピオン基本ステータス/cost/cooldown/ammo diff（日本語名付き・逐語・変更分のみ・direction付き）が純関数で動作することをテストで確認。**スキル効果量（effectAmounts/coefficients）は型・実装のいずれにも一切存在せず**（`pickAbility`が取得段階でホワイトリスト外を除外）、テストでも「型に無いフィールドを紛れ込ませても出力に一切現れない」ことを確認済み。
- [x] AI不使用（数値/構造/JSONパースのみ）・逐語維持（before/afterは元データの数値をそのまま文字列化、配列は"/"区切りで結合、捏造なし）・誤帰属ゼロ（対象IDは常にalias、championsのidマッチで解決）・DBスキーマ変更なし・新規npm依存なし・**既存挙動に影響ゼロ**（`git status --short`で`cdragon-pbe.ts`への追加＋新規ファイルのみが差分であることを確認済み。`compose.ts`/`riot-datadragon.ts`/`pipeline.ts`/`article-body.ts`等は一切変更していない）。

## アプリの起動方法
本スプリントはバックエンド取得層＋純関数のみで画面変更は無し。検証は以下のコマンドで完結:
- `npx vitest run`（全テスト）
- `npx vitest run src/lib/__tests__/collection-cdragon-pbe.test.ts src/lib/__tests__/generation-pbe-champion-diff.test.ts`（本スプリント分のみ）
- `npx tsc --noEmit`
- `npm run build`
- `npm run lint`
アプリ自体の起動が必要な場合は既存どおり `npm run dev`（ポート3000既定）。本スプリントの機能はUIに未接続のため起動確認は不要（自己確認用サーバーは起動していない）。

## 既知の問題・懸念点
- **研究doc(pbe-research.md §3.2/§3.3)の記述と実測結果の乖離**: 研究では「champions/<key>.jsonにstats(基本)が実在」と記載されていたが、実測（curl）では存在しなかった。本スプリントでは実測を優先し、bin.json（`CharacterRecords/Root`）から基本ステータスを取得する設計に変更した。この点はpbe-research.md自体の更新は本スプリントのスコープ外（generatorはコードのみ担当）のため未反映。次回architect/planner関与時に研究docの当該箇所の修正を検討すべき。
- `squarePortraitPath`/`abilityIconPath`から組み立てるアイコンURL（`buildCDragonChampionIconUrl`ラップの元関数`buildCDragonItemIconUrl`）は、実際にHTTPで疎通確認したところ**アイテムiconPath同様、404で解決しないケースを確認**（既存PBE-S1の`buildCDragonItemIconUrl`も同じ問題を抱えており、本スプリントで新規に持ち込んだ回帰ではない）。アイコン表示自体はP4以降のスコープ（既存コメント「S3で表示、S2では保持のみ」と同じ思想を踏襲）のため、URL文字列の組み立て・保持のみ行い、実際の画像疎通確認は本スプリントの受け入れ基準に含まれない。表示実装時に要再検証。
- 基本ステータスは`CharacterRecords/Root`の11フィールド（HP/HP成長/攻撃力/攻撃力成長/物理防御/物理防御成長/魔法防御/移動速度/攻撃射程/攻撃速度/攻撃速度成長）に限定した。魔法防御成長・体力自然回復・マナ関連等、bin.json内に存在する可能性のある他のラベル明瞭フィールドは今回対象外（ラベル明瞭性の確証が取れた最小セットのみを採用、拡張が必要なら追加スプリントで検討）。
- passiveのcost/cooldown/ammoは実測で常に存在しない（passiveオブジェクトはname/icon/descriptionのみ）ことを確認済みのため、`diffAbility`はpassiveに対して呼ばれても実質的に変更を検出しない（型上はabilityKey:"passive"を許容するが、実データでは発火しない設計。将来のアクティブパッシブ仕様変更があれば要見直し）。
- 全チャンピオン取得は最大`MAX_CHAMPIONS_PER_FETCH=40`件・順次30ms間隔に制限（負荷配慮）。約230体全件を1サイクルで処理する場合は複数回の呼び出しが必要になる設計（本スプリントでは呼び出し配線自体がスコープ外、P4で検討）。
- 本スプリントで新規npm依存の追加は無く、キャッシュ衛生管理の対象作業（新規パッケージインストール）も発生しなかった。

## 追加したテスト
- `src/lib/__tests__/collection-cdragon-pbe.test.ts`（追記）: champion-summary取得（正常/無効エントリ除外/異常系）、`resolveCandidateChampionKeys`（pbe/latest共通id抽出）、`fetchPbeChampion`/`fetchLatestChampion`（champions.json+bin.json合成/ja_jpではbin.json非取得/異常系null/bin.json失敗時もチャンピオン自体は取得できる）、`fetchPbeChampions`/`fetchLatestChampions`（上限切り捨て・一部失敗時も成功分のみ返す）、`buildJaChampionNameMap`/`buildCDragonChampionIconUrl`。実HTTPは叩かず`fetch`をモック（固定フィクスチャ）。実URL構造（champion-summary.json/champions/268.json/azir.bin.json、default/ja_jpロケール）はcurlで実在・実フィールド確認済み（下記参照）。
- `src/lib/__tests__/generation-pbe-champion-diff.test.ts`（新規）: 基本ステータス/cost/cooldown/弾数の変更分のみ逐語で返る／変化なしは空／完全新規チャンピオンの除外／スキル効果量に相当するフィールドが型に無く出力にも現れないこと／日本語名フォールバック・誤帰属ゼロ（idは常にalias）／異常系（空配列）／`toArticleBodyPatchChangeBlock`のdirection判定（cost/cooldown減少=buff、増加=nerf、基本ステータス増加=buff、混在=adjust、iconUrl有無）。

### 実URL確認（curlで実測、実装テストでは叩いていない）
```
$ curl -s https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json
[{"id":-1,"name":"None",...},{"id":1,"name":"Annie","alias":"Annie","squarePortraitPath":"/lol-game-data/assets/v1/champion-icons/1.png",...}, ...] (237件)
$ curl -s https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/champions/268.json
{"id":268,"name":"Azir","alias":"Azir",... "passive":{...no cost/cooldown...},"spells":[{"spellKey":"q","cost":"@Cost@ @AbilityResourceName@","cooldown":"@Cooldown@s...","costCoefficients":[70,80,90,100,110,110],"cooldownCoefficients":[14,12,10,8,6,6],"ammo":{"ammoRechargeTime":[...],"maxAmmo":[...]},"effectAmounts":{...},"coefficients":[...]}, ...]}
# ↑ stats(基本ステータス)フィールドは実在しない、cost/cooldown生フィールドは未解決テンプレート文字列
$ curl -s https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/ja_jp/v1/champions/268.json
{"name":"アジール","alias":"Azir","passive":{"name":"シュリーマの遺産"},"spells":[{"name":"征服の勅命"},{"name":"目覚めよ！"},{"name":"流砂の衝撃"},{"name":"皇帝の分砂嶺"}]}
$ curl -s https://raw.communitydragon.org/pbe/game/data/characters/azir/azir.bin.json
{"Characters/Azir/CharacterRecords/Root":{"baseHPModifiable":{"baseValue":575},"hpPerLevelModifiable":{"baseValue":108},"baseDamageModifiable":{"baseValue":56},"baseArmorModifiable":{"baseValue":25},"armorPerLevelModifiable":{"baseValue":5},"baseMR":{"baseValue":30},"baseMoveSpeedModifiable":{"baseValue":330},"attackRangeModifiable":{"baseValue":525},"attackSpeedModifiable":{"baseValue":0.625}, ...}, ...}
# ↑ 同様の命名規則をahri/jinx/yasuoでも確認済み（baseHP/hpPerLevel/baseDamage/damagePerLevel/baseArmor/armorPerLevel/baseMR/baseMoveSpeed/attackRange/attackSpeed/attackSpeedPerLevel全て一貫）
$ curl -s -o /dev/null -w "%{http_code}" https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/268.json  # => 200（latestチャンネルも同構造）
```

## 関連ドキュメント
- [[pbe-s2-brief]]（本スプリントの仕様抜粋）
- [[pbe-research]]（設計根拠となる実測リサーチ。本スプリントで一部想定と異なる実測結果あり、上記「既知の問題」参照）
- [[pbe-s1-selfeval]]（前スプリントのアイテムdiff実装、対になる設計）
