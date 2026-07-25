---
tags: [sprint-evaluation]
sprint: E16
result: PASS
---

# Sprint E16 評価レポート

## 総合判定: PASS

## 検証モード: Bash（フィクスチャテスト＋liveスクリプト実行）
- サーバー側収集ロジックのためPlaywrightは不要。`npm test`（fetchモック）＋`COLLECTION_MODE=live npm run collect`＋`npm run pipeline`（mock）で検証。
- **実Reddit本接続は未検証**（評価環境にRedditクレデンシャル無し・仕様上の想定内。運営者のAPIキーで別途確認）。キー不在はFAIL根拠にしない。
- riotの実ネット収集は本評価で実施し確認済み（下記回帰参照）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | live/mock collect・pipelineとも例外で停止せず完走 |
| コンソール・実行エラー0件 | PASS | スキップログ（未設定・5ch未実装）は仕様上の想定内。JSエラー・throwなし |
| 受け入れ基準充足率100% | PASS | F-E16-1/F-E16-2の全受け入れ基準を確認（下記） |
| テストGreen | PASS | `npm test` → 67 files / 585 tests 全passed |

## 観点ごとの検証結果
- **1. テストGreen**: `npm test` 585 passed。`collection-reddit.test.ts`(15テスト)が (a)2段呼び出し（Basic認証ヘッダ・grant_type=client_credentials・Bearer・User-Agent付与）、(b)整形（permalink絶対URL・created_utc秒→Date・selftext優先/空ならタイトル）、(c)同一permalink重複排除でsourceUrl一意、(d)トークンHTTPエラー/リスティングHTTPエラー/不正JSON/ネット断→空配列(throwしない)、(e)クレデンシャル未設定→空配列＋fetch未呼び出し＋スキップログ1回（secret非含有）を検証。PASS
- **2. クレデンシャル未設定時のグレースフル動作**: creds未設定で`COLLECTION_MODE=live npm run collect`実行 → `[reddit] success: fetched=0 saved=0`＋スキップログ、riotは実ネットで収集（別実行でfetched=16 saved=16）、5chは未実装スキップ、パイプライン全体は完走。redditの0件が他ソースを止めないことを確認。PASS
- **3. 段階的liveレジストリ**: `getAllAdapters("live")`=riot+reddit（2件、5chスキップ）、mock=3ソース全MockSourceAdapter。registryテスト＋実collectで確認。PASS
- **4. シークレット非漏洩**: reddit.ts内の`console.*`はスキップログ1箇所のみでenvキー名のみ（値なし）。http.tsのログはstatus・context（非秘密のURL/サブレディット名）・err.messageのみ。basicAuth/access_token/Authorizationヘッダはログ経路に一切出ない。コード確認でPASS
- **5. 回帰**: 共通化した`http.ts`(fetchJsonSafe)経由でriotが実ネット収集成功（fetched=16 saved=16）。mock `npm run pipeline`が収集→生成→公開まで完走（生成成功5・公開5・失敗0）。`npx tsc --noEmit`エラーなし、`npx eslint .`エラー0（既存の無関係な警告1件のみ、E16変更外ファイル）。新規依存なし。PASS
- **6. 後始末**: live collectでdev.dbに入った実データを`npm run db:seed`で復元済み（シード12件）。

## 発見したバグ・問題点
- なし。

## 軽微な改善点
- `npm run collect`直後の再実行はrate-limitでソースがskipされる（仕様通りの想定挙動）。評価時はriot実ネット確認のため`COLLECTION_RIOT_MIN_INTERVAL_MS=0`で一時的に間隔を無効化して検証した。運用への影響なし。

## 未検証項目（実機確認が必要）
- 実Redditクレデンシャルでの本接続疎通（トークン取得→リスティング取得の実HTTP往復）。評価環境にキーが無いため未検証。運営者が`.env`に`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT`を設定し`COLLECTION_MODE=live npm run collect`で別途確認する（本接続はモックではなく実API・キー待ち）。

## プレビュー画像
- 該当なし（サーバー側収集ロジックで画面を持たない）。

## 関連ドキュメント
- [[ext-e16-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e16-brief]]（本スプリントの仕様抜粋）
