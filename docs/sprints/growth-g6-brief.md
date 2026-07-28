# 成長G6 — 投稿スケジュール分散（時刻テーブル）＋配信導線（Discord Webhook）・純ルール/opt-in

成長提案書(docs/growth-research.md 観点⑥・G6)。まとめ系はアンテナ/RSS/SNS流入が大きく、**投稿時刻・オフセット・本数**が効く。
公開を閲覧の多い時間帯へ分散し、配信導線（RSS既存＋Discord通知）を足す。**AI不使用（純ルール）**。対象: Web。

## 背景（現状と最重要の安全設計）
- 現状 `src/lib/generation/pipeline.ts`／`generate-article.ts` は、モデレーション通過記事を **即時 `status="published"`／`publishedAt=now`** で公開する。予約機構 `promoteScheduledArticles`（scheduled-publish.ts）は `scheduledAt <= now` の `scheduled` 記事を `published` に昇格するが、**生成フローは現状 scheduled を使っていない**。
- **速報性（G8で強化する予定）とのトレードオフ**があるため、公開挙動の変更は**必ず opt-in（デフォルトは現状の即時公開のまま）**にする。既存の本番運用・テストを壊さないことが最優先。
- 配信の X 自動投稿は G7（GetXAPI）で扱う。RSS は `feed.ts` で実装済み。G6 の配信導線は **Discord Webhook 通知**（opt-in・外部URLはenv）に限定する。

## 含まれる機能

### F-G6-1: 公開スロット計算（純関数・新規 publish-schedule.ts）
`src/lib/generation/publish-schedule.ts`（新規）に、日本時間(JST=UTC+9)の公開時刻テーブルに基づく純関数を追加:
- 公開スロット: **7時・12時・15時・18時・21時（JST）＋15分オフセット**（＝07:15, 12:15, 15:15, 18:15, 21:15 JST）。定数テーブルで持つ。
- `nextPublishSlots(now: Date, count: number): Date[]`：`now` 以降で最も近いスロットから **count 個**の公開時刻（UTCのDate）を昇順で返す。**1スロットにつき1記事**（同時に複数記事なら次スロット・次スロットが尽きれば翌日の先頭スロットへ）。決定論。
- TZは**プロセスのローカルTZに依存しない**よう、UTC基準で+9時間して JST の時・分を判定する実装にする（VPSのTZ設定に左右されない）。うるう秒・DST無し（JSTはDST無し）で単純計算。
- 純関数・DB非依存で単体テスト可能にする。

### F-G6-2: スケジュール公開モード（opt-in・既定は即時公開のまま）
記事作成時の公開状態を、env で切り替え可能にする:
- env `PUBLISH_SCHEDULE_MODE`（既定 `immediate`＝現状どおり即時公開）。`schedule` のときのみ、生成記事を **`status="scheduled"` ＋ `scheduledAt=nextPublishSlots(...)` の割当** にする（即時 published にしない）。`immediate` では**現在の挙動を1バイトも変えない**。
- **速報性の例外**: `schedule` モードでも、**免除ソース（riot / riot-news＝公式パッチ/ニュース）は常に即時公開**（速報性を守る。`getExemptSourceTypes()` を再利用）。反応記事（reddit/5ch）のみスロット分散する。
- 1回のパイプライン実行で複数記事が scheduled になる場合、`nextPublishSlots` で**時刻をずらして割当**（同時公開の洪水を避ける）。割当は生成順で決定論。
- 設定の読み取りは `pipeline-config` 等の既存設定箇所に集約し、テストで差し替え可能にする。`promoteScheduledArticles` は既存のまま（scheduledAt到来で昇格）。

### F-G6-3: 配信導線 — Discord Webhook 通知（opt-in・失敗は握りつぶす）
`src/lib/generation/delivery.ts`（新規、または既存の通知箇所があればそこ）に、記事**公開時**の Discord 通知を追加:
- env `DISCORD_WEBHOOK_URL` が設定されているときのみ、公開された記事の**タイトル＋記事URL**（＋任意でカテゴリ）を Discord Webhook に `fetch` で POST する。未設定なら**何もしない**（no-op）。
- **本体を絶対に止めない**：送信失敗・タイムアウト・非2xxは try/catch で握りつぶし、ログに1行残すのみ（フレームワーク原則「補助処理は本体を止めない」）。リトライ地獄にしない（最大1回、短いタイムアウト）。
- 通知対象は「このパイプライン実行で新規に公開された記事」（即時公開分＋promoteで昇格した分）。二重通知を避けるため、既に通知済みを再送しない設計（実行単位での新規公開のみを対象にすれば十分。永続的な通知済みフラグまでは不要）。
- 送信ペイロードにユーザー入力由来の文字列（記事タイトル）を入れるため、Discordのメンション暴発（@everyone等）を避けるなら `allowed_mentions: { parse: [] }` を付ける。

## 制約・非目標
- **AIは使わない**（スロット計算・分散・通知はすべて純ルール）。生成・翻訳・SEO・収集ロジックは変更しない。
- **既定挙動を変えない**：`PUBLISH_SCHEDULE_MODE` 未設定/`immediate` では現状の即時公開と完全に同一。`DISCORD_WEBHOOK_URL` 未設定では通知は完全 no-op。**既存テストが回帰しないこと**。
- **DBスキーマ変更なし**（`status`/`scheduledAt`/`publishedAt` は既存カラム）。新規npm依存なし（`fetch` はNode標準）。
- 秘密（Webhook URL）はソースにハードコードせず env 経由。`.env.example` にキー名のみ追記（値は書かない）。
- X自動投稿はG7、速報性向上はG8で扱う（本スプリントでは触らない）。

## テスト（必須・実ネット非依存）
1. `nextPublishSlots`: 各スロット(07:15/12:15/15:15/18:15/21:15 JST)を正しく返す。now直後のスロットから、count個を1スロット1件で昇順・翌日繰り越し。TZ非依存（process.env.TZを変えても同結果）を境界時刻で検証。
2. スケジュールモード: `PUBLISH_SCHEDULE_MODE=schedule` で反応記事(reddit/5ch)が `scheduled`＋`scheduledAt`割当になり、免除ソース(riot/riot-news)は即時 `published` のまま。`immediate`（既定）では全記事が現状どおり即時公開（回帰なし）。
3. Discord通知: `DISCORD_WEBHOOK_URL` 設定時に fetch が正しいペイロード（タイトル/URL/allowed_mentions）で呼ばれる（fetchをモック）。未設定時は fetch を呼ばない。送信失敗時に例外を投げず本体が継続する。
4. 既存の run-pipeline / generation pipeline / scheduled-publish のテストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
2. `PUBLISH_SCHEDULE_MODE=schedule` で反応記事が時刻テーブルに分散予約され、`promoteScheduledArticles` で到来時に公開される。免除ソースは即時。`immediate`（既定）は現状と完全一致。
3. `DISCORD_WEBHOOK_URL` 設定時のみ公開記事がDiscord通知され、失敗しても本体が止まらない。未設定時は no-op。
4. AI不使用・DBスキーマ変更なし・新規依存なし・秘密はenv経由（.env.exampleにキー名のみ）・既定挙動が不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- 既定（immediate/未設定）で既存の即時公開・通知無しが完全に維持される（回帰なし）。opt-in有効化時のスケジュール分散・Discord通知がテストで確認できる。
- スロット計算がTZ非依存で決定論。通知失敗が本体を止めない。
- 受け入れ基準1〜4を満たす。
