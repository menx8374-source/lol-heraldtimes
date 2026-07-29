---
tags: [sprint-selfeval]
sprint: pbe-s4
---

# PBE-S4 自己評価レポート

## 実装した内容
- `src/lib/generation/pbe-compose.ts`（新規・純関数）: PBE-S1/PBE-S2の`toArticleBodyPatchChangeBlock`変換済みブロックを受け取り、1本のPBE記事本文（`ArticleBodyBlock[]`）を組み立てる。
  - 先頭「未確定バッジ」段落 → 冒頭サマリ（数値集計の純テンプレ）→ 目次(toc) → チャンピオンの変更（direction別3グループ: 主な強化/主な弱体化/その他の調整、既存パッチ記事と同じ振り分け）→ アイテムの変更（direction固定"adjust"のため単一章）→「スキル詳細は公式で」明示 → 出典（「データ: CommunityDragon / Riot Games」＋CDragonへのlinkButton）。
  - `buildPbeArticleTitle`（F-PBE4-3、ルール生成タイトル）・`extractPbeVersionLabel`（CDragon生バージョン→表示ラベル）も同モジュールに実装。
  - 入力ブロックの中身は一切書き換えず、逐語のまま並べるだけ（捏造なし）。
- `src/lib/generation/pbe-article.ts`（新規）: `PBE_ARTICLE_MODE`（既定off）のopt-in配線（F-PBE4-2）。
  - offでは`isPbeArticleModeEnabled()`が即falseを返し、`runPbeArticleGeneration`は即`{status:"disabled"}`でDB・外部APIに一切アクセスしない。
  - onのとき: `fetchCDragonVersions`でpbe/latestを取得 → 一致（差分なし）または取得失敗なら即return（items/champions取得への負荷を避ける）→ 差分ありのときのみitems/champions取得→diff→本文組み立て→moderation→DB反映。
  - 一意化: `Post.sourceType="riot"`＋`externalId="pbe-<バージョン>"`の複合ユニークキーでPostをupsertし、`Article.postId`（@unique）でArticleをin-place更新（既存の記事更新機構と同方針）。カテゴリは既存「パッチ/メタ」を流用（新設カテゴリなし）。
  - hotness判定を経ず生成（`monitoring:false`で監視対象からも除外）。moderation（NG/出典/中傷）不通過なら記事化しない。
  - 1回の失敗（fetch/生成/DB）は例外を投げず握り潰して`{status:"fetch_failed"}`を返す。
- `scripts/pbe-article.ts`（新規）＋`package.json`に`"pbe-article"`スクリプト追加。`confirm-patch-preview.ts`と同じ運用パターン（1回実行・cron常駐は対象外）。
- `.env.example`・`README.md`に`PBE_ARTICLE_MODE`の説明を追記（既定off・opt-in・回帰ゼロを明記）。

