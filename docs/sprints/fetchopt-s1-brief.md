# fetchopt-S1 — X検索クエリをhot閾値に整合（同じクレジットで記事化可能な良質ツイートを最大化）

Opus5設計のS1。監視/増加率をオフにした運用（現在値hotだけ記事化）に合わせ、**X検索の①fetchを記事化されるhot閾値に整合**させる。目的は「**同じXAPIクレジット（＝同じクエリ数）で、記事化できる良質ポストを多く拾う**」。**XAPI呼び出し回数（クレジット）は増やさない**。スキーマ変更なし・新規依存なし。

## 背景（現状のズレ＝無駄消費）
- X hotnessは `likeCount>=minScore(100) かつ (replyCount+quoteCount)>=minComments(30)`（`hotness/config.ts` の x）＋年齢窓 [minAgeMinutes30, maxAgeHours72]。
- 現行の既定クエリ（`x.ts` DEFAULT_SEARCH_QUERIES）は**返信条件が無い/faves不足**で、hot整合していない:
  - 国内 `(...) min_faves:100 lang:ja -filter:retweets -filter:replies`（返信条件なし）
  - 海外 `(...) min_faves:1000 lang:en -filter:retweets`（返信条件なし）
  - 議論 `(...) min_replies:30 min_faves:30 lang:ja`（min_favesが100未満）
- 結果、いいねは多いが返信が少ない＝**記事化できないツイートにクレジットを消費**（実データで X saved=2 が replies6/1 で hot未達だった）。
- 生成コストは増えない前提が確認済み: 記事生成/リプ取得は `post-pipeline.ts` の `selectTopHotPosts`（`maxPublishPerCategory`）通過後の targetPosts にのみ走る。

## 含まれる機能

### F-FO1-1: Xクエリを hotness config から導出して整合（x.ts）
- `x.ts` で `getHotnessConfig("x")`（`@/lib/hotness/config`）を import し、既定クエリのしきい値を**動的導出**する（DRY・将来のhot閾値変更に自動追随。循環依存なし＝hotness/configはcollection/typesのみ依存）:
  - `min_replies:${hot.minComments}`（＝30）を**全クエリ共通**で付与。
  - `min_faves:` は **per-queryのfloor と `hot.minScore` の大きい方** = `max(floor, hot.minScore)`。
- 既定3クエリを次の役割で全て hot整合にする（**クエリ数=3のまま＝クレジット不変**）:
  - **国内**（floor=100）: `(LoL OR LJL OR "リーグ・オブ・レジェンド" OR リグオブ) min_faves:100 min_replies:30 lang:ja -filter:retweets -filter:replies`
  - **海外**（floor=1000。1000はhot要件でなく英語圏の物量/コスト制御の下限として維持）: `("League of Legends" OR #LeagueOfLegends OR LoL) min_faves:1000 min_replies:30 lang:en -filter:retweets`
  - **eスポーツ特化**（議論クエリの再利用＝国内と重複させない。同一クレジットで別のhot集合を拾う）: `(LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会") min_faves:100 min_replies:30 lang:ja -filter:retweets`
- **`X_SEARCH_QUERIES` env の上書き経路は不変**（env指定時はそちらが優先＝`parseSearchQueries` の既存挙動）。導出は「env未指定時の既定クエリ生成」に効く。
- floor定数（100/1000）はコード内定数でよい。`min_replies`/`min_faves`のhot由来分は config 由来。

### F-FO1-2: since窓を hotの年齢窓に整合（x.ts）
- `X_SINCE_HOURS` の**既定を 24 → 72**（hotの`maxAgeHours=72`に整合）。faves>=100 かつ replies>=30 は蓄積に時間がかかり24h窓では取りこぼすため。72h超は年齢窓外で無駄なので72で頭打ち（それ以上広げない）。
- `X_SINCE_HOURS` env 上書きは維持。`product`（Latest）は不変（Top化はS3の任意・要検証のため本スプリントでは変えない）。**API呼び出し回数・1ページ取得は不変**。

## 制約・非目標
- **XAPI呼び出し回数（クレジット）を増やさない**（既定クエリ数=3のまま・1クエリ1ページのまま・since拡大やしきい値強化は呼び出しを増やさない）。within-queryの自動フォールバックのような**追加呼び出しはしない**（0件は「本当にhotが無い」正しい挙動として許容）。
- **hotness判定式・年齢窓・監視オフ運用は変えない**（fetch側をhotに寄せるだけ）。**スキーマ変更なし・新規npm依存なし**。逐語/moderation/既存経路・reddit/5ch/riot・PBE用`pbe-x-source.ts`（自前既定クエリを渡すため影響なし）は不変。
- 保存上限(`COLLECTION_X_MAX_ITEMS`)・reddit/5chの閾値はS2（env）で扱う。本スプリントはXクエリとsince既定のみ。

## テスト（必須・実HTTP非依存）
1. 既定クエリ生成: env未指定時、3クエリすべてが `min_replies:30`（=hot.minComments）を含み、`min_faves` が `max(floor, hot.minScore)`（国内100/海外1000/eスポ100）である。`getHotnessConfig("x")` の値から導出されている（configのminComments/minScoreをテストで変えたらクエリも変わる、をアサートできるとなお良い）。
2. eスポーツクエリが国内クエリと**同一文字列でない**（重複回避）。全クエリに `lang:` と `-filter:retweets` が付く。
3. `X_SEARCH_QUERIES` 指定時はそちらが優先され導出既定は使われない（`parseSearchQueries` 回帰なし）。
4. `X_SINCE_HOURS` 既定が72（未設定時）。env指定で上書き可。`appendSinceIfMissing` の既存挙動不変。
5. クエリ数=3（API呼び出し回数を増やしていない）。既存の x / pbe-x-source / collection テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. Xの既定検索クエリが hot閾値（likes>=100相当 かつ replies>=30）に整合し、返ってくるツイートが記事化可能なものに寄る。クエリ数=3のまま（クレジット不変）。since既定72。
3. hotness/年齢窓/スキーマ/依存不変・`X_SEARCH_QUERIES`上書き不変・reddit/5ch/riot/PBE不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。UIを持たない収集クエリ変更のため検証モードは「テスト＋静的確認」で可（Playwright不適用）。
- 既定クエリのhot整合（min_faves/min_repliesがconfig由来）・クエリ数3・since72・`X_SEARCH_QUERIES`優先が確認できる。クレジット不変（呼び出し回数不変）。
- 受け入れ基準1〜3を満たす。
