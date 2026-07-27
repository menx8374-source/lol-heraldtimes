---
tags: [sprint-selfeval]
sprint: S6
---

# リファクタリング S6 自己評価レポート

## 実装した内容
- F-S6-1: `src/lib/hotness/config.ts` に `ArticleUpdateConfig`/`getArticleUpdateConfig()` を追加（`updateMinScoreDelta`[100]/`updateMinCommentDelta`[30]/`updateCooldownHours`[6]/`updateMaxCount`[2]/`updateMaxAgeHours`[48]、env上書き可）。
- F-S6-1: `src/lib/hotness/update-trigger.ts`（新規）に純関数 `shouldUpdateArticle(input, now, config)` と baseline算出用 `resolveBaselineMetrics(metricsHistory, lastUpdatedAt)` を実装。AI不使用・DB非依存。5chはscore常時0のため自然にコメント増加量のみで判定される（config分岐不要）。
- F-S6-2: `SourceAdapter` に任意 `fetchContent?(externalId)` を追加（`src/lib/collection/types.ts`）。
  - `RedditAdapter.fetchContent`: `posts/ids`で投稿本体を再取得→既存の`fetchComments`/`selectTopComments`/`buildRedditThreadDump`を再利用してダンプを作り直す。
  - `FiveChAdapter.fetchContent`: dat再取得→既存`buildThreadDumpFromDat`でダンプ再構築。タイトルはsubject.txt（既存キャッシュ）優先、無ければdat1行目埋め込みタイトル（新規 `extractDatThreadTitle`）にフォールバック。
  - riotは非対応（未実装のまま、免除ソースのため対象外）。
- F-S6-3: `src/lib/generation/article-updater.ts`（新規）に `updateHotArticles(options)` を実装。articleが紐付き＋monitoring=trueかつ非免除ソースのPostを対象に、`PostMetricsHistory`＋`ArticleUpdateHistory`からbaseline/updateCount/lastUpdatedAtを求めて`shouldUpdateArticle`判定→トリガ時のみ`fetchContent`→`generateArticleForCandidate`→`moderateArticleContent`（重複判定は自己重複誤検出を避けるため適用しない、NG/出典/中傷は適用）→通過時のみArticleをin-place更新＋`ArticleUpdateHistory`追記。maxPostsPerRun有界・sleep/delayMs注入・直列・1件失敗は握り潰して継続・全体としても例外を投げない。
- `scripts/update-articles.ts`（新規）＋`package.json`に`update-articles`スクリプト追加。
- `.env.example`・`README.md`を新規env（`UPDATE_MIN_SCORE_DELTA`等7個）と起動コマンドで更新。

## 技術選定
- 新規依存なし（要件どおり）。baseline算出はArticleUpdateHistoryにスコア列を追加せず、既存`PostMetricsHistory`の時系列から`lastUpdatedAt`以前の直近スナップショットを逆引きする方式にした（DBスキーマ変更をしない制約を満たすため）。
- 更新経路のmoderationは重複(duplicate)判定を意図的に外した。既存公開記事プールとの比較は「更新対象記事自身の伸びる前の内容」を自己重複と誤検出し、正当な更新を全てheldにしてしまうリスクがあるため（NGワード・出典欠落・個人中傷は従来どおり適用）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（1054件、新規42件超含む）。
- [x] 基準2: `npx tsc --noEmit`・`npm run build`・`npm run lint` いずれも通過（lint警告は全て既存分、新規追加分の警告0件）。
- [x] 基準3: DB結合テスト（`generation-article-updater.test.ts`）でScore大幅増/コメント急増のPostのみがcooldown・updateMaxCountを守って再AI更新されArticleUpdateHistoryに記録されること、非トリガ・riot（免除）・cooldown中・updateMaxCount到達はskipされること、moderation不通過は更新されないこと、slug/id/postId/publishedAtが不変であること、新規依存が無いこと、1件失敗しても継続し例外を投げないことを確認。

## アプリの起動方法
- テスト: `npx vitest run`
- 型検査: `npx tsc --noEmit`
- ビルド確認: `npm run build`
- Lint: `npm run lint`
- 記事更新チェックの単独実行（本スプリントの機能）: `npm run update-articles`（`scripts/update-articles.ts`。DBに articleが紐付いた監視中Postが必要。ローカルではmockアダプタ既定のため`fetchContent`未実装＝実質skipになる。live収集(`COLLECTION_MODE=live`)＋実データ蓄積後に効果を確認できる）
- 自己確認は上記コマンドのみで、常駐サーバーの起動は行っていない（停止対象のプロセスなし）。

## 既知の問題・懸念点
- `updateHotArticles`の実運用確認（`npm run update-articles`を実データに対して実行しての目視確認）は本スプリントでは未実施（DB結合テストによる検証のみ）。cron常駐設定は仕様どおり対象外。
- 5chの`fetchContent`のタイトル復元はsubject.txt再取得（既存`fetchMetrics`と同じキャッシュ機構）を優先し、取得失敗時のみdat埋め込みタイトルにフォールバックする設計にした。ブリーフには「dat再取得」としか明記が無いため、この追加のsubject.txt参照は実装判断（既存ロジック再利用の範囲、新規依存や新規ネットワーク先の追加ではない）。
- update-articles経路のmoderationから重複(duplicate)判定を除外したのは実装判断（自己重複誤検出の回避）。ブリーフの制約（moderation方針には触れない）には抵触しないよう、NGワード/出典欠落/個人中傷は従来どおり適用している。

## 追加したテスト
- `src/lib/__tests__/hotness-config.test.ts`: `getArticleUpdateConfig`の既定値・env上書き・不正値フォールバック。
- `src/lib/__tests__/hotness-update-trigger.test.ts`（新規）: `shouldUpdateArticle`のdelta/cooldown/updateMaxCount/updateMaxAge/5chコメントのみ判定/reason優先順位、`resolveBaselineMetrics`のbaseline算出。
- `src/lib/__tests__/collection-reddit.test.ts`: `RedditAdapter.fetchContent`（正常系・投稿無し・HTTPエラー・ネットワーク断）。
- `src/lib/__tests__/collection-fivech.test.ts`: `extractDatThreadTitle`純関数、`FiveChAdapter.fetchContent`（正常系・subject失敗時フォールバック・externalId不正・dat取得失敗・空dat）。
- `src/lib/__tests__/generation-article-updater.test.ts`（新規、DB結合）: トリガ更新(score_surge/comment_surge)・in-place更新(slug/id/postId/publishedAt不変)・履歴追記、非トリガ/riot免除/cooldown/updateMaxCountのskip、moderation不通過、fetchContent失敗/未対応、1件失敗時の継続、maxPostsPerRun有界、sleep注入、対象0件・monitoring=false・adapters省略時の正常終了。

## 関連ドキュメント
- [[sprint-refactor-s6-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
