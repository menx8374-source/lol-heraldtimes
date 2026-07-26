# 拡張E37 — 反応記事のサムネにチャンピオンアートを出す（未検出時の決定論フォールバック）

運用フィードバック起点。反応記事（5ch/海外の反応）のサムネ改善。対象: Web。

## 背景（なぜ）
- 拡張E31で「本文にチャンピオン名があれば公式スプラッシュをサムネにする」を入れたが、チャンピオン名を
  含まない反応記事（議論・マッチング・ランク etc.）は無地のカテゴリSVG（`/default-thumb-5ch.svg`）に
  フォールバックし、LoLらしいビジュアルにならない。
- おばにゅー等の参考サイトはどの記事にもゲームのキービジュアルが入っていて見栄えする。反応記事でチャンピオンが
  特定できない場合も、**LoLチャンピオンのアート（公式スプラッシュ）を出す**ようにしたい。

## 含まれる機能

### F-E37-1: 決定論的チャンピオンスプラッシュの選択（champion-thumbnail.ts）
- `src/lib/generation/champion-thumbnail.ts` に、記事ごとに安定して1体のチャンピオンを選ぶ関数を追加する。
  例: `pickDeterministicChampionSplashUrl(key: string): string`。
  - 見栄えのする代表的なチャンピオンID（`_0` スプラッシュが確実に存在する公式CDNの championId）を
    **キュレーションした固定プール**（例: Ahri/Yasuo/Jinx/LeeSin/Lux/Ezreal/Zed/Katarina/MissFortune/
    Thresh/Garen/Darius/Vayne/Kaisa/Yone/Sett/Viego/Jhin/Akali/Riven/Irelia/Lucian/Kindred/Aphelios など
    20体前後）を用意する。
  - `key`（記事の安定キー。candidate.id を渡す）から**決定論的なハッシュ**（例: 各文字コードの和を
    プール長で剰余。`Math.random`・`Date.now` は使わない＝決定論）でプールのindexを選び、
    `buildChampionSplashUrl(championId)` を返す。
  - 同じ key なら常に同じチャンピオン、異なる key ならプール内で分散する（全記事が同じ絵にならない）。
- 既存の `buildChampionSplashUrl` を再利用する（新しいURL組み立ては作らない）。

### F-E37-2: 反応記事でチャンピオン未検出のときに F-E37-1 を適用（generate-article.ts）
- `src/lib/generation/generate-article.ts` の thumbnailUrl 決定ロジック（現状: imageUrl → detectChampionSplashUrl → null）で、
  **reaction形式（sourceType が "5ch" | "reddit"）** かつ imageUrl も detectChampionSplashUrl も無い場合に限り、
  `thumbnailUrl = pickDeterministicChampionSplashUrl(candidate.id)` を設定する。
  - 優先順は従来どおり維持: ①candidate.imageUrl（安全なURL）②本文からのチャンピオン検出スプラッシュ
    ③（今回追加・reactionのみ）決定論チャンピオンスプラッシュ。①②が取れたらそのまま（回帰なし）。
  - reaction以外（riot=パッチ/メタ, clip=eスポーツ）は従来どおり（imageUrl→detect→null でカテゴリSVGに
    フォールバック）。反応記事のみ絵を必ず出す。
- `candidate.id` は既に GenerationCandidate にある安定な識別子。これをキーに使えば記事ごとに絵が固定され、
  再生成でも同じ絵になる。

## 制約・非目標
- 逐語維持・記事本文/タイトル/NG/強調色には触れない。新規依存なし。LLM呼び出し増なし。
- 実ネット非依存: `pickDeterministicChampionSplashUrl` はURL文字列を組み立てるだけでfetchしない
  （detectと同じ設計。画像取得はブラウザが表示時に公式CDNから行う）。
- mock既定でも効く（決定論なのでコスト0・回帰は「反応記事のサムネがカテゴリSVGでなくスプラッシュURLになる」点のみ。
  既存テストで「反応記事のthumbnailUrlがnull」を期待していたものは新仕様に更新する）。
- パッチ/eスポーツ記事のサムネ挙動は変えない。

## テスト（必須・実API/実ネット非依存）
1. `pickDeterministicChampionSplashUrl`: 同じ key で常に同じURL（決定論）。異なる複数の key でプール内の
   複数チャンピオンに分散する（全部同じにならない）。返すURLは `buildChampionSplashUrl` 形式（`_0.jpg`）。
2. `generateArticleForCandidate`（reaction, チャンピオン名なし・imageUrlなし）: thumbnailUrl が
   決定論スプラッシュURL（null でない・`ddragon...splash/..._0.jpg`）になる。同じ candidate.id なら同じURL。
3. reaction でも imageUrl が安全なURLならそれが優先（回帰なし）。本文にチャンピオン名があれば
   detectChampionSplashUrl が優先（回帰なし）。
4. 非reaction（riot/clip）でチャンピオン未検出のときは従来どおり thumbnailUrl が null（カテゴリSVGに委ねる・回帰なし）。
5. 既存の generate-article/pipeline テストが本仕様に沿って回帰しない（反応記事のthumbnail期待を更新）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API/実ネット非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 反応記事（チャンピオン名を含まないものも）のサムネがLoLチャンピオンのスプラッシュになる。記事ごとに絵が分散し、
   同じ記事は常に同じ絵。imageUrl/本文チャンピオン検出がある場合はそちらが優先（回帰なし）。パッチ/eスポーツは不変。
4. 逐語維持・新規依存なし・LLM呼び出し増なし。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。実機(mock)で反応記事のサムネがチャンピオンアート（またはローカルCDN失敗時も
  imgのbroken表示にならないよう妥当なURL）で、コンソールエラー0。
- 決定論（同一キー→同一絵）と分散（複数キー→複数の絵）がテストで確認できる。
- 受け入れ基準1〜4を満たす。
