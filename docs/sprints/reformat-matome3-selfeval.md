---
tags: [sprint-selfeval]
sprint: reformat-matome3
---

# モックスレッドデータ充実（reformat-matome3）自己評価レポート

対象: 直前コミット `b1a32da`（反応まとめ＝レス羅列中心）に対する、ユーザー要望による**モックスレッドデータの充実**（ロジック変更ではなくfixture/seedの中身をオリジナル創作で書き直す作業）。

## 実装した内容
- `src/lib/collection/fixtures/5ch.json`（5件）
  - LoL関連の3スレッドを議論系トピック中心・9〜12レスに全面書き直し（オリジナル創作）:
    1. 【LoL】バロン前ワイプ、ADCの単騎特攻かサポートのピール不足か議論勃発（12レス、集団戦の負け筋論争）
    2. 【5ch】ヤスオの伝説的アウトプレイ（10レス、神プレイ賞賛＋実は計算づくか運かのミニ議論＋サモナースペル論争）
    3. 【LoL】公式配信の実況解説スレ（9レス、実況批判の議論が個人攻撃にエスカレートする保留デモ用）
  - 麻雀の無関係スレ・URL無し投稿（フィルタ動作確認用のネガティブfixture）は変更なし。
- `src/lib/collection/fixtures/reddit.json`（6件）
  - LoL関連の4スレッドを議論系トピック中心・9〜12レスに全面書き直し（オリジナル創作、海外の反応口調）:
    1. Patch 14.6 Jungle Nerf Discussion Thread（11レス、パッチ議論＋ガンク優先度論争）
    2. Worlds 2026 Group Stage Draw Announced（9レス、シード配分の公平性ミニ議論）
    3. Yasuo OTP penta-worthy outplay（10レス、神プレイ賞賛＋ピック/ビルド/召喚士スペル論争）
    4. Jungle pathing debate: contesting Baron with zero vision（12レス、旧megathreadを再構成。オブジェクト判断の是非＋役割間の責任擦り付け合い）
  - 無関係投稿・URL無し投稿は変更なし。
- `prisma/seed.ts`
  - reactionブロックを含む5記事（5chの反応/海外の反応カテゴリ）を全て8〜9レスの議論系内容に更新（オリジナル創作）:
    - `5ch-yasuo-otp-densetsu-no-play`（9レス）
    - `overseas-tier-list-patch-146-hantei`（9レス、ピック/ビルド妥当性論争）
    - `5ch-support-item-change-giron`（9レス、ピール/ビルド論争）
    - `overseas-jungle-diff-funny-clip`（9レス、ガンク優先度・視界責任論争）
    - `5ch-toplane-matchup-giron-atsui`（9レス、アイテム/TP判断の是非論争）
  - 既存のNGワード（「ゴミ扱いされてた」）を含んでいた1行をNG語彙を使わない表現に置換（seedはmoderation非経由で直接DB投入のため、品質のため修正）。
  - Riot公式・eスポーツ系5記事（fact形式）は変更なし。
- `src/lib/generation/thread-format.ts`
  - `EMPHASIS_KEYWORDS`に議論系の決定的な一行を拾うためのキーワード「戦犯」「言い訳」「論破」を追加（強調ロジック自体は無変更）。
- `src/lib/__tests__/generation-thread-format.test.ts`
  - 追加した3キーワードが赤強調されることを検証するテストケースを1件追加。

## 技術選定
該当なし（新規ライブラリ・技術選定は発生していない。既存構成・スキーマのままデータのみ差し替え）。

## 受け入れ基準チェック（自己申告）
- [x] 1スレあたり8〜14レス — fixture(5ch/reddit)の関連スレは9〜12レス、seed.tsのreaction記事は9レス。全て範囲内。
- [x] 議論系トピック（集団戦の責任・ガンク優先度/ローム・ピック/ビルド/召喚士スペル・オブジェクト判断・役割間の擦り付け合い・戦犯or正解の意見割れ）を中心に据えた — 上記の各スレッド一覧の通り全カテゴリを充足。
- [x] オリジナル創作（実在サイトの複製・転用なし、実在個人名の晒しなし）— 全文新規書き起こし。チャンピオン名・ロール名・LoL用語は一般名詞として使用。匿名の一般論争にとどめ、held用デモも架空の「田中さん」への言及のみ（実在人物ではない、個人情報の暴露なし）。
- [x] 保留(held)されるべきスレを1件維持し、議論が個人攻撃にエスカレートする例にした — 5ch.json 5件目（実況解説スレ）。`npm run pipeline`実行で`held(理由:personal_attack)`を確認。
- [x] LoL関連フィルタを通る — 全ての関連スレタイトルにLoL関連キーワード（LoL/チャンピオン名/Patch/Jungle/ADC/Yasuo/Worlds等）を含め、`npm run pipeline`で収集→フィルタ通過→生成成功を実機確認。
- [x] 強調（赤/オレンジ）— 各スレに強調キーワード（草/神/マジ/戦犯/言い訳等）を含む行を配置。新規キーワード3語を`thread-format.ts`に追加しテストで固定。実機HTMLで赤強調(`text-red-600`)・オレンジ強調(`text-orange-600`, `>>N`アンカー)が正しく描画されることを確認。
- [x] ロジック変更は最小限（強調キーワード追加のみ、パーサ/生成/表示/モデレーションの本体ロジックは無変更）。
- [x] テストGreen・ビルド成功 — 下記参照。

