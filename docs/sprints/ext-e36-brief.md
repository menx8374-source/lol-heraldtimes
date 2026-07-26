# 拡張E36 — 強調色の調整（緑廃止・黒字は統一/非太字）＋NGは伏字でなく該当文のみ削除

運用フィードバック起点。反応記事の見た目とNG処理の改善。対象: Web。

## 背景（なぜ）
- 強調色に緑を使うと、レスの名前（「国内プレイヤーさん」等）が緑（`text-green-700`）で表示されるため被って見えづらい。
- 黒字（無色）のレスまで大きく＋太字になっていて、強調（色付き）との区別が付きにくい。
- NGワードは伏字(*)ではなく、その語を含む1文だけ削って掲載したい（残りで意味が通る範囲で）。

## 含まれる機能

### F-E36-1: 強調色パレットの変更（緑を廃止し紫を追加）
- `src/lib/article-body.ts` の `ArticleBodyEmphasisColor` から **"green" を削除**し、**"purple" を追加**。
  最終パレット: **"red" | "blue" | "purple" | "orange"**。
- `src/components/article-body-view.tsx` の色クラスを更新（緑を削除、紫・オレンジを追加。ダーク/design整合の既存トークンで。
  例 red=text-red-600/dark:text-red-400、blue=text-blue-600/dark:text-blue-400、purple=text-purple-600/dark:text-purple-400、
  orange=text-orange-600/dark:text-orange-400）。名前の緑（ResHeader）とは被らない色にする。
- `src/lib/generation/compose.ts`:
  - E32のLLM強調色の選択肢を **red/blue/purple/orange（緑は使わない）** に更新（system指示も更新）。
  - E33の色なし記事への決定論フォールバックの巡回色を **緑を含まない**（例 red→blue→purple→orange）に更新。
  - `normalizeReactionSelection` の許可color値も緑を除外し purple を許可。

### F-E36-2: 黒字（無色）は文字サイズ統一・非太字（色付きのときだけ大きく＋太字）
- `src/components/article-body-view.tsx` の反応レス描画で、**「大きく＋太字」を emphasisColor が有るとき（＝色付き強調）だけに限定**する。
  `emphasis:boolean` だけで色が無い場合は、**通常サイズ・非太字・黒字（プレーン）**として描画する。
  - 行単位の red/orange 強調（`computeLineEmphasis`）は従来どおり（該当行のみ色付き＋太字）。これは黒字ではないので対象外。
  - 目的: 黒字のレスは全て同じサイズ・非太字に統一し、色付き強調レスだけが大きく＋太字＋色で目立つ。

### F-E36-3: NGワードは伏字でなく「該当する1文のみ削除」（残りで意味が通れば掲載、通らなければレスごと不掲載）
- `src/lib/generation/compose.ts` の `buildReactionBlocks`（レス各行の生成、拡張E27で maskNgWords を適用していた箇所）を変更:
  - 各レス行を文単位（`splitIntoSentences` 等、句点・！・？で分割）に分け、**NGワード（`findNgWord`）を含む文を削除**して残りを結合する。
  - 文削除後に空になった行は落とす。
  - あるレスの全行が空になった（＝NG文を除くと何も残らない＝意味が通らない）場合は、**そのレス自体を反応ブロックに含めない**。
  - 逐語は維持（NG文以外のテキストは書き換えない）。伏字(*)化は行わない（本スプリントで置き換え）。
- moderation との整合: NG文を削除した結果、反応本文に生NGワードが残らないため `findNgWord` は反応せず公開される（E27の「保留しない」意図は維持）。人格攻撃/出典欠落/重複の保留は従来どおり。
- `maskNgWords` 関数自体は他用途のため残してよいが、反応記事本文では使わない（文削除に置換）。

## 制約・非目標
- 逐語維持（NG文の削除・強調色/選定index以外は書き換えない）。
- riot/clip・タイトル生成・サムネ・ナビ削除には触れない。新規依存なし。mock既定は従来どおり（回帰なし・コスト0。
  MockのreactionはemphasizeなしのままでOK。ただしF-E36-2/3はmockでも効く＝黒字統一・NG文削除は表示/生成の決定論処理）。
- LLM呼び出し回数は増やさない。

## テスト（必須・実API非依存）
1. `ArticleBodyEmphasisColor` に green が無く purple がある。article-body-view が purple/orange を色クラスで描画、green を扱わない。
2. emphasisColor 有りのレスのみ「大きく＋太字＋色」。emphasisColor 無し（emphasis:boolean のみ or 無し）は通常サイズ・非太字・黒字。行単位red/orangeは従来どおり。
3. E32のLLM色正規化が purple を許可し green を無効化（不正colorとして無視）。E33の巡回色に緑が出ない。
4. NG文削除: NGワードを含む文が削除され、残り文が結合される。行が空なら落ち、レスが全空ならそのレスは不掲載。逐語（NG以外）は不変。
5. NG文削除後の反応記事は `findNgWord` が反応せず公開扱い（保留されない）。人格攻撃等は従来どおり保留。
6. 既存のE25/E27/E28/E32/E33テストが本仕様に沿って回帰しない（緑・伏字を前提にしていたものは更新）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む・実API非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. 緑の強調が出ない（紫/オレンジ/赤/青のみ）。黒字は統一サイズ・非太字。NGは該当文のみ削除（伏字なし）、意味が通らなければレスごと不掲載。
4. 逐語維持・新規依存なし・LLM呼び出し増なし。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。実機(mock)で反応記事がコンソールエラー0で表示、黒字統一・非太字・緑が出ないことが視認できる。
- NG文削除・レス不掲載の分岐がテスト/データで確認できる。
- 受け入れ基準1〜4を満たす。