## 技術選定
- 新規npm依存は追加していない（brief制約どおり）。既存の`prisma`（DB）・`moderateArticleContent`（安全フィルタ）・`bodyBlocksToText`（検索/本文テキスト化）をそのまま流用。
- カテゴリは既存「パッチ/メタ」を再利用（brief「既存カテゴリ流用が簡単なら流用可」を採用。新設カテゴリを増やすとカテゴリ一覧ページ・スラッグ等への波及があり、今スプリントのスコープ外のため）。
- Post.sourceTypeも既存の"riot"を再利用（CDragonは公式ゲームデータそのもので、Riot公式扱いのriotソースと同種）。新規sourceType追加なし。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run`全Green（1551テスト）・`npx tsc --noEmit`エラー0・`npm run build`成功・`npm run lint`エラー0（既存の警告6件のみ、いずれも今回の変更と無関係な既存コード由来）。
- [x] `PBE_ARTICLE_MODE=on`かつpbe≠latestで、CDragon自動分（チャンピオン基本/cost/cooldown＋アイテム）のPBE先行記事が、未確定バッジ・出典・LoL公式風デザイン（`patchChange`ブロックを含むため`ArticleBodyView`が自動で`[data-lol-patch]`スコープを適用）で生成/上書きされることを結合テスト（`generation-pbe-article.test.ts`）で確認。スキル効果量は本文のstat集合を既知ラベルのみに限定するテストで担保し、載らないことを確認。`off`/未設定では`isPbeArticleModeEnabled()`が即falseを返しDB・外部APIに一切アクセスしないことをテストで確認（回帰ゼロ・追加コストなし）。
- [x] AI不使用（compose/title/summaryは全て純テンプレ・ルール生成、LLMクライアント未使用）・逐語維持（入力ブロックをそのまま並べるのみ）・捏造なし（未確定バッジ明示）・DBスキーマ変更なし（新規モデル・列とも追加していない。既存Post/Article/ArticleSourceのみ使用）・新規npm依存なし・X収集は含まない（pbe-article.tsはCDragon fetchのみでX関連import一切なし）。

## アプリの起動方法
- 通常起動: `npm run dev`（http://localhost:3000）。`PBE_ARTICLE_MODE`未設定で従来どおり。
- PBE記事の生成/更新チェック（opt-in・単独実行）: `.env`に`PBE_ARTICLE_MODE=on`を設定後、`npm run pbe-article`（実HTTPで`raw.communitydragon.org`へ接続するため、実際にpbe≠latestの状況でないと`{status:"no_diff"}`になる）。
- テスト: `npx vitest run`（全体）／`npx vitest run src/lib/__tests__/generation-pbe-compose.test.ts src/lib/__tests__/generation-pbe-article.test.ts`（本スプリント分のみ）。
- 型チェック: `npx tsc --noEmit`。ビルド: `npm run build`。lint: `npm run lint`。

## 既知の問題・懸念点
- `npm run pbe-article`の実運用（実際にCDragonへ接続してのPBE記事生成）は今回未検証（テストは固定フィクスチャでfetchをスタブしており、実HTTP接続は行っていない。ブリーフの「実HTTPを叩かない・固定フィクスチャ」要件どおり）。実際の本番稼働時にpbe側のchampion-summary/champions/binデータ構造が変わっていないかは、PBE-S1/S2で実測済みの前提を踏襲している。
- CDragon出典リンクは`https://www.communitydragon.org/`（トップページ）を固定使用。PBE専用の人間可読ページURLが確認できなかったため、汎用サイトへのリンクにとどめている（機能上の問題はない）。
- cron常駐・定期実行の登録自体は本スプリントの対象外（既存`confirm-patch-preview`と同様、1回実行のみを実装）。
- サーバー・バックグラウンドプロセスは起動していない（build/lint/tsc/vitestはいずれもワンショット実行、確認後に残存プロセスなし）。

## 追加したテスト
- `src/lib/__tests__/generation-pbe-compose.test.ts`（12テスト）: バッジ・冒頭サマリの位置と内容、チャンピオン3グループ振り分け、アイテム単一章、既知stat集合限定（スキル効果量が本文に出ないことの担保）、出典・linkButton、toc整合、0件時の非クラッシュ、`parseArticleBody`検証通過、タイトル生成、バージョンラベル抽出。
- `src/lib/__tests__/generation-pbe-article.test.ts`（6テスト・実DB結合テスト、実HTTP不使用でfetchをスタブ）: 未設定/off時に`fetch`もDBアクセスも一切発生しない（回帰ゼロ）こと、pbe==latestで即returnしitems/champion-summaryへ到達しないこと、バージョン取得失敗で何もしないこと、on＆差分ありで未確定バッジ・出典付きPBE記事が新規作成されること、同一pbeバージョンの再実行で記事が重複せずin-place上書き更新されること（`externalId="pbe-<ver>"`一意化）。

## 関連ドキュメント
- [[pbe-s4-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
