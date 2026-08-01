# reactqual-S1 — X反応記事の非LoL混入を修正（裸"LoL"の誤ヒット＋関連バイパスを是正）

実データで確認したバグ1の修正。X検索クエリの裸 `LoL` が「lol＝笑」に誤ヒットし、X関連フィルタを完全バイパスしているため、政治ツイート等の**非LoLツイートが記事化**された（例: 元ツイート`@catturd2`が政治、タイトルLLMが「LOLプレイヤー」と捏造）。**誤情報・信頼に直結するため最優先**。

## 根本原因（確定）
- `src/lib/collection/adapters/x.ts` `buildDefaultSearchQueries()` の国内/海外クエリに**裸 `LoL`** が入っている（X検索は大小非区別＝"lol"にヒット）。
- `src/lib/collection/filter.ts` `isRelevantItem()` の X 分岐が `return true;`（**関連判定を完全バイパス**）で、裸LoLの非LoLツイートを素通りさせる。

## 含まれる機能

### F-RQ1-1: Xクエリをゲーム特化に（x.ts buildDefaultSearchQueries）
- **裸 `LoL`/`lol` を全廃**し、曖昧でない語に置換（**クエリ数=3・`min_faves`/`min_replies`の hotness config 導出（fetchopt-S1）は不変**。ORの語彙だけ変更）:
  - 国内(domestic): `(LJL OR "リーグ・オブ・レジェンド" OR リーグオブレジェンド OR リグオブ OR #LoL OR "League of Legends")` ＋ 既存 `min_faves:${domesticMinFaves} min_replies:${minReplies} lang:ja -filter:retweets -filter:replies`
  - 海外(overseas): `("League of Legends" OR #LeagueOfLegends OR #LoL OR LJL)` ＋ 既存 `min_faves:${overseasMinFaves} min_replies:${minReplies} lang:en -filter:retweets`
  - eスポーツ: **現状維持**（`LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会"`・裸LoLなし）
- `#LoL`（ハッシュタグ）は「lol＝笑」と区別できるため残す。中黒あり/なし表記・スラング「リグオブ」で国内の当たり減を補う。

### F-RQ1-2: LoL固有語の判定（新設 lol-terms.ts）＋Xの関連再チェック（filter.ts）
- 新設 `src/lib/collection/lol-terms.ts`（収集層に置き、generation層への逆importを避ける）に **`LOL_SPECIFIC_TERMS: string[]`**（すべて小文字）と純関数 **`containsLoLTerm(text: string): boolean`**（`text.toLowerCase().includes(term)` のいずれか）を定義:
  - 判定語 = **曖昧でないLoL固有語のみ**（例: `"league of legends"`, `"リーグ・オブ・レジェンド"`, `"リーグオブレジェンド"`, `"リグオブ"`, `"ljl"`, `"lck"`, `"lpl"`, `"lec"`, `"msi"`, `"worlds"`, `"#lol"`, `"#leagueoflegends"`, ＋主要チャンピオン名（`config.ts` の `DEFAULT_LOL_KEYWORDS` から**裸 "lol" 等の曖昧語を除いた**LoL固有部分を流用または再掲）。
  - **`"lol"`（裸）・"笑"と紛らわしい単独語は判定語に入れない**（誤混入の根絶）。
- `filter.ts` の `isRelevantItem` を修正:
  - 引数型を `{ sourceType: SourceType; sourceUrl: string; title: string; content?: string }` に拡張（`collect-source.ts` は `CollectionItem`＝contentを持つため呼び出し側の変更は不要なはず・要確認）。
  - **X 分岐を `return true` → `return containsLoLTerm(item.content ?? item.title);`** に変更（tweet全文で固有語を確認）。riot-newsバイパス・reddit/5chの判定は不変。

## 制約・非目標
- **fetchopt-S1のクエリ導出（min_faves/min_replies・クエリ数3・クレジット不変）を壊さない**（ORの語彙のみ変更）。**hotness/収集足切り/moderation/スキーマ/依存は不変**。逐語・出典は不変。
- 誤除外と誤混入のバランス: (a)のクエリで返るツイートは固有語を含むため content 再チェックはほぼ通過し、縁ケース（裸lolだけ等）のみ弾く。裸LoLしか含まない真のLoLツイートの誤除外は小（許容）。
- `pbe-x-source.ts`（自前既定クエリ）・`X_SEARCH_QUERIES` env上書きは不変。generation層への逆import禁止（語彙は collection 層 or 共有に置く）。

## テスト（必須・実HTTP非依存）
1. `containsLoLTerm`: `"League of Legends面白い"`/`"アジール強すぎ"`（チャンピオン名）/`"#LoL 今日のランク"` → true。`"lol that's so funny"`/`"草www lol"`/`"just lol"`（笑のlol） → **false**。空文字false。大小無視。
2. `buildDefaultSearchQueries`: 国内/海外クエリが**裸の `LoL`/`lol` を含まない**（`#LoL`・`"League of Legends"` はOK）。各クエリに `min_faves:`/`min_replies:`（hotness config由来）が残る。クエリ数=3。eスポーツ不変。
3. `isRelevantItem`: `sourceType:"x"` で content にLoL固有語ありなら true、無し（政治ツイート等）なら **false**。reddit/5ch/riot-news の既存判定は不変（回帰なし）。`content` 未指定時は title で判定。
4. 既存の x / collection-filter / collect-source テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. 裸LoLの誤ヒットが解消し、非LoLツイート（政治等）がXの関連再チェックで除外される。Xクエリはゲーム特化＋fetchopt-S1のhot整合(min_faves/min_replies)を維持。
3. hotness/収集/スキーマ/依存不変・fetchopt-S1/PBE/X_SEARCH_QUERIES不変・generation層への逆importなし。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。検証モードは「テスト＋静的確認」で可（実API不要）。
- `containsLoLTerm` が笑のlolを弾きLoL固有語を通す・クエリに裸LoLが無い・Xの関連再チェックが効く・他ソース/既存挙動不変。
- 受け入れ基準1〜3を満たす。
