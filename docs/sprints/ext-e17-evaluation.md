---
tags: [sprint-evaluation]
sprint: E17
result: PASS
---

# Sprint E17 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・本番ビルド `npm run start`）＋ フィクスチャ/mock ＋ live グレースフル確認
- YouTube/Twitch実キーは環境に無いため実ライブ接続は未検証（ブリーフ通りFAIL根拠にしない）。mockフィクスチャ＋live無キー時グレースフルで検証。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 収集→記事化→表示まで一連が破綻なく通る。riot live実収集も動作 |
| コンソール・実行エラー0件 | PASS | clip記事ページ/カテゴリページで `browser_console_messages` エラー0件。collect/pipeline実行時エラーなし |
| 受け入れ基準充足率100% | PASS | 下記6項目すべて充足 |
| テストGreen（全テスト成功） | PASS | `npm test` → 68 files / 607 tests 全passed |

## 受け入れ基準の検証結果
- SourceType に clip 追加・ClipAdapter が YouTube/Twitch から RawCollectionItem[] 返却: PASS（clip.ts確認、fetchモックテストGreen、sourceUrl=動画/クリップURLで一意・`dedupeBySourceUrl`共通化）
- 各社キー独立の任意性・両方未設定で空＋スキップログ・失敗握り潰し・シークレット非漏洩: PASS
  - `COLLECTION_MODE=live` 無キー実行で `[clip] YOUTUBE_API_KEY が未設定...スキップ`・`[clip] TWITCH_CLIENT_ID/... 未設定...スキップ` の2ログ、clip fetched=0 saved=0、他ソース・全体を止めず riot fetched=16 saved=16、exit=0
  - http.ts はログに status/context（URL・非秘密）のみ、clip.ts のスキップログはキー名のみで値・トークン・client_secret 非出力
- clip 由来が「動画・クリップ」カテゴリの埋め込み紹介記事（見出し＋紹介文＋embed＋出典）として生成・placeholder表示: PASS
  - mock: seed→collect（`[clip] success: fetched=3 saved=3`）→pipeline で clip記事3件 published
  - DB確認: 全3件 blocks=heading("注目クリップ"),paragraph,embed。provider=youtube×2 / clip(Twitch)×1、URL一意
  - 記事ページ: embedプレースホルダー（🎬「配信クリップの埋め込み」＋元URLリンク＋「※埋め込みは本番接続時に表示されます」）、`iframe` 数=0（実iframe未読込）、出典に `[YouTube/Twitch]` リンク
- 新カテゴリがナビ・カテゴリ一覧・sitemap に自然に出る／既存に回帰なし: PASS
  - ヘッダーナビに「動画・クリップ」→ `/category/clips`、`/category/clips` 200・一覧3件表示、`/sitemap.xml` に clips 含む
  - パンくず・関連記事も正常
- getAllAdapters("live")=riot+reddit+clip（5chスキップ）／mockは4ソース従来どおり: PASS（adapters/index.ts・registry testで確認、mock collect で reddit/5ch/riot/clip 全て収集）
- npm test 全Green・tsc/build/eslint通過・新規依存なし: PASS（tsc エラーなし、`npm run build` 成功、テスト607 Green）

## 回帰確認（E15 riot / E16 reddit・既存機能）
- mock collect: reddit fetched=6 saved=4 / 5ch fetched=5 saved=3 / riot fetched=2 saved=2 / clip fetched=3 saved=3 — 既存3ソース回帰なし
- live collect（無キー）: riot 実ネット収集 fetched=16 saved=16 で正常動作、reddit は無クレデンシャルでグレースフル空
- 既存 reaction/fact 記事・カテゴリ・embed表示・ニュース記事風デザイン等の導線に破綻なし（カテゴリページ/記事ページのスナップショットで確認）

## 発見したバグ・問題点
- なし

## 軽微な改善点（ブロッカーではない）
- YouTube検索クエリが固定文字列 "League of Legends" 単一（複数キーワードOR未実装）。件数上限/relevanceは既存pipeline側が適用するため機能上の問題はなし（自己評価でも既知として明記済み）。

## 未検証項目（実機確認が必要）
- YouTube/Twitch 実キーでの本番ライブ疎通（`YOUTUBE_API_KEY`・`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET` 設定後の `COLLECTION_MODE=live npm run collect`）。評価環境にキーが無いため未検証（ブリーフ通りFAIL根拠にしない）。fetchモックテスト＋無キーグレースフル＋mock記事化/表示で代替検証済み。

## 後始末
- 検証で汚したDB（riot live 16件・collectedItem・sourceFetchLog）を削除し `npm run db:seed` で復元済み。起動サーバー停止済み（ポート3000解放確認）。

## プレビュー画像
- `ext-e17-preview-1-category.png`（「動画・クリップ」カテゴリ一覧）
- `ext-e17-preview-2-article-embed.png`（clip記事のembedプレースホルダー表示）

## 関連ドキュメント
- [[ext-e17-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e17-brief]]（本スプリントの仕様抜粋）
