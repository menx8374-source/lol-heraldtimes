---
tags: [sprint-evaluation]
sprint: 3
result: PASS
---

# Sprint 3 評価レポート

## 総合判定: PASS

## 検証モード: コマンド実行 + DB状態確認（Playwright不要のバックエンド/バッチスプリント）
- 新規UIが無いため、`npm test`（Vitest）・`npm run collect` の実行結果・Prisma/SQLite の実DB状態確認で検証した。
- 収集は方針どおり fixture のモックアダプタ（live未実装＝明示エラー）。モックとして一貫動作するかで判定した。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 収集・重複排除・レート制限・失敗継続すべて期待どおり動作 |
| コンソール/実行エラー0件 | PASS | `npm run collect` 実行時にエラー出力なし。失敗ソースは例外を捕捉し failure 結果として記録（未捕捉例外なし） |
| 受け入れ基準充足率100% | PASS | 下記9項目すべて実機（コマンド/DB）で確認 |
| テストGreen（全テスト成功） | PASS | `npm test` → 12ファイル / 67テスト全pass
 |

## 受け入れ基準ごとの結果（全PASS）
- reddit/5ch/riot 各ソースから共通フォーマット（sourceType・sourceUrl・title・content・fetchedAt）で保存: PASS。`npm run collect` fresh実行で reddit=4 / 5ch=2 / riot=2、DB総数8件。schema に全カラム存在。
- 出典URL欠落は保存されない: PASS。reddit の空文字URL・5ch の null URL を含む生10件中、URL付き8件のみ保存（`toCollectionItems` で除外）。
- ソースごとの件数上限・実行間隔が設定として存在し上限超過の連続取得をしない: PASS。`config.ts` に `maxItemsPerRun` / `minIntervalMsBetweenRuns`。fresh実行直後の即再実行で reddit/5ch/riot 全て `skipped-rate-limited`、新規保存0件。
- LoL関連フィルタ: PASS。reddit の r/randomothergame（許可サブレディット外）・5ch「麻雀の戦術」（キーワード不一致）が保存されず候補にも入らない。
- 1ソース失敗でも他ソース完走・失敗記録: PASS。riot に例外送出アダプタを注入して `runCollectionPipeline` を実行 → reddit(success,4件) / 5ch(success,2件) は保存され、riot は `SourceFetchLog` に status=failure・errorMessage 付きで記録。全体は完走。
- 同一URL（正規化後）2回取込で候補1件: PASS。`normalizedUrl` unique 制約 + upsert。連続再実行でも総数8件のまま増えない。
- 高類似度の別URLを同一話題として片方のみ候補: PASS。reddit「Patch 14.6 Jungle Nerf Discussion Thread」(queued) と別URLの「…Megathread」(duplicate) が duplicate=1 に収束。
- 記事化済みソースは再候補にならない: PASS。riot パッチ14.6ノートのURLが Sprint1 シード記事の ArticleSource と正規化後一致 → status=articled、alreadyArticled=1 として候補から除外。
- 重複含む入力セットで候補キューに一意な話題だけ残る: PASS。収集8件 → queued=6 / duplicate=1 / articled=1。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 類似度判定が文字bi-gram Jaccardのため言語をまたいだ同一話題（英語reddit ジャングルナーフ と 日本語5ch/riot の同話題）は別候補として残る。self-eval・architecture.md に明記済みの既知トレードオフで受け入れ基準（同一言語内の重複検出）は満たす。将来LLMベース意味的重複への置換余地。
- `npm run collect` はレート制限内だと全ソース skipped になり収集アイテムが増えない仕様。運用時に「即再実行しても増えない」挙動を README 等で明示しておくと親切（self-evalには記載あり）。

## 未検証項目（実機確認が必要）
- live収集アダプタ（本番 Reddit/5ch/Riot API 本接続）: 認証情報待ちのため未実装（呼び出すと明示エラー）。方針どおりモックのみ検証。本接続時の規約・レート制限順守は実機確認が必要。

## プレビュー画像
- 該当なし（新規UI無しのバックエンド/バッチスプリントのため）。

## 関連ドキュメント
- [[sprint-3-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-3-brief]]（本スプリントの仕様抜粋）
