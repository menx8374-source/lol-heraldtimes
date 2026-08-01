# reactqual-S5 — X関連判定から汎用eスポーツ語（世界大会/MSI/Worlds）を除去（非LoL混入バグ）

実データで確認したバグ。X反応記事に**非LoL**の投稿（EWC=Esports World Cup=複数タイトル合同大会の「vs SSG 1-2 lose 今回のEWCはここで終わり また次の世界大会で…」）が混入した。真因は `世界大会` が**eスポーツ全般の世界大会**を指す汎用語なのに、LoL固有語として関連判定を通し、かつeスポーツ特化クエリでも収集していたこと。

## 根本原因（確定）
- `src/lib/collection/lol-terms.ts` の `LOL_SPECIFIC_TERMS` に `"世界大会"` が含まれる → `containsLoLTerm("…また次の世界大会で…")` が true を返し、X関連再チェック（filter.ts）を通過。
- `src/lib/collection/adapters/x.ts` の eスポーツ特化クエリ `(LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会")` が `世界大会` で当該ツイートを収集。
- `MSI`/`Worlds` はクエリにあるが `LOL_SPECIFIC_TERMS` には**無い**（曖昧語として意図的に除外済み）。よって `MSI`/`Worlds` だけで当たったツイートは収集されても関連再チェックで**必ず落ちる**（＝記事化されないのにクレジットを消費する死に枝）。

## 含まれる機能

### F-RQ5-1: `世界大会` を LOL_SPECIFIC_TERMS から除去（lol-terms.ts）
- `LOL_SPECIFIC_TERMS` から `"世界大会"` の1エントリを削除する。
- 理由コメントを1行追加/更新: 「`世界大会`はeスポーツ全般の世界大会（EWC等の複数タイトル合同大会含む）を指す汎用語で、非LoLを通すため関連判定に含めない」。
- チャンピオン名・`league of legends`・`#lol` 等の他エントリ、`WORD_BOUNDARY_TERMS`（ljl/lck/lpl/lec）は**不変**。

### F-RQ5-2: eスポーツ特化クエリを LoLリーグ名のみに絞る（x.ts buildDefaultSearchQueries）
- `esports` クエリの語群を `(LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会")` → **`(LJL OR LCK OR LPL OR LEC)`** に変更する（`MSI`/`Worlds`/`世界大会` を削除）。
- 理由: これら3語は汎用語で、(a) `世界大会` は非LoL誤収集の原因、(b) `MSI`/`Worlds` は関連再チェックに無く**必ず落ちる死に枝**（記事化される投稿を1件も失わず、無駄なクレジット消費だけを削減）。`LJL/LCK/LPL/LEC` はLoLリーグ名で `WORD_BOUNDARY_TERMS` と整合（クエリ語 ⊆ 再チェック語）。
- `domestic`/`overseas` クエリ・`min_faves`/`min_replies`/`lang`/`-filter` 等の他部分・クエリ数（=3・クレジット不変）は**不変**。
- 実際のLoL Worlds/MSIのツイートは通常 `#LoL`/`League of Legends`/リーグ名も含むため domestic/overseas 側で拾える（本変更で記事化対象を失わない）。

## 制約・非目標
- `containsLoLTerm` のロジック・`WORD_BOUNDARY_TERMS`・部分一致の仕組みは不変（データの1語削除とクエリ文字列の変更のみ）。
- filter.ts のX分岐（`containsLoLTerm` 呼び出し）・他ソース（reddit/5ch/riot）の判定・moderation・選定・表示は不変。
- スキーマ変更なし・新規依存なし・LLM呼び出し増なし。reactqual-S1〜S4b・resel・fetchopt・revalidate・polish と整合。

## テスト（必須）
1. `containsLoLTerm("vs SSG 1-2 lose 今回のEWCはここで終わりです また次の世界大会でリベンジします")` → **false**（世界大会/EWC/SSGだけでは非LoL）。
2. `containsLoLTerm` が引き続き **true** を返す: `"#LoL 楽しい"`, `"League of Legends"`, `"LJL開幕"`, `"LCK決勝"`, `"ヤスオ強い"`, `"リーグ・オブ・レジェンド"`。
3. `buildDefaultSearchQueries()` の eスポーツクエリ（index 2）が `(LJL OR LCK OR LPL OR LEC)` で始まり、`MSI`/`Worlds`/`世界大会` を**含まない**。domestic（index 0）/overseas（index 1）は従来どおり（`#LoL`/`League of Legends`/リーグ名を含む）。
4. 既存の lol-terms / x / filter / collection テストが回帰しない（世界大会を前提にしたアサーションがあれば新仕様に更新）。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. 世界大会/EWC/SSG のみの非LoL投稿が関連判定で落ち（false）、eスポーツクエリが汎用語で収集しなくなる。既存のLoL固有語判定・domestic/overseas収集は不変。
3. スキーマ/依存不変・他スプリント整合。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- `containsLoLTerm`: 世界大会/EWC/SSG単独→false、LoL固有語→true を実コードで確認。
- `buildDefaultSearchQueries`: eスポーツクエリが `(LJL OR LCK OR LPL OR LEC)`・MSI/Worlds/世界大会なし・クエリ数3不変。domestic/overseas不変。
- 受け入れ基準1〜3を満たす。
