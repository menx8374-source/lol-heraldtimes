---
tags: [sprint-selfeval]
sprint: growth-g6
---

# 成長G6 自己評価レポート

## 実装した内容
- `src/lib/generation/publish-schedule.ts`（新規）: `nextPublishSlots(now, count)` 純関数。JST(UTC+9)の 07:15/12:15/15:15/18:15/21:15 スロットを、UTC基準の計算のみ（`Date`のローカルTZ依存メソッド不使用）でnow以降・1スロット1件・翌日繰り越し・昇順で返す。DB非依存。
- `src/lib/generation/delivery.ts`（新規）: `notifyPublishedArticles(articles)`。`DISCORD_WEBHOOK_URL`設定時のみ`fetch`でPOST（`allowed_mentions:{parse:[]}`付き、タイムアウト5秒・最大1回）。未設定/0件はfetchを呼ばずno-op。送信失敗・非2xxはtry/catchで握りつぶしログ1行のみ。
- `src/lib/pipeline/config.ts`: `getPublishScheduleMode()`追加。env `PUBLISH_SCHEDULE_MODE`（既定"immediate"）。
- `src/lib/generation/post-pipeline.ts`（既定の生成経路）・`src/lib/generation/pipeline.ts`（旧CollectedItem経路、比較用）: 両方に、moderation通過後の公開状態決定ロジックを追加。`schedule`モード＋非免除ソース(reddit/5ch)のときのみ`status="scheduled"`＋`nextPublishSlots`による割当（同一実行内で逐次スロットをずらす）。`immediate`（既定）・免除ソース(riot/riot-news)は従来どおり即時`published`（コード上も従来と同一の代入内容）。`GenerationRunOptions`/`PostGenerationOptions`に既存の`now`（テスト注入用）を活用。`publicationStatus`の型に`"scheduled"`を追加。
- `src/lib/pipeline/run-pipeline.ts`: このパイプライン実行で新規に即時公開された記事(生成結果`publicationStatus==="published"`)＋`promoteScheduledArticles`で昇格した記事のIDを集約し、`notifyPublishedArticles`へ渡す。通知の準備・送信失敗はtry/catchで囲みパイプライン本体の成否に影響しない。旧経路呼び出しにも`now: startedAt`を追加（決定論性のため）。
- `.env.example`・`README.md`: `PUBLISH_SCHEDULE_MODE`・`DISCORD_WEBHOOK_URL`（キー名のみ、値は書かず）を追記。

## 技術選定（該当する場合のみ）
- 新規npm依存なし。Discord通知は Node標準の`fetch`を使用（brief制約どおり）。
- スケジュール判定はUTC基準の日付演算のみ（`Date.UTC`とgetUTC*系メソッド）でJST変換を行い、VPSのTZ設定に非依存にした。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1276 tests / 102 files）・`npx tsc --noEmit`エラー0・`npm run build`成功・`npm run lint`エラー0（既存の警告6件のみ、本スプリント無関係）。
- [x] `PUBLISH_SCHEDULE_MODE=schedule`で反応記事(reddit/5ch)が時刻テーブルに分散予約され(`status="scheduled"`+`scheduledAt`)、`promoteScheduledArticles`で到来時に公開される仕組み自体は既存のまま変更していない（`scheduledAt`到来判定・昇格ロジックは無変更）。免除ソース(riot/riot-news)は常に即時publishedであることをテストで確認。`immediate`（既定・未設定含む）は既存の即時公開と完全一致することをテストで確認（新規テストで検証済み。既存回帰テストも全Green）。
- [x] `DISCORD_WEBHOOK_URL`設定時のみfetchが呼ばれ、正しいペイロード（タイトル/URL/allowed_mentions）でPOSTされることをテストで確認。未設定時・記事0件時はfetch自体を呼ばない（no-op）ことを確認。送信失敗（例外・非2xx）でも例外を投げず本体が継続することを確認（run-pipeline結合テストでも「Discord通知失敗時にreport.status==="success"のまま完走する」ことを確認）。
- [x] AI不使用（スロット計算・分散・通知はすべて純ルール、生成/翻訳/SEO/収集ロジックは無変更）。DBスキーマ変更なし（`prisma/schema.prisma`は未変更、既存の`status`/`scheduledAt`/`publishedAt`列のみ使用）。新規npm依存なし。秘密（Webhook URL）はenv経由・`.env.example`にキー名のみ。既定挙動（`immediate`・Webhook未設定）は不変。