## アプリの起動方法
- 依存インストール: `npm install`（既にインストール済みなら不要）
- DB初期化＋シード投入: `npm run db:seed`
- 生成パイプライン実行（モック収集→生成→安全フィルタ→公開）: `npm run pipeline`
- 本番ビルド＋起動: `npm run build && npm run start`（既定ポート3000、`http://localhost:3000/`）
- 開発サーバー: `npm run dev`
- テスト: `npm test`

## 既知の問題・懸念点
- 開発DB（`prisma/dev.db`）には`CollectedItem`等の収集済みアイテムがキャッシュされるため、fixture更新後に古いDBのまま`npm run pipeline`を再実行すると**古い収集済みデータが再利用され新fixtureの内容が反映されない**ことに気付いた（本作業中に実際に発生し、`npx prisma db push`でDBを作り直して解消した）。今回はこの手順で解消済みだが、今後fixtureを更新する際は同様にDBリセットが必要な点を申し送りとして記載する（`db:seed`はArticle系テーブルのみクリアし、CollectedItem/SourceFetchLog等はクリアしない仕様のため）。
- `npm run pipeline`は1回の実行で公開本数上限（既定5本）までしか生成しないため、収集された8候補のうち一部（例: 5ch#1のADC/サポート議論スレ、reddit#1のジャングルナーフ議論スレ）は初回実行では未生成のまま残った（既存の仕様・本スプリントで変更していない挙動）。再実行間隔（既定4時間）を空けて`npm run pipeline`をもう一度実行すれば残りの候補も処理される。実機確認では、少なくとも1件（バロン視界議論スレ、12レス）が公開され、>>N アンカー・赤/オレンジ強調・出典・転載注記・非公認ディスクレーマー・広告枠が正しく表示されることを確認済み。

## 追加したテスト
- `src/lib/__tests__/generation-thread-format.test.ts`: `computeLineEmphasis`が新規追加した議論系キーワード（戦犯/言い訳/論破）を赤強調することを検証する1件を追加。

## テスト結果
- `npm test`: 28ファイル / **183件 全てPASS**（既存182件+新規1件）。
- `npx tsc --noEmit`: エラーなし。
- `npm run lint`: エラー0、warning1（既存の未使用引数の警告、本スプリントの変更とは無関係、既存コードのまま）。
- `npm run build`: 成功（Next.js本番ビルド、全ルート正常生成）。

## 実機確認結果
- `prisma/dev.db`を作り直し（`npx prisma db push`）→`npm run db:seed`→`npm run pipeline`（収集=9・候補=8・生成成功=5・生成失敗=0・公開=4・保留=1）→`npm run build && npm run start`で起動しcurlでHTML確認:
  - パイプライン生成記事「バロン視界議論スレ」（reddit由来、gen-*スラッグ）: 「反応まとめ」見出し＋12件のreactionブロックが1〜12まで連番で表示。res2/4/6/8/10/12に`>>N`アンカー（オレンジ強調）、議論の発端→反論→役割間の責任論→暫定結論（「視界不足が一番の敗因」）まで一部始終が読み取れる構成を確認。転載/AI自動編集注記・Riot非公認ディスクレーマー・出典リンク（Reddit）・広告枠(`article-top`/`article-in-body`/`article-bottom`)が全て表示されることを確認。
  - シード記事`5ch-yasuo-otp-densetsu-no-play`: 9件のreactionブロックが正しく表示、赤/オレンジ強調・アンカーも意図通り。
  - パイプライン生成された「実況解説スレ」（held）はトップページに表示されず、直接URLアクセスで404になることを確認（非公開）。`/admin`ダッシュボードでは`personal_attack`理由と検出詳細（「田中さん」+「無能」の共起）が表示されることを確認。
  - NGワード（NG_WORDS一覧）が意図した保留デモ以外のfixture/seedに混入していないことをスクリプトで機械的に確認済み（0件）。「無能」（ATTACK_WORDS）は保留デモ1箇所にのみ存在することを確認済み。
- 自己確認用サーバーは確認後に`taskkill`で停止済み（ポート3000は解放済み）。

## 前回フィードバックへの対応
該当なし（フィードバックの引き継ぎなし、ユーザーからの新規要望への対応）。

## 関連ドキュメント
- [[reformat-matome2-selfeval]]（直前の関連作業: 記事構成微修正）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
