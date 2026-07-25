---
tags: [sprint-evaluation]
sprint: E15
result: PASS
---

# Sprint E15 評価レポート

## 総合判定: PASS

## 検証モード: Bash（テスト＋スクリプト実行＋実ネットワーク確認）
- 本スプリントはサーバー側の収集ロジック（画面UIなし）のためPlaywright不要。
- 実ネットワーク（本物の Data Dragon CDN・キー不要）に到達可能な環境で実データ収集まで確認できた。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | live/mock収集・パイプラインとも例外なく完了 |
| コンソール・実行エラー0件 | PASS | 実行ログにエラーなし（reddit/5chスキップログは正常フロー）|
| 受け入れ基準充足率100% | PASS | F-E15-1/F-E15-2 の各項目を実機・テストで確認（下記）|
| テストGreen（全テスト成功）| PASS | `npm test` → 66 files / 571 tests passed |

## 受け入れ基準ごとの確認
- 実ネット収集: `node -e fetch(versions.json)` で到達確認（latest=16.14.1）。`COLLECTION_MODE=live` の collect で `[riot] success: fetched=16 saved=16`（新パッチ検知1件＋チャンピオン15件）。DBに実データ格納を確認（`【パッチ】16.14 のゲームデータが公開`、`【チャンピオン紹介】リリア(...)`等、live最新16.14と一致）。
- sourceUrl一意・重複排除: 同日再実行で `fetched=16 saved=16` だがDB総数は25のまま不変 → normalizedUrl一意制約により重複が増えない。パッチはmajor.minor単位・チャンピオンはID単位で安定URL（テストでも検証）。
- チャンピオンローテーション: `selectRotatedChampionIds` の純関数テストで実行日ごとに選択が変わること・初回以降0件で止まらないことを検証。
- fetch失敗時の握り潰し: HTTPエラー/不正JSON/ネットワーク断/champion側のみ失敗の4異常系テストで空配列（またはパッチのみ）を返しthrowしないことを確認。
- 段階的liveレジストリ: `getAllAdapters("live")` は riot のみ（テスト＝length 1）。実行ログでも reddit/5ch は「未実装のためスキップします」。`getAdapter("reddit"/"5ch","live")` は `/未実装/` でthrow（テスト）。mockモードは全3ソース従来どおり（テスト＝length 3・実行で reddit/5ch/riot 収集）。
- mock回帰: `COLLECTION_MODE=mock npm run pipeline` が end-to-end 成功（収集9→候補24→生成5→公開5、失敗0、エラーなし）。
- tsc/eslint: `npx tsc --noEmit` エラーなし。変更4ファイルの `npx eslint` 指摘なし（exit 0）。ビルドはselfeval記載の通り成功。
- 新規依存なし: package.json 変更なし（Node標準fetch＋AbortSignal.timeout）。秘密ハードコードなし（キー不要）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- riotの実行間隔は既定30分（`COLLECTION_RIOT_MIN_INTERVAL_MS`）。generator直後の再実行は `skipped-rate-limited` となるため、evaluatorの再検証では間隔を0に上書きして実フェッチを確認した（レート制限自体は仕様通りの正常動作）。
- チャンピオンページURLは内部id小文字の規約で構築。dedup要件（一意・安定）は満たすが、一部レガシーidで実在ページと厳密不一致の可能性（selfeval既知の通り。今回の受け入れ基準はURL一意性で判定するため影響なし）。

## 未検証項目（実機確認が必要）
- 別日をまたいだ実ネット収集での新チャンピオン順次収集（ローテーション窓のずれ）は、同日検証のため純関数テストでの確認に留めた（実ネット総数不変の重複排除は実機確認済み）。

## 後始末
- 実ネット/mock検証でDB変更したため `npm run db:seed` を実行し記事を初期状態（12件）へ復元済み。
- ※ `db:seed` はCollectedItem/CollectionRunをリセットしない設計のため、live/mock収集で追加された収集アイテムは dev.db（gitignore対象・非成果物）に残存する（selfeval明記通り、機能上の問題なし）。

## プレビュー画像
- 該当なし（本スプリントはサーバー側収集ロジックでUI変更なし）。

## 関連ドキュメント
- [[ext-e15-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e15-brief]]（本スプリントの仕様抜粋）
