---
tags: [sprint-selfeval]
sprint: pbe-s5
---

# PBE-S5 自己評価レポート

## 実装した内容
- F-PBE5-1: `pbe-article.ts` に `maybeFetchPbeXTweets()` を追加。`X_API_KEY`（env/`options.apiKey`）が未設定なら**そもそも呼ばない**（CDragon自動分のみ・$0）。設定時も前回X取得から `PBE_X_MIN_INTERVAL_HOURS`（既定6h）未満ならスキップ。呼び出しはpbe≠latest・差分ありが確定した経路でのみ到達（既存の早期returnをそのまま利用）。
- 前回X取得時刻の保持は新規 `src/lib/generation/pbe-x-rate-limit.ts`（DBスキーマ変更なし、`data/pbe-x-last-fetch.json` へのファイルベース簡易状態保存。読み書き失敗は例外を投げず安全側にフォールバック）。
- F-PBE5-2: `pbe-compose.ts` に「PBEのスキル変更（データマイナー情報・未確定）」セクションを追加。有効なtweet status URL（`isValidTweetStatusUrl`）は公式oEmbed埋め込み（`embed`ブロック、G7/E22流用）、そうでなければ短い引用（逐語text）＋画像（mediaUrls）＋出典（作者ハンドル・URL）。冒頭に未確定注記。件数上限 `PBE_X_MAX_TWEETS`（既定6、`maxTweets`オプションでも上書き可）。`tweets`/`curationNotes` いずれも未指定/空なら従来どおりセクション自体を出さない（回帰ゼロ）。
- F-PBE5-3: 新規 `src/lib/generation/pbe-curation.ts`。`data/pbe-curation.json`（任意・gitignore対象）が存在すれば逐語で差し込み、無ければ何もしない。`patch`フィールドが現在のPBEバージョンと異なる場合は空扱い（別パッチへの誤混入防止）。管理UIは作らない。
- F-PBE5-4: タイトルは既存「【PBE先行】…（テストサーバー・随時更新）」の範囲のまま（変更なし、brief許容範囲）。
- `moderateArticleContent` は既存どおり本文全体（`bodyBlocksToText(body)`）を検査するため、X/キュレーションの逐語テキストも自動的にNG語・個人攻撃チェックの対象になる（追加配線不要）。
- `.env.example` に `PBE_X_MIN_INTERVAL_HOURS`/`PBE_X_MAX_TWEETS` のキー名と説明を追記。`.gitignore` に `data/`（実行時状態・任意キュレーションファイル）を追加。
- `docs/spec/lol-matome-sokuhou-architecture.md` に「PBE記事のXレート制限状態」の決定（ファイルベース・DBスキーマ変更なしの理由）を簡潔に追記。

## 技術選定
- Xレート制限の「前回取得時刻」保持: DBスキーマ変更禁止の制約下、プロジェクトローカルJSONファイル（`data/pbe-x-last-fetch.json`）を採用。理由: (a) 実行環境=VPS常駐cronで永続ディスク前提のためファイルI/Oで十分。(b) 運用コスト$0（新規依存・新規インフラなし）。読み書き失敗は「前回取得なし」扱いの安全側フォールバック。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1607件）・`tsc --noEmit` エラー0・`npm run build` 成功・`npm run lint` エラー0（既存の無関係な警告6件のみ、Critical/Highなし）。
- [x] `PBE_ARTICLE_MODE=on`＋`X_API_KEY`相当（テストでは`apiKey`オプション注入）＋pbe≠latestで、PBE記事にCDragon確定分＋ツイート埋め込み（未確定・出典付き）が出ることを結合テストで確認。off/キー無しではCDragonのみ・fetchTweetsを呼ばない（追加コスト0）ことも確認。
- [x] AI不使用・逐語維持・捏造なし（未確定・出典明示）・コスト安全設計（PBE窓＋キー＋レート制限）・DBスキーマ変更なし（`prisma/schema.prisma`未変更）・新規npm依存なし（`package.json`未変更、`node:fs`/`node:path`のみ）・既存経路不変（G7 X経路・collection/generationの他テストは無改変で全Green）。

## アプリの起動方法
- テスト: `npx vitest run`（プロジェクトルートで実行、DB自動セットアップ済み）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`（Next.js/Turbopack）
- Lint: `npm run lint`
- 単独実行スクリプト（変更なし、既存のまま）: `PBE_ARTICLE_MODE=on` 設定後 `npm run pbe-article`（`scripts/pbe-article.ts`）。X統合を有効化するには追加で `X_API_KEY` を設定する（未設定ならCDragon自動分のみで従来どおり動作）。
- 本スプリントはUIを持たないため、`npm run dev`でのブラウザ起動確認は対象外（既存パイプライン系スプリントと同じ方針）。

## 既知の問題・懸念点
- レート制限の状態ファイル（`data/pbe-x-last-fetch.json`）はVPSローカルファイルシステム前提。マルチインスタンス/コンテナで実行環境が使い捨てになる場合は状態が引き継がれない（1回目は必ず取得される）が、brief通り「無ければ簡易に最小実装」の範囲内と判断。
- 人手キュレーションファイル（`data/pbe-curation.json`）は運営者がVPS上で直接編集する前提（管理UIなし、brief許容）。ファイル書き込み手順自体は本スプリントの対象外。
- `X_API_KEY`本接続時の実際の課金・レスポンス形式は既存PBE-S3の`fetchPbeSourceTweets`実装に依存（本スプリントでは実HTTPを叩かず、`options.fetchTweets`注入によるfixture相当のテストのみ。実API疎通は未検証）。

## 追加したテスト（任意）
- `src/lib/__tests__/generation-pbe-x-rate-limit.test.ts`（新規）: `isPbeXRateLimited`純関数・`getPbeXMinIntervalHours`のenvパース・`readLastPbeXFetchAt`/`writeLastPbeXFetchAt`のファイルI/O往復/異常系（存在しない/壊れたJSON/親ディレクトリ自動作成/書き込み不能パス）。
- `src/lib/__tests__/generation-pbe-curation.test.ts`（新規）: ファイル無し/壊れたJSON/正常読み込み/patch不一致時の空配列/patch未設定時の常時適用/不正要素の除外/notes非配列時の空配列。
- `src/lib/__tests__/generation-pbe-compose.test.ts`（拡張）: tweets/curationNotes未指定時の回帰ゼロ、有効URLのoEmbed埋め込み、無効URLの引用＋画像＋出典フォールバック、逐語一致（機械生成/OCRしていないことの担保）、件数上限（既定/env/オプション上書き）、キュレーション統合、moderation対象になる本文結合、CDragon確定分とのセクション分離順序、`parseArticleBody`通過。
- `src/lib/__tests__/generation-pbe-article.test.ts`（拡張）: X_API_KEY未設定でfetchTweets不呼び出し、on+key+レート内で埋め込み統合＋moderation通過、非status URLの逐語+画像統合、レート制限内でのスキップ（課金抑制）、実運用同等の状態往復（1回目取得→直後2回目はスキップ）、人手キュレーションのファイルあり/なし、X取得失敗時も記事生成継続（本体を止めない）。

## 関連ドキュメント
- [[sprint-pbe-s5-brief]]（本スプリントの仕様抜粋、実ファイル名 `docs/sprints/pbe-s5-brief.md`）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
