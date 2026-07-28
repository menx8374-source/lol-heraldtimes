# 成長G3 — パッチ記事のlol-times型化（バフ/ナーフ/調整3分類＋冒頭サマリ＋目次・AI不使用）

成長提案書(docs/growth-research.md 観点①⑤⑥・G3)。パッチ記事は検索需要が固定で流入の柱。lol-times/FISTBUMP型の
「**冒頭1文サマリ＋目次＋バフ/ナーフ/調整の明確な3分類＋チャンピオン画像**」で読ませる設計にする。**AI不使用（純ルール）**。対象: Web。

## 背景（現状と差分）
現状の `PATCH_ARTICLE_MODE=detailed`（`composeDetailedPatchBody`, compose.ts）は「バナー画像＋チャンピオン節（画像＋逐語 `旧値 ⇒ 新値`）＋非チャンピオンセクション」で、既に**チャンピオン画像・逐語変更抽出は実装済み**（拡張E53/E54。`extractPatchSectionsDeterministic` が `{champions: {champion, changes[]}, other: {heading, changes[]}}` を逐語で返す）。
**足りないのは**：①バフ/ナーフ/調整の3分類（今は全チャンピオンを一律に並べるだけ）②冒頭の1文サマリ ③目次。これらを純ルールで足す。

### データ構造（既存・変更しない）
- `PatchChampionChanges = { champion: string; changes: string[] }`：`changes` は逐語テキスト（例「Qのダメージ 50/70/90 ⇒ 55/75/95」「クールダウン 12 ⇒ 10」）。
- `PatchOtherSection = { heading: string; changes: string[] }`。
- 逐語維持・捏造禁止は不変（G3は**表示のグルーピングと集計サマリ・目次の追加のみ**で、変更テキスト自体は一切書き換えない）。

## 含まれる機能

### F-G3-1: バフ/ナーフ/調整の3分類（純関数・compose.ts）
逐語 `changes` から数値の増減で機械判定する純関数を追加（DB非依存・単体テスト可能）:
- `classifyChange(change: string): "buff" | "nerf" | "adjust" | "unknown"`
  - `⇒` の前後の数値を抽出（単値・`50/70/90` のようなスラッシュ区切り複数値の両方に対応。複数値は合計または平均で前後比較）。数値が抽出できない／前後で個数が揃わない → `unknown`。
  - **反転ステータスの罠を必ず考慮**：変更行に「クールダウン」「CD」「再使用」「マナ」「コスト」「消費」「詠唱時間」等（`LOWER_IS_BETTER_TERMS` として定義）が含まれる場合は**「数値が減る＝強化(buff)、増える＝弱体(nerf)」と解釈を反転**する。それ以外は「増える=buff / 減る=nerf」。
  - 前後の数値が同値 → `adjust`。
- `classifyChampion(changes: string[]): "buff" | "nerf" | "adjust"`
  - 各 `change` を `classifyChange` し集約：**全て buff（unknown/adjust以外がbuffのみ）→ buff、全て nerf → nerf、buffとnerfが混在／判定できるものが無い（全部unknown/adjust）→ adjust**。
  - 曖昧なときは必ず **`adjust` に安全に倒す**（誤って「強化」「弱体化」と断定表示しない。正確性優先）。
- チャンピオン以外の変更（`other`）は3分類しない（アイテム/バグ修正等はそのまま章として残す）。

### F-G3-2: 3グループ振り分け表示（composeDetailedPatchBody 拡張）
`composeDetailedPatchBody` を、チャンピオン節を **`classifyChampion` で「主な強化」「主な弱体化」「その他の調整」の3グループに振り分け**て出力するよう変更する（lol-times/FISTBUMP同型）:
- 各グループは見出し（heading）→ グループに属する各チャンピオン節（**既存の画像＋逐語変更をそのまま**）の順。
- 空のグループは出さない。グループ順は「主な強化 → 主な弱体化 → その他の調整」。
- グループ内のチャンピオン順は既存の抽出順（本文出現順）を維持（決定論）。
- 非チャンピオンセクション（`other`：アイテム/システム/バグ修正等）は従来どおり3グループの後に出す。

### F-G3-3: 冒頭1文サマリ（AI不要・数値集計）
detailedボディの先頭（バナー画像の直後・目次の前）に、3分類の集計から生成した**サマリ段落**を1つ挿入する:
- 例：「今回のパッチでは、チャンピオン{buff}体を強化・{nerf}体を弱体化・{adjust}体を調整。ほかにアイテム/システム等{otherセクション数}件の変更があります。」
- すべて数値の差し込み（純テンプレ）。0体の項目は文から省く（「弱体化0体」等は書かない）。チャンピオン変更が無いパッチ（システムのみ）では非チャンピオン件数のみのサマリにする。