### 「既定挙動を絶対に変えない」の具体確認
- `immediate`（既定）・免除ソース時に生成する`article.create`のdata（`publishedAt: new Date()`, `status: "published"`, `scheduledAt: null`, その他の既存フィールド）は、変更前のコードが生成していた値と完全に同一（分岐先のコード自体もオリジナルと同じ代入を行うよう実装）。
- `DISCORD_WEBHOOK_URL`未設定時、`notifyPublishedArticles`内で`getWebhookUrl()`がnullを返した時点で即returnし、`fetch`を一切呼ばない（テストで確認済み）。
- DBスキーマ: `prisma/schema.prisma`は今回一切編集していない（既存の`status`/`scheduledAt`/`publishedAt`カラムのみ利用）。

## アプリの起動方法
- 依存インストール: `npm install`（初回のみ）
- 開発起動: `npm run dev`（既定 http://localhost:3000）
- 本番相当起動確認は本スプリントでは `npm run build && npm run start -- -p 3411` で実施し、`/`（200）・`/admin`（401、Basic認証未設定のため想定どおり）を確認後にサーバーは停止済み。
- パイプライン単体実行（スケジュール/通知の動作確認用）: `npm run pipeline`（`PUBLISH_SCHEDULE_MODE=schedule`・`DISCORD_WEBHOOK_URL=<webhook>`を`.env`に設定して実行すると実際に分散予約・Discord通知が発火する。既定では両方未設定のため無変更動作）。

## 既知の問題・懸念点
- 旧CollectedItem経路（`generation/pipeline.ts`、`GENERATION_SOURCE=collected`時のみ使用の比較用経路）にも同じスケジュール分散ロジックを実装したが、本番で実際に使われるのは既定の`post-pipeline.ts`経路。両経路とも単体テストで確認済み。
- Discord通知の実webhookへの送信は未検証（ブリーフの方針どおりfetchをモックしたテストのみ。実際のWebhook URLが無いため未接続確認）。実運用時は`.env`に`DISCORD_WEBHOOK_URL`を設定した上で1回実運用パイプラインを回し、実際にDiscordへ届くことを別途確認することを推奨。
- `PipelineRunReport`型・DBの`PipelineRunLog`には「新規scheduled件数」用の集計列は追加していない（brief・受け入れ基準に明記が無いためスコープ外と判断。既存の`publishedCount`/`heldCount`はscheduledを含まない値になるよう調整済み）。

## 追加したテスト
- `src/lib/__tests__/publish-schedule.test.ts`（新規）: `nextPublishSlots`の境界値・翌日繰り越し・TZ非依存（`process.env.TZ`を複数変更しても同結果）を検証。
- `src/lib/__tests__/delivery.test.ts`（新規）: `notifyPublishedArticles`のno-op（未設定/0件）・正しいペイロード・複数記事個別送信・送信失敗時/非2xx時に例外を投げず継続することを検証（fetchはモック、実webhookは叩かない）。
- `src/lib/__tests__/generation-post-pipeline.test.ts`（追記）: スケジュール分散モードの回帰なし・schedule時の反応記事予約・免除ソースの即時公開・複数記事の時刻ずらし割当を検証。
- `src/lib/__tests__/generation-pipeline.test.ts`（追記）: 旧経路でも同様のimmediate回帰なし・schedule時の反応記事予約/免除ソース即時公開を検証。
- `src/lib/__tests__/pipeline-run-pipeline.test.ts`（追記）: Discord Webhook未設定時のno-op・設定時の通知・送信失敗時にもパイプライン本体がsuccessで完走することを結合テストで検証（fetchはモック）。

## 関連ドキュメント
- [[growth-g6-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
