# 拡張E32 — 強調レスの色分け（赤に加え青・緑など、LLMが色を割り当て）

運用フィードバック（おばにゅー流の色分け強調）起点。E28のLLMレス選定・強調の上に構築。対象: Web。

## 背景（なぜ）
- 参考: おばにゅーは重要レスを**赤字だけでなく青字など複数色**で色分けして強調する。
- 現状: 行単位の強調は `red`/`orange` のみ（`computeLineEmphasis`のルールベース）。レス単位の強調(E25/E28)は
  `emphasis?: boolean`（大きく＋太字、色は既定の濃色）で色分けは無い。
- 要望: **強調レスに色（赤/青など）を付け**、記事内で色分けされた強調が出るようにする。色はLLMの編集判断で割り当てる。

## 含まれる機能

### F-E32-1: レス強調に色を持たせる（表示層）
- `src/lib/article-body.ts`: `ArticleBodyReactionBlock` に `emphasisColor?: "red" | "blue" | "green"` を追加（任意）。
  既存の `emphasis?: boolean`（大きく＋太字）は維持し、`emphasisColor` があればその**色付き**にする。
  後方互換: `emphasis:true` のみで `emphasisColor` 無しなら従来どおり大きく＋太字（濃色）。型検証も追加。
- `src/components/article-body-view.tsx`: 強調レス（`emphasis`）を、`emphasisColor` に応じて色付き（大きく＋太字＋色）で描画。
  色クラスはダーク/ライト・design切替と整合する既存トークンで（例 赤=text-red-600/dark:text-red-400、
  青=text-blue-600/dark:text-blue-400、緑=text-green-700/dark:text-green-400）。`emphasisColor`無しは従来の濃色のまま。

### F-E32-2: LLMが強調色を割り当てる（E28の contract 拡張・後方互換）
- `src/lib/generation/compose.ts` の `reaction-select`:
  - 返却JSONの `emphasize` 各要素を **`number`（従来: 色は既定=色なし濃色）** または
    **`{ "index": N, "color": "red"|"blue"|"green" }`（色付き強調）** の両対応にする。
  - `normalizeReactionSelection`: emphasize を「採用レスindex → 色 or null」に正規化（indexはkeepの部分集合、
    color は許可値のみ、不正colorは無視して色なし）。既存の `emphasizeIndices` は保ちつつ色情報を持つ形に拡張。
  - system指示に「emphasizeは特に注目・重要なレス。おばにゅー流に色(red=最重要/否定的な反応, blue=注目/肯定的,
    green=補足 等)を割り当ててよい（色は任意）」を追記。**本文・行は書き換えず選ぶだけ**は維持。
  - `buildReactionBlocks`: emphasizeに選ばれたレスに `emphasis:true` ＋（色があれば）`emphasisColor` を付与。

## 制約・非目標
- 逐語転載を維持（LLMは色/選定indexのみ。本文は書き換えない）。
- mock既定（APIキー無し）は従来どおり全レス・強調なし（回帰なし・コスト0）。`MockLLMClient` の reaction-select は
  従来の「全keep・emphasize空」を維持。
- 行単位の red/orange 強調（computeLineEmphasis）は変更しない（役割が違う。今回はレス単位の色）。
- タイトル生成・サムネ(E31)・NG処理には触れない。LLM呼び出し回数は増やさない（1記事1回のreaction-selectに色も含める）。新規依存なし。

## テスト（必須・実API非依存、LLMスタブ）
1. `emphasize=[{index:1,color:"blue"}]` のとき、レス2に `emphasis:true` ＋ `emphasisColor:"blue"` が付く。
2. `emphasize=[1]`（数値・後方互換）のとき、レス2は `emphasis:true`・`emphasisColor` 無し（従来の濃色強調）。
3. 不正color（例 "pink"）は無視して色なし。emphasize が keep外なら除外（E25/E28の正規化を維持）。
4. `article-body-view`: `emphasisColor` に応じた色クラスで描画、無しは従来。行単位red/orangeと併存。
5. mock時は従来どおり（回帰なし）。既存E25/E28/E27テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規含む・実API非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. LLMが色を返すと強調レスが色分け表示され、数値emphasizeや未指定は従来の濃色強調（後方互換）。
4. mock既定で従来どおり（回帰なし・コスト0）。逐語維持・新規依存なし。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。実機(mock)で反応記事が従来どおり表示（回帰なし・コンソールエラー0）。
- `emphasisColor` 付きデータ/テストで色分け強調が視認できる。
- 受け入れ基準1〜4を満たす。
