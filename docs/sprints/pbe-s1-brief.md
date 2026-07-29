# PBE-S1 — CommunityDragon PBE クライアント＋アイテム数値diff（PBE記事の自動土台）

`docs/pbe-research.md` §3・§6 P1〜P2。PBE記事（別枠・公式ノート1週間前）の**数値の土台**を作る。CDragon PBE から
**本番の1つ先のパッチのアイテム変更を、日本語名付きで機械取得**する。**AI不使用**（数値・構造・JSONパースのみ）。対象: Web（バックエンド取得層）。

## 背景（リサーチで実測確定）
- **CDragon PBE（`raw.communitydragon.org/pbe/`）は本番の1つ先を実データ配信**（実測: pbe=16.16 / latest=16.15）。DDragonはliveのみなので、**本番反映前の数値はCDragon PBEでしか機械取得できない**。
- `content-metadata.json` で pbe/latest のバージョンを取得できる（差が無ければPBE=live＝diff無し）。
- **アイテムは `priceTotal`/`stats`/`description`/`from`/`to` がラベル明瞭**で機械diffが堅い（スキル効果量`effectAmounts`はラベル不明で誤情報リスク＝**本スプリントでは扱わない**）。
- **日本語ロケール `.../global/ja_jp/...` で日本語名が取れる**（実測: champion 268=「アジール」。items の ja_jp 名は実装時に実取得確認。無ければ英名＋既存翻訳経路にフォールバック）。
- ライセンス: CDragonの数値・名前は**事実データ**＝機械抽出して自作記事に再構成可（出典明記「データ: CommunityDragon / Riot Games」）。

## 含まれる機能

### F-PBE1-1: CDragon PBE クライアント（新規 cdragon-pbe.ts・純関数寄り）
`src/lib/collection/adapters/cdragon-pbe.ts`（新規）に、既存の `fetchJsonSafe`（信頼境界のエラーハンドリング済み）を再利用して:
- `fetchCDragonVersions(): Promise<{ pbe: string | null; latest: string | null }>`: `raw.communitydragon.org/pbe/content-metadata.json` と `.../latest/content-metadata.json` からバージョン文字列（例 "16.16"/"16.15"）を取得。失敗は null。
- `fetchPbeItems(locale: "default" | "ja_jp"): Promise<CDragonItem[]>` と `fetchLatestItems(locale)`: `.../{pbe,latest}/plugins/rcp-be-lol-game-data/global/{locale}/v1/items.json` を取得。失敗・非2xxは空配列（本体を止めない）。
- 取得はタイムアウト付き（既存fetch方針）。実HTTPはテストで叩かない（モック）。

### F-PBE1-2: アイテム数値diff（純関数）
`src/lib/generation/pbe-item-diff.ts`（新規、純関数・DB非依存）に:
- `diffItems(pbeItems, latestItems, jaNames?): PbeItemChange[]` を実装。id一致でフィールド比較し、**変更のあったアイテムだけ**を返す:
  - 比較対象（ラベル明瞭）: `priceTotal`（価格）、`stats`（増加ステータス）、主要な `description`/`from`（レシピ）差分。数値/文字列の before → after を**逐語**で持つ。
  - `PbeItemChange = { id: number; name: string; iconPath?: string; changes: { stat: string; before: string; after: string }[] }`（`stat` は「合計コスト」「移動速度」等の日本語ラベル）。
  - 名前は ja_jp があれば日本語、無ければ英名。変化なしアイテムは含めない（0件は空配列）。**捏造しない**（存在するフィールド差のみ）。
- リサーチ§3.4の限界を厳守: **スキル効果量（effectAmounts/coefficients）は扱わない**。アイテムの明瞭フィールドのみ。

### F-PBE1-3: 既存パッチ表示への接続（型のみ・記事化はP2以降）
- `PbeItemChange` を、既存の `ArticleBodyPatchChangeBlock`（kind:"item"）へ**変換できる形**にしておく（実際の記事化・PBE記事枠はP4）。本スプリントは**取得層＋diff純関数＋テスト**まで。compose/表示/env制御は変更しない（既存挙動に一切影響しない）。

## 制約・非目標
- **AIは使わない**（取得・diff・名前解決は純ルール/JSON）。**逐語維持・捏造禁止**（存在するフィールド差のみ・数値を作らない）。
- **本スプリントは取得層とdiff純関数のみ**。記事化・PBE記事枠・opt-in env・X連携・人手キュレーションはP2〜P4（本スプリントでは compose/riot-datadragon/pipeline/表示を変更しない＝既存挙動に影響ゼロ）。
- **スキル効果量は扱わない**（effectAmounts のラベル不明＝誤情報リスク。アイテムの明瞭フィールドのみ）。
- **DBスキーマ変更なし・新規npm依存なし**（既存 fetchJsonSafe・標準JSON）。CDragonはキー不要。取得失敗は空で本体を止めない。
- 出典: 生成する記事（P4）で「データ: CommunityDragon / Riot Games」を明記する前提（本スプリントはデータに出典情報を持たせられる形にする）。

## テスト（必須・実HTTPを叩かない・固定フィクスチャ）
1. `fetchCDragonVersions`: content-metadata.json のモックから pbe/latest バージョンを抽出（例 "16.16"/"16.15"）。取得失敗で null。
2. `diffItems`: pbe/latest の items 固定フィクスチャ（数件・一部変更）で、**変更アイテムだけ**が before→after 逐語で返る。変化なしは空。新規/削除アイテムの扱い（from/to・inStore差）も検証。
3. 日本語名: ja_jp フィクスチャがあれば日本語名、無ければ英名フォールバック。
4. 異常系: 空/不正JSON・非2xxで空配列・例外を投げない。
5. 既存の収集/生成/パイプラインテストが**一切回帰しない**（本スプリントは新規ファイルのみで既存を変更しない）。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. CDragon PBE のバージョン差判定とアイテム数値diff（日本語名付き・逐語・変更分のみ）が純関数で動く。スキル効果量は扱わない。
3. AI不使用・逐語維持・捏造なし・DBスキーマ変更なし・新規依存なし・**既存挙動に影響ゼロ**（新規ファイルのみ）。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- CDragon PBE クライアント（バージョン差・items取得）とアイテムdiff（逐語・日本語名・変更分のみ・スキル効果量は除外）が確認できる。実HTTPは叩かない。
- 既存機能が一切回帰しない（取得層＋純関数の追加のみ）。
- 受け入れ基準1〜3を満たす。
