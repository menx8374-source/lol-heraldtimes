# PBE-S3 — X収集の取得層（GetXAPI・Spideraxe/Phroxzon）＋出典データ（mock先行）

`docs/pbe-research.md` §1.2・§2・§4。PBEの方向性・変更意図・（画像内の）スキル数値を、データマイナー Spideraxe（@Spideraxe30）と
Riot開発Lead Phroxzon（@RiotPhroxzon）のXから**出典付きで取得**する。数値の主はCDragon（S1/S2）、Xは文脈・方向性・スキル数値(画像)・出典の補完。**AI不使用**。対象: Web（取得層）。

## 背景
- ユーザーが「PBEでスキルのダメージ・レシオも出す」ためにX収集を有効化する方針を選択（コストは opt-in＋レート制限＋PBE窓限定で月数十円〜$1未満）。
- **Xのスキル数値は画像（インフォグラフィック）が多く自動抽出は非現実的**。よって本スプリントは「ツイートを出典データとして取得し、テキスト・画像URL・作者・URLを逐語保持」する層に徹する。OCR・数値再構成はしない（AI不使用＋誤情報回避）。画像内数値の取り込みは PBE-S5 の埋め込み表示＋人手キュレーションに委ねる。
- 取得は G7 の GetXAPI（`X_API_KEY`）を流用。キー未設定時は mock（fixture）で動く。

## 含まれる機能
- **F-PBE3-1** 新規 `pbe-x-source.ts`: 特定アカウントのPBE関連ツイートを取得（クエリ例 `(from:Spideraxe30 OR from:RiotPhroxzon) (PBE OR patch OR パッチ) -filter:retweets`、env `PBE_X_QUERIES` で上書き可）。G7の `x.ts` のGetXAPIクライアント/認証/変換を流用（重複実装しない）。X_API_KEY設定時のみ live、未設定は mock。失敗は空配列。
- **F-PBE3-2** `PbeSourceTweet`（author/authorHandle/text逐語/url/createdAt/mediaUrls/direction?）を返す。text は逐語保持（要約・数値抽出・OCR・改変しない）。**mediaUrls にツイート画像URLを必ず保持**（PBE-S5で埋め込む）。direction は強化/弱体等のキーワードがあれば軽くタグ付け（数値の抽出・解釈はしない）。
- **F-PBE3-3** 取得層＋出典データ＋mock＋テストのみ。記事化・埋め込み・opt-in env・人手キュレーションは PBE-S5。既存 compose/pipeline/表示は変更しない（影響ゼロ）。

## 制約・非目標
- AIは使わない。逐語維持・捏造禁止（数値を作らない・OCRしない）。数値の主はCDragon、Xは未確定・出典付き引用。DBスキーマ変更なし・新規依存なし。X_API_KEYはenv。G7の x.ts を流用し重複実装を避ける。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. GetXAPI（G7流用）で Spideraxe/Phroxzon のPBE関連ツイートを出典データ（逐語text・画像URL・作者・URL）として取得、mock/live切替。数値解釈・OCRはしない。
3. AI不使用・逐語維持・DBスキーマ変更なし・新規依存なし・既存挙動に影響ゼロ・G7流用で重複実装なし。
