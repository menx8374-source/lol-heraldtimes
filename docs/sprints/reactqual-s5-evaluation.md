---
tags: [sprint-evaluation]
sprint: reactqual-S5
result: PASS
---

# Sprint reactqual-S5 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）+ Bash（vitest / tsc / build / lint / tsxによる実コード実行）
- ロジック修正のためtsxで対象関数を実import・実行して実測。加えて`npm run dev`(port 3000)で実機スモーク（`/`・`/category/x`）。
- 未検証項目なし（ネイティブ専用機能なし）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | `containsLoLTerm`/`buildDefaultSearchQueries`/`isRelevantItem`の実測が全て期待どおり（下記）。実機スモークで`/`・`/category/x`が200・正常描画。 |
| コンソールエラー0件 | PASS | `/`・`/category/x`ナビゲーション時のconsole: Total 2 messages（Errors 0 / Warnings 0）。dev.logもGET / 200・GET /category/x 200のみ。 |
| 受け入れ基準充足率100% | PASS | brief受け入れ基準1〜3をすべて充足（下記実測）。 |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **Test Files 134 passed (134) / Tests 1873 passed (1873)**、Duration 32.60s、失敗0。 |

## ビルド系（実行結果）
- `npx vitest run` → 134ファイル / 1873テスト 全Green。
- `npx tsc --noEmit` → 出力なし・exit 0（0エラー）。
- `npm run build` → **BUILD_EXIT=0**（Next.js 16.2.11、全ルート生成成功）。
- `npm run lint` → `✖ 7 problems (0 errors, 7 warnings)`・exit 0。警告7件はすべて既存箇所（site-header.tsxのimg、テスト内の未使用`_ms`/`_parent_id`/`_messages`）で本変更と無関係。

## 機能検証（実コードをtsxで実行した実測値）
### 1. containsLoLTerm（src/lib/collection/lol-terms.ts）
- `"vs SSG 1-2 lose 今回のEWCはここで終わりです また次の世界大会でリベンジします"` → **false**（期待どおり）
- `"世界大会の決勝"` → false / `"EWC 優勝"` → false
- true継続を確認: `"#LoL 楽しい"` / `"League of Legends"` / `"LJL開幕"` / `"LCK決勝"` / `"ヤスオ強い"` / `"リーグ・オブ・レジェンド"` → 全て **true**
- 真陽性を落としていないことを確認: `"世界大会 #LoL"` → **true**、`"世界大会でLJLチームが快挙"` → **true**
- 既存の誤爆防止も不変: `"lol そうなんだ"` → false、`"election の話"` → false、`"I bought a new MSI laptop"` → false（テスト）
- `LOL_SPECIFIC_TERMS` から `"世界大会"` のみ消え、他19語・`WORD_BOUNDARY_TERMS`(ljl/lck/lpl/lec)・判定ロジックは不変。

### 2. buildDefaultSearchQueries（src/lib/collection/adapters/x.ts）
実測出力（引数 minScore:100/minComments:10）:
- `[0] (LJL OR "リーグ・オブ・レジェンド" OR リーグオブレジェンド OR リグオブ OR #LoL OR "League of Legends") min_faves:100 min_replies:10 lang:ja -filter:retweets -filter:replies`
- `[1] ("League of Legends" OR #LeagueOfLegends OR #LoL OR LJL) min_faves:1000 min_replies:10 lang:en -filter:retweets`
- `[2] (LJL OR LCK OR LPL OR LEC) min_faves:100 min_replies:10 lang:ja -filter:retweets`
- index2が`(LJL OR LCK OR LPL OR LEC)`で始まり、`MSI`/`Worlds`/`世界大会` を含まない（全てfalse）。`min_faves`/`min_replies`/`lang:ja`/`-filter:retweets`は保持。
- domestic(0)・overseas(1)は従来どおり（#LoL/League of Legends/リーグ・オブ・レジェンド/lang:en等を含む）。
- 配列長 = **3**（引数なし呼び出しでも3・クレジット不変）。

### 3. 回帰（filter.ts・他ソース）
- `src/lib/collection/filter.ts` は本スプリントで**未変更**（git diffの変更は4ファイルのみ）。X分岐は `if (item.sourceType === "x") return containsLoLTerm(item.content ?? item.title);` のまま。
- `isRelevantItem` 実行実測: x+EWC/SSG/世界大会 → false、x+`#LoL` → true、x+`LJL開幕` → true、fivech`世界大会の展望を語るスレ` → **true（他ソース不変）**、reddit(許可サブレ+キーワード) → true、riot-news → true。
- `config.ts` の `DEFAULT_LOL_KEYWORDS` に `世界大会`/`MSI` は残存（他ソース収集は不変）＝X経路のみを絞る意図どおり。
- 差分はデータ1語削除・クエリ文字列変更・コメント・テストのみ。スキーマ変更なし・依存追加なし・LLM呼び出し増なし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- `lol-terms.ts` の既存コメント「（config.tsのDEFAULT_LOL_KEYWORDS側の既定クエリには残してよい）」は、S5でXの既定クエリからMSI/Worldsを外した経緯と読み合わせると誤読の余地がある（実態はconfig.tsの他ソース用キーワードのみ残存）。文言の微修正で意図が明確になる。
- `collection-x.test.ts` の `expect(esports).not.toContain("Worlds")` は大文字小文字を区別するため、将来 `worlds` 小文字で復活した場合に検知できない。現状の実装値では問題なし。
- lint警告7件（既存）: テスト内の未使用引数、`site-header.tsx`の`<img>`。今回の変更とは無関係。

## 未検証項目（実機確認が必要）
- 実際のX API（`X_API_KEY`）を用いた本番収集での混入ゼロの確認は、有料APIキー・実クレジットを要するため未実施（クエリ文字列と関連判定のロジックレベルでは実測確認済み）。

## プレビュー画像
- `reactqual-s5-preview-1.png`（/category/x 一覧・dev実機）

## 関連ドキュメント
- [[reactqual-s5-selfeval]]（ジェネレーターの自己評価レポート）
- [[reactqual-s5-brief]]（本スプリントの仕様抜粋）