### F-G3-4: 目次（TOC）ブロック
記事内の章見出しへページ内リンクする目次を追加する:
- `src/lib/article-body.ts` の `ArticleBodyBlock` に **`{ type: "toc"; items: { label: string; anchor: string }[] }`** を追加。`heading` 型に任意の **`anchor?: string`** を追加（既存の heading は anchor 無し＝従来どおりで回帰しない）。
- `composeDetailedPatchBody` は、出力する各章 heading に決定論的な `anchor`（例：`sec-1`, `sec-2`… の連番。日本語をURLに含めない）を付与し、それらを集めた `toc` ブロックをサマリの直後（本文の先頭付近）に置く。
- `src/components/article-body-view.tsx`：`heading` に `anchor` があれば `<h2 id={anchor}>` を出力。`toc` ブロックは `<nav aria-label="目次">` ＋ 各 `items` を `<a href={"#"+anchor}>{label}</a>` のリスト（ページ内リンク）でレンダリング。`toc` 型追加に伴う既存の網羅的 switch/if があれば対応（未知ブロックで落ちない）。
- 既存記事（toc/anchor を持たない）・fact/summaryモード・非パッチ記事の表示は**不変**（回帰しないこと）。

## 制約・非目標
- **AIは使わない**（3分類・サマリ・目次はすべて数値/テンプレの純ルール）。翻訳/反応記事/収集/SEOは変更しない。
- **逐語維持・捏造禁止**：変更テキストの文言・数値は一切書き換えない。G3が足すのは「グルーピング見出し」「集計サマリ」「目次」の3つだけ。
- **分類の正確性優先**：反転ステータス（CD/マナ/コスト等）を誤らない。少しでも曖昧なら `adjust`。断定的な「強化/弱体化」を誤表示しない（誤情報は公式記事の信頼を損なう）。
- `PATCH_ARTICLE_MODE` の `fact`/`summary` モードは既存挙動を維持（G3の対象は `detailed` のみ）。`ArticleBodyBlock` への型追加は後方互換（既存ブロックは不変）。新規依存なし・DBスキーマ変更なし。

## テスト（必須・純関数中心・実ネット非依存）
1. `classifyChange`: 増→buff / 減→nerf / 同値→adjust / 数値抽出不能→unknown / スラッシュ複数値（`50/70/90 ⇒ 55/75/95`→buff）/ **反転ステータス**（「クールダウン 12 ⇒ 10」→buff、「マナ 50 ⇒ 60」→nerf）。
2. `classifyChampion`: 全buff→buff / 全nerf→nerf / buff+nerf混在→adjust / 全unknown→adjust。
3. `composeDetailedPatchBody`: 3グループ見出しが分類どおりに並ぶ・空グループ非表示・非チャンピオン章が後続・逐語変更が保持される。
4. 冒頭サマリ: 集計数（buff/nerf/adjust体数・otherセクション数）が正しく、0の項目が省かれる。
5. 目次: heading に連番 anchor が付き、toc の items が全 heading を指す。ArticleBodyView が `<h2 id>` と目次リンクを描画し、既存（anchor無し）heading が回帰しない。
6. 実データ級のパッチテキスト（既存テストfixtureがあれば流用）で、3分類・サマリ・目次が破綻せず生成される。既存の compose/article-body/article-body-view テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. detailedパッチ記事が「バナー画像 → 冒頭1文サマリ → 目次 → 主な強化/主な弱体化/その他の調整（各チャンピオン画像＋逐語）→ 非チャンピオン章」の順で生成される。
3. 3分類が反転ステータスを誤らず、曖昧はadjustに倒れる。変更テキストは逐語のまま（捏造なし）。目次リンクが各章に飛ぶ。
4. AI不使用・DBスキーマ変更なし・新規依存なし・fact/summaryモードと非パッチ記事・既存記事の表示は不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- detailedパッチ記事の実機表示で、冒頭サマリ・目次（ページ内リンク動作）・3グループ振り分け・各チャンピオン画像・逐語変更が確認できる。
- 反転ステータスを含むパッチで誤分類が無い（またはadjustに倒れている）。既存の非パッチ記事・fact/summaryモードが崩れない。
- 受け入れ基準1〜4を満たす。
