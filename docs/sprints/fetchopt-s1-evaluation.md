---
tags: [sprint-evaluation]
sprint: fetchopt-S1
result: PASS
---

# Sprint fetchopt-S1 評価レポート

## 総合判定: PASS

## 検証モード: テスト＋静的確認（Playwright不適用）
- UIを持たない収集クエリ変更のため、brief「評価基準」に従いPlaywrightは使用せず。
- テストスイート実行・`tsc`/`build`/`lint`・git差分の静的確認に加え、`npx tsx`で実モジュールをimportした**ランタイム実挙動検証**（クエリ文字列・fetch呼び出し回数・since計算）を実施。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 既定クエリ生成・env優先・since窓・呼び出し回数をランタイムで実測し全て仕様一致。既存経路の破壊なし（変更ファイルは3件のみ） |
| コンソールエラー0件 | PASS | `npm run build`=「✓ Compiled successfully」、`tsc --noEmit`=0、`lint`=0 errors（既存の無関係warning7件のみ）。実行時ログは`console.log("[x] queries=3 collected=0")`のみでerror出力なし |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3を全て実測確認（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **125ファイル / 1770テスト 全passed**（失敗0・skip表示なし） |

## 実測確認（ランタイム検証結果）
`npx tsx` で `src/lib/collection/adapters/x.ts` を直接importして実行した結果（env未設定・`.env`に`HOTNESS_*`/`X_S*`の上書きが無いことも確認済み）:

- (a) **クエリ数=3・hot整合**: `getHotnessConfig("x")` = `{minScore:100, minComments:30, minAgeMinutes:30, maxAgeHours:72}`
  - Q0 国内: `... min_faves:100 min_replies:30 lang:ja -filter:retweets -filter:replies`
  - Q1 海外: `... min_faves:1000 min_replies:30 lang:en -filter:retweets`
  - Q2 eスポ: `(LJL OR LCK OR LPL OR LEC OR MSI OR Worlds OR "世界大会") min_faves:100 min_replies:30 lang:ja -filter:retweets`
  - **config由来の直接証明**: 引数注入 `{minScore:250,minComments:55}` → `min_replies:55` / faves `250/1000/250`。さらに **env `HOTNESS_X_MIN_SCORE=300` `HOTNESS_X_MIN_COMMENTS=45` を設定すると `min_faves:300/1000/300`・`min_replies:45` に自動追随**（既定引数が呼び出し時評価のためenv変更も反映）。`min_faves`は`max(floor, minScore)`で海外floor1000は維持。
- (b) eスポクエリ ≠ 国内クエリ（別文字列・重複回避）。全3クエリに `lang:`（ja/en）と `-filter:retweets` あり。
- (c) `X_SEARCH_QUERIES="aaa ||| bbb"` → `["aaa","bbb"]`（既定は使われず優先）。空白のみ→既定3件。`pbe-x-source.ts` は `parseSearchQueries(raw, [DEFAULT_PBE_QUERY])` と第2引数で自前既定を渡しており無影響（`collection-pbe-x-source.test.ts` 無変更でGreen）。
- (d) `X_SINCE_HOURS` 既定72: `now=2026-07-27T12:00Z` → 全クエリに `since:2026-07-24`。env `X_SINCE_HOURS=12` → `since:2026-07-27`（上書き可）。`appendSinceIfMissing` は未指定時のみ付与・既存`since:`はそのまま（`foo since:2020-01-01` を維持）で不変。
- (e) **API呼び出し回数=3**（既定クエリ・stub fetchで実測 `calls.length===3`）、`product=Latest`・1ページ取得（cursor未使用）のまま＝**クレジット不変**。within-queryのフォールバック追加呼び出しなし。
- (f) **不変性**: `git status` の変更は `src/lib/collection/adapters/x.ts` / `src/lib/__tests__/collection-x.test.ts` / `.env.example` の3件のみ。`prisma/schema.prisma`・`package.json`（依存）・`src/lib/hotness/*`（判定式・年齢窓）・`buildXItem`等の他マッピング・reddit/5ch/riotは**未変更**。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 国内クエリのみ `-filter:replies` が付き、eスポ/海外には無い（briefの文言どおりで意図的だが、eスポ側はリプライ由来の薄い投稿が混じり得る。変換側の `isReply` 除外でカバーされるため実害は小さい）。
- 海外floor=1000は`hot.minScore`を大きく上回る固定値のため、hot閾値を上げても1000未満の範囲では追随しない（設計意図どおりだが、将来minScore>1000になった場合のみ追随する点はコメントに記載済み）。
- `lint` の既存warning7件（`<img>`使用・テスト内未使用変数）は本スプリント無関係の既存事項。

## 未検証項目（実機確認が必要）
- `X_API_KEY` 未設定のため、GetXAPI 実応答での「hot率が上がる／記事化可能な良質ツイートが増える」という**効果の実測**は本番投入後の実データでしか確認できない（クエリ文字列がhot閾値と一致していること自体は上記のとおり静的＋ランタイムで確認済み）。
- GetXAPI側の `min_replies:` operator の実サポートは外部API仕様であり本検証の範囲外（既存X-reply-S1で導入済みの前提を踏襲）。

## プレビュー画像
- 該当なし（UIを持たない収集ロジック変更・Playwright不適用のため）。

## 関連ドキュメント
- [[fetchopt-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[fetchopt-s1-brief]]（本スプリントの仕様抜粋）
