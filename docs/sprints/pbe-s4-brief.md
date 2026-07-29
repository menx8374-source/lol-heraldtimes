# PBE-S4 — PBE記事枠（CDragon自動分を統合・未確定バッジ・出典・opt-in・LoL公式風）

`docs/pbe-research.md` §5・§6 P4。PBE-S1（アイテムdiff）／PBE-S2（チャンピオン基本/cost/cooldown diff）で取得した
CDragon PBEの自動データを、**1本のPBE先行記事**に組み立てる。**X収集は保留**（コスト回避）。**AI不使用**・**opt-in（既定off＝既存挙動不変）**。対象: Web。

## 背景（方針確定）
- ユーザー方針(B): **CDragonの自動分（S1/S2）＋公式ノートのみで運用**。X収集（PBE-S3）は当面保留（コスト回避）。
- PBE記事は「公式パッチノート公開の前」に出す**先行速報**。数値は**アイテム・チャンピオン基本ステータス・cost/cooldown/ammoのみ**（S8方針と同じ・スキル効果量は誤情報リスクで載せない＝公式ノート待ち）。
- 公式N+1ノートが出たら通常のパッチ記事（既存S5/S8）が別途担当（PBE記事とは**別枠**）。
- **PBEは本番で変わりうる**ため、必ず**未確定バッジ**を出す。データ出典は「CommunityDragon / Riot Games」を明記。

## 含まれる機能

### F-PBE4-1: PBE記事の組み立て（CDragon自動分の統合）
- PBE-S1 `diffItems`／PBE-S2 `diffChampions` の結果（`toArticleBodyPatchChangeBlock` 変換済み）を、1本のPBE記事本文（`ArticleBodyBlock[]`）に組み立てる純関数を用意（`src/lib/generation/pbe-compose.ts` 等・新規）:
  - 先頭に**未確定バッジ段落**（例:「【PBE・未確定】これは本番反映前のPBE（テストサーバー）の情報です。正式リリース時に変更・撤回される可能性があります。」）。
  - **冒頭サマリ**（数値集計・純テンプレ）: 「PBE {pbeバージョン} 時点で、チャンピオン{N}体・アイテム{M}件の変更が確認されています（スキル効果量の詳細は公式パッチノートで確定）。」
  - **チャンピオンの変更**（基本ステータス/cost/cooldown/ammo・patchChangeブロック kind:champion）→ **アイテムの変更**（patchChangeブロック kind:item）。既存S4の3グループ振り分け（強化/弱体化/調整）を流用してよい。
  - **出典**（「データ: CommunityDragon / Riot Games」＋CDragon/公式へのリンク）。
  - **スキル効果量は載せない**（S1/S2で扱っていない）。「スキルのダメージ・レシオ等の詳細は公式パッチノートで」と明示。
- 既存の `ArticleBodyPatchChangeBlock`・S4のLoL公式風デザイン（`[data-lol-patch]`）・目次(toc)を流用する（表示の作り込みはS4で完成済み）。

### F-PBE4-2: 収集・記事化への配線（opt-in・既定off）
- env `PBE_ARTICLE_MODE`（既定 `off`）。`on` のときのみ以下が動く。**off/未設定では収集・記事化・表示すべて現状と完全同一（回帰ゼロ）**。
- `on` のとき: CDragonで **pbe版 ≠ latest版**（＝本番準備中）を確認できた場合のみ、`fetchCDragonVersions`→items/champions取得→diff→PBE記事を生成/更新する。pbe==latest（差分なし）や取得失敗時は**何もしない**（本体を止めない・追加コストなし）。
- **一意化**: PBE記事は `externalId = "pbe-<pbeバージョン>"`（例 "pbe-16.16"）で**同一パッチのPBE記事を上書き更新**（重複記事を作らない。既存の記事更新機構＝Article.update in-place を流用）。カテゴリは既存の「パッチ/メタ」または新設「PBE」（既存カテゴリ流用が簡単なら流用可）。
- 免除ソース同様、PBE記事はhotness判定を経ず生成（速報性）。ただし **opt-in の時だけ**。
- 実行契機: 既存パイプライン内 or 独立スクリプト（`npm run pbe-article` 等、`confirm-patch-preview`と同じ運用パターン）。**毎回CDragonを叩く負荷を避けるため、pbe==latestなら即return**（差分がある時だけ本処理）。

### F-PBE4-3: タイトル・鮮度
- タイトルはルール生成（AI不使用）: 例「【PBE先行】パッチ{番号}のチャンピオン・アイテム変更まとめ（テストサーバー・随時更新）」。鮮度接頭辞「【PBE先行】」「【随時更新】」等。捏造しない。

## 制約・非目標
- **AIは使わない**（組み立て・サマリ・タイトルは純ルール/テンプレ）。**逐語維持・捏造禁止**（CDragonの数値そのまま・未確定を確定と偽らずバッジで明示）。
- **X収集（PBE-S3）は含めない**（保留）。**スキル効果量は載せない**（アイテム・基本/cost/cooldownのみ）。
- **opt-in厳守**: `PBE_ARTICLE_MODE` 未設定/off では既存挙動と完全同一（回帰ゼロ）。**追加の外部コストなし**（CDragonはキー不要・無料、AI不使用）。
- **DBスキーマ変更なし・新規npm依存なし**。PBE記事のフラグ（pbe由来・未確定）は本文バッジ＋externalIdの `pbe-` プレフィックスで表現（既存Post.media JSONにキー追加可・S5同様）。
- 公式N+1ノート記事（S5/S8）とは別枠。PBE記事は本番反映後も残ってよい（古くなるが、公式記事が別途最新を担う）。将来の自動アーカイブは非目標。

## テスト（必須・実HTTPを叩かない・固定フィクスチャ）
1. opt-in無効（既定）で**回帰ゼロ**: `PBE_ARTICLE_MODE` 未設定時、CDragon取得・PBE記事生成が一切走らない。
2. `on` かつ pbe≠latest のとき、S1/S2のdiff（固定フィクスチャ）から PBE記事本文が組まれる: 未確定バッジ・冒頭サマリ・チャンピオン変更（基本/cost/cooldown）・アイテム変更・出典・「スキル詳細は公式で」明示。逐語維持。
3. pbe==latest（差分なし）・取得失敗で**何もしない**（記事を作らない・例外なし）。
4. 一意化: 同一 pbeバージョンで再実行しても記事が重複せず上書き更新される（externalId `pbe-<ver>`）。
5. スキル効果量が本文に**出ない**（S1/S2で扱っていないことの担保）。
6. 既存の収集/生成/パイプライン/S4表示テストが**一切回帰しない**。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. `PBE_ARTICLE_MODE=on` かつ pbe≠latest で、CDragon自動分（チャンピオン基本/cost/cooldown＋アイテム）のPBE先行記事が、未確定バッジ・出典・LoL公式風デザインで生成/上書きされる。スキル効果量は載らない。`off`/未設定では現状と完全同一（回帰ゼロ・追加コストなし）。
3. AI不使用・逐語維持・捏造なし（未確定明示）・DBスキーマ変更なし・新規依存なし・X収集は含まない。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- opt-in無効で既存挙動が完全維持（回帰ゼロ）。有効時にCDragon自動分のPBE記事（未確定バッジ・出典・チャンピオン/アイテムのみ・スキル効果量なし・重複なし）が生成される。逐語維持・S4デザイン流用。
- 受け入れ基準1〜3を満たす。
