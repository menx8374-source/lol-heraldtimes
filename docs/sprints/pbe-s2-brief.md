# PBE-S2 — チャンピオン基本ステータス/cost/cooldown diff（CDragon PBE・ラベル明瞭分のみ）

`docs/pbe-research.md` §3・§6 P3。PBE-S1（アイテムdiff）に続き、CDragon PBE から**チャンピオンの基本ステータス・スキルの cost/cooldown/ammo**を
日本語名付きで機械diffする。**スキル効果量（effectAmounts/coefficients）はラベル不明で誤情報リスクのため一切扱わない**。**AI不使用**。対象: Web（バックエンド取得層）。

## 背景（リサーチで実測確定）
- CDragon PBE `champions/<key>.json`（pbe/latest）は、各スキル(q/w/e/r)に `cost`/`cooldown`/`ammo`、チャンピオンに基本ステータス（stats）を持つ（実測: 268=Azir）。
- **ラベル明瞭なのは基本ステータス・cost・cooldown・ammo のみ**。`effectAmounts`/`coefficients`（スキルのダメージ/レシオ）は「どの数値が何か」不明で**再構成すると誤情報**になるため**扱わない**（§3.4）。
- 日本語ロケール `.../ja_jp/...` で**チャンピオン名・スキル名が日本語**で取れる（実測: 268=「アジール」「征服の勅命」）。翻訳不要。
- **対象IDは数値key→alias（英名）で解決**でき、誤帰属ゼロ（S1〜S7のアイコンURL方式と同じ思想）。

## 含まれる機能

### F-PBE2-1: チャンピオン取得（cdragon-pbe.ts に追加）
既存 `src/lib/collection/adapters/cdragon-pbe.ts`（PBE-S1で新設）に、チャンピオン取得を追加:
- `fetchPbeChampionSummary()`/`fetchLatestChampionSummary()`: `.../v1/champion-summary.json`（全チャンピオンのkey/id/name一覧）を取得。
- `fetchPbeChampion(key, locale)`/`fetchLatestChampion(key, locale)`: `.../v1/champions/<key>.json` を取得（default＋ja_jp名）。既存 `fetchJsonSafe` 再利用・失敗は null/空。
- **効率配慮（重要）**: 全チャンピオン（約170体×2バージョン）を無条件に個別fetchすると重い。**champion-summary で候補を絞る、またはレート制御（順次＋小待機）／取得上限**を設け、CDragonに過負荷をかけない設計にする（1サイクル数回の想定）。取得失敗は空で本体を止めない。

### F-PBE2-2: チャンピオン基本/cost/cooldown diff（新規 pbe-champion-diff.ts・純関数）
`src/lib/generation/pbe-champion-diff.ts`（新規・DB非依存）:
- `diffChampions(pbeChamps, latestChamps, jaData?): PbeChampionChange[]` を実装。champion単位でpbe/latestを比較し、**変更のあったチャンピオンだけ**を返す:
  - 比較対象（ラベル明瞭のみ）: **基本ステータス**（attackdamage/perlevel・hp・armor 等の stats）、各スキルの **cost・cooldown・ammo**。数値 before → after を**逐語**で。
  - `PbeChampionChange = { key: number; id: string; name: string; iconUrl?: string; groups: { abilityKey?: "passive"|"Q"|"W"|"E"|"R"|"base"; abilityName?: string; changes: { stat: string; before: string; after: string }[] }[] }`。
  - 名前・スキル名は ja_jp があれば日本語、無ければ英名。変化なしは含めない。**effectAmounts/coefficients は絶対に比較しない**（型にも入れない）。捏造禁止。
- direction判定: `cost`/`cooldown` は**減少=強化で反転**、基本ステータス（攻撃力/hp等）は増加=強化。既存の `classifyPatchChange`（compose.ts）を流用できるなら流用、できなければ同思想の軽量判定。**曖昧は adjust**。

### F-PBE2-3: patchChangeブロックへの変換（型のみ・記事化はP4）
- `PbeChampionChange` を既存 `ArticleBodyPatchChangeBlock`（kind:"champion"）へ変換する純関数を用意（PBE-S1の item 変換と対になる）。**実際の記事化・PBE記事枠・配線はP4**。本スプリントは取得追加＋diff純関数＋変換＋テストまで。**compose/riot-datadragon/pipeline/表示は変更しない**（既存挙動に影響ゼロ）。

## 制約・非目標
- **AIは使わない**（取得・diff・名前解決・direction は純ルール/JSON）。**逐語維持・捏造禁止**（存在するフィールド差のみ・数値を作らない）。
- **スキル効果量（effectAmounts/coefficients）は一切扱わない**（誤情報リスク。ラベル明瞭な基本/cost/cooldown/ammo のみ）。
- **記事化・PBE記事枠・opt-in env・X連携・人手キュレーションはP4以降**（本スプリントは cdragon-pbe.ts への取得追加＋新規diff＋変換＋テストのみ。既存の本番挙動に影響ゼロ）。
- **DBスキーマ変更なし・新規npm依存なし**。CDragonはキー不要。取得失敗は空で本体を止めない。全チャンピオン取得の負荷に配慮。

## テスト（必須・実HTTPを叩かない・固定フィクスチャ）
1. `diffChampions`: pbe/latest の champion 固定フィクスチャ（基本ステータス・cost・cooldown の一部変更）で、**変更チャンピオンだけ**が逐語 before→after で返る。変化なしは空。
2. direction: cost/cooldown 減少=強化（反転）、攻撃力/hp 増加=強化、曖昧=adjust。
3. スキル効果量除外: effectAmounts/coefficients が変化していても diff に**現れない**（扱わないことをテストで固定）。
4. 日本語名: ja_jp があれば日本語のチャンピオン名/スキル名、無ければ英名フォールバック。対象ID=key→alias解決で誤帰属ゼロ。
5. 取得の効率/異常系: 取得失敗・空・非2xxで空・例外なし。取得上限/レート配慮が効く。
6. 既存の収集/生成/パイプラインテストが**一切回帰しない**（既存挙動に影響ゼロ）。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. CDragon PBE のチャンピオン基本ステータス/cost/cooldown/ammo diff（日本語名付き・逐語・変更分のみ・direction付き）が純関数で動く。**スキル効果量は扱わない**。
3. AI不使用・逐語維持・捏造なし・誤帰属ゼロ・DBスキーマ変更なし・新規依存なし・**既存挙動に影響ゼロ**（cdragon-pbe.tsへの追加＋新規ファイルのみ）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- チャンピオン基本/cost/cooldown diff（逐語・日本語名・direction・スキル効果量除外・誤帰属ゼロ）が確認できる。実HTTPは叩かない。全チャンピオン取得の負荷配慮がある。
- 既存機能が一切回帰しない。
- 受け入れ基準1〜3を満たす。
