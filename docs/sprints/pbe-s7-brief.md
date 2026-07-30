# PBE-S7 — PBE記事のno_diff判定を「全ソース空のときだけ」に修正（CDragon0件でもXツイートで記事化）

実データで見つかった不具合を修正する。PBE-S6でCDragonのノイズ/削除済みアイテムを除外した結果、CDragon変更が0件になり、
**Xツイート（実際のPBE情報）があるのに記事が生成/更新されない（no_diffでスキップ）**問題を直す。**AI不使用・opt-in（既定off不変）**。対象: Web。

## 背景（実データPBE 16.16で判明した不具合）
`src/lib/generation/pbe-article.ts` の現状ロジック（171-173行付近）:
```ts
if (itemChanges.length === 0 && championChanges.length === 0) {
  return { status: "no_diff" };   // ← CDragonが0件だと即スキップ
}
// この後にX取得(maybeFetchPbeXTweets)・キュレーションがある
```
- PBE-S6でCDragonアイテムdiffがクリーン化され、今サイクルは **itemChanges=0・championChanges=0**。
- そのため **X取得の前に no_diff で return** してしまい、**Xツイート（Phroxzon氏のプレビュー＝実際のPBE変更情報）があっても記事が作られない/既存記事が更新されない**。
- 「随時更新」の観点でも、新しいツイートが来ても更新されない欠陥。

## 含まれる機能

### F-PBE7-1: X取得・キュレーションを no_diff 判定の前に移動
- `maybeFetchPbeXTweets(...)`（X取得・コスト安全設計はそのまま）と人手キュレーション読み込みを、**no_diff 判定より前**に実行する。
- **X取得のコスト安全設計は変更しない**（`X_API_KEY`設定時のみ・`pbe≠latest`（PBE窓）確認済み経路のみ・レート制限`PBE_X_MIN_INTERVAL_HOURS`内はスキップ）。移動後もこれらのガードは維持（無駄打ちしない）。

### F-PBE7-2: no_diff を「全ソース空」に変更
- no_diff を返す条件を、**CDragonアイテム・CDragonチャンピオン・Xツイート・キュレーション の全てが空のときだけ**にする:
  ```
  itemChanges.length === 0 && championChanges.length === 0
    && xTweets.length === 0 && curationNotes.length === 0  → no_diff
  ```
- いずれか1つでも内容があれば、記事を**生成/in-place更新**する（既存の生成・更新機構をそのまま使う）。これにより **CDragon0件でもXツイートがあれば「PBEのスキル変更（X）」セクションを含む記事が生成/更新**される。

### F-PBE7-3: 内容が変わったら更新される（随時更新）
- 既存記事があり、生成した本文が現状と異なる場合は in-place で更新する（externalId=`pbe-<ver>`で一意・重複記事を作らない、既存機構）。これにより、後から新しいツイートが増えた/CDragon変更が入ったときに記事が最新化される。
- （no_diff時＝全ソース空のときは既存記事をそのまま残す＝ツイートを消さない。これは維持。）

## 制約・非目標
- **AIは使わない**。**逐語維持・捏造禁止**（PBE-S1〜S6の内容生成は不変。本スプリントは判定順序と条件のみ）。
- **opt-in厳守**（`PBE_ARTICLE_MODE` off/未設定で既存挙動不変・回帰ゼロ）。**Xのコスト安全設計（キー・PBE窓・レート制限）は不変**（移動しても無駄打ちしない）。
- CDragon/公式ノート/G7 X反応記事・未確定バッジ・出典・サムネ・LoLデザインは不変。**DBスキーマ変更なし・新規npm依存なし**。

## テスト（必須・実HTTPを叩かない・モック注入）
1. **CDragon0件＋Xツイートあり → 記事が生成/更新される**（no_diffにならず、Xセクションを含む本文が組まれる）。← 今回の不具合の再現と修正確認。
2. CDragon変更あり（従来ケース）→ 従来どおり生成/更新（回帰なし）。
3. **全ソース空（items=0・champions=0・tweets=0・curation=0）→ no_diff**（既存記事は残す・無駄なX無駄打ちなし）。
4. Xのコスト安全設計: `X_API_KEY`未設定・レート制限内ではX取得を呼ばない（従来どおり）。この状態でCDragonも0なら no_diff。
5. opt-in off/未設定で回帰ゼロ。既存の pbe-article/pbe-compose テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. CDragon変更0件でもXツイートがあればPBE記事が生成/更新される（no_diffで捨てない）。全ソース空のときだけno_diff。Xコスト安全設計・opt-in・逐語・サムネ・未確定バッジは不変。
3. AI不使用・DBスキーマ変更なし・新規依存なし・既存挙動（off時）回帰ゼロ。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- CDragon0件＋Xツイートありで記事が出る（Xセクション含む）。全ソース空でno_diff。Xの無駄打ちが無い（キー・窓・レート制限）。
- 受け入れ基準1〜3を満たす。
