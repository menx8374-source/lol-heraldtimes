---
tags: [sprint-selfeval]
sprint: admincms-S2
---

# admincms-S2 自己評価レポート

## 実装した内容
- **URLパース純関数**（`src/lib/admin/manual-article-url.ts`）: `parseManualArticleUrl(input)` が
  `{source:"reddit"|"x", externalId, normalizedUrl} | {error:"unsupported"|"invalid"}` を返す。
  ホストホワイトリスト（reddit=reddit.com/www.reddit.com/old.reddit.com、x=x.com/twitter.com/www.x.com/mobile.twitter.com）。
  クエリ・末尾スラッシュ・大文字小文字を無視して同一externalId/normalizedUrlに正規化。非http(s)スキーム
  （`javascript:`等）・非URL文字列・空文字は`invalid`、対応ホストだがパス形式不一致は`unsupported`。
- **単発取得**（`src/lib/admin/manual-article-fetch.ts`）: 既存アダプタの純関数（`buildPostsByIdsUrl`/
  `buildCommentsSearchUrl`/`buildRedditThreadDump`/`selectTopComments`/`extractRedditImageUrl`＝reddit.ts、
  `fetchTopReplies`/`buildTweetTitle`＝x.ts）を再利用し、HTTPステータス別（404/401·403/429/その他/通信断）に
  区別した日本語エラーメッセージを組み立てる専用fetchラッパーを新設（既存の`fetchJsonSafe`はステータスを
  握りつぶすためここだけ専用実装）。X投稿の単体取得は`GET /twitter/tweets?tweet_ids=`（公式Twitter API v2の
  `GET /2/tweets?ids=`と同様のREST慣習を想定、レスポンス形は`advanced_search`と同じ`{tweets:[...]}`と仮定）。
  コメント/リプライ取得のみの失敗は補助データ欠落として扱いOP/tweet単体で続行（本体を止めない）。
- **生成→保存**（`src/lib/admin/manual-article.ts`）: `createManualArticleFromUrl(rawUrl, auth, llmClient?)`。
  二重防止（`Post.@@unique([sourceType,externalId])`で既存Articleがあれば再フェッチせず導線を返す）→
  単発取得→既存`persistPosts`でPost永続化→既存`generateArticleForCandidate`で生成（Hotness評価は一切呼ばない）
  →既存`moderateArticleContent`→NG不通過は`status="held"`（理由付き）、通過時は常に`status="review"`
  （カテゴリ公開ポリシーは参照しない）→`Article`作成（`postId`紐付け）。同時多重実行によるP2002衝突は
  捕捉して既存記事への導線にフォールバック。
- **UI**（`src/app/admin/ManualArticlePanel.tsx`＋`src/app/admin/actions.ts`の`manualArticleAction`＋
  `src/app/admin/page.tsx`）: `/admin`に「指定URLから記事化」パネルを追加。`useActionState`（React19）で
  実行中はボタン・入力欄を無効化し「実行中...」表示（連打二重防止）、完了後は成功/失敗メッセージと
  成功時のプレビュー/編集リンクを表示。X_API_KEY未設定時はX URL実行前に弾き、同じ操作でReddit URLは
  正常動作する（既存のRedditアダプタはキー不要）。

## 技術選定（該当する場合のみ）
- 新規npm依存なし。architecture.mdのベースライン（Next.js/Prisma/SQLite/Vitest）は不変。
- X単一tweet取得エンドポイント（`GET /twitter/tweets?tweet_ids=`）はGetXAPIの公式ドキュメント未参照で
  「公式Twitter API v2 `GET /2/tweets?ids=`と同じREST慣習・`advanced_search`と同じレスポンス形」という
  設計上の仮定に基づく（下記懸念点に明記）。
- スキーマ変更なし（既存`Post.@@unique([sourceType,externalId])`・`Article.postId@unique`のみで二重防止が
  成立するため、brief指示どおりmigrationを追加しなかった）。

## 受け入れ基準チェック（自己申告）
- [x] `/admin`に「指定URLから記事化」パネル（URL入力欄・実行ボタン・対応URL形式の説明）: 実機確認済み
  （`curl`でHTML内に`指定URLから記事化`・`data-manual-url-input`・`data-manual-submit`を確認）。
- [ ] Redditスレッド URLで実行→実行中表示→「記事を作成しました」+プレビュー/編集導線: ロジック（
  `createManualArticleFromUrl`）はDB結合テストで検証済み。ブラウザでの実クリック（`useActionState`の
  pending表示・結果表示）は**未検証**（Playwright実機操作はevaluator側を推奨、下記懸念点参照）。
- [x] 作成記事はレビューキューに現れ公開一覧・検索に出ない: `status="review"`で作成しS1の
  `review-status-exclusion.test.ts`（既存・本スプリントで変更なし）の不変条件をそのまま利用。
  DB結合テストでも`article.status==="review"`を確認。
- [x] プレビューでカテゴリ「海外の反応」・元スレ情報ブロック・コメント由来レスブロック・出典URL:
  `manual-article.test.ts`でカテゴリ・出典URL・本文非空を確認（プレビュー画面自体はS1既存機能を再利用の
  ため構造は不変。ブラウザでの目視は未実施）。
- [x] `old.reddit.com`＋末尾スラッシュ無し・`utm_source`等クエリ付きでも同一スレとして取得・作成:
  `manual-article-url.test.ts`（正規化）＋`manual-article.test.ts`（二重防止テストで異形URL2回投入）で確認。
- [x] スコア/コメント数が低いスレッドでもHotness判定で弾かれず記事化: `manual-article.ts`はHotness評価
  （`evaluateHotness`）を一切importしておらず経路自体が通らない。テストでもscore=1/comments=1で作成成功を確認。
- [x] X投稿URLで実行→記事作成、カテゴリ「Xの反応」・元ポスト情報・返信/引用由来レスブロック・出典URL:
  DB結合テストで確認（`manual-article.test.ts`）。ブラウザ目視は未実施。
- [x] `twitter.com`+`?s=20`でも同一投稿として取得: `manual-article-url.test.ts`で正規化確認。
- [x] 返信0件のX投稿でも本文が空にならない: テストで`xReplies=[]`かつ`body.length>0`を確認
  （composeXBodyの見出し「Xでの反応」が必ず入るため）。
- [x] X_API_KEY未設定時は「X の API キーが未設定のため利用できません」相当のメッセージ・記事非作成、
  同画面でReddit URLは正常動作: `manual-article.test.ts`で両方確認（fetchをspyし呼ばれないことも確認）。
- [x] 対応しないホスト（example.com）は「この URL 形式には対応していません」・件数増えない: 確認済み。
- [x] 空文字・非URL文字列（`abc`）は入力エラー・記事非作成: 確認済み。
- [x] 存在しない/削除済みのReddit/X投稿は日本語エラー・空/欠落記事が増えない: `manual-article-fetch.test.ts`
  （404・data空の両パターン）＋`manual-article.test.ts`（reddit data空でPost/Article数0を確認）。
- [x] レート制限・認証エラーで理由が分かる日本語メッセージ・記事非作成: `manual-article-fetch.test.ts`で
  401/403/429を個別に確認（メッセージに「認証」「レート制限」を含むことを検証）。
- [x] 記事化済みURL再投入で二重作成されず「この URL は記事化済みです」+既存記事導線:
  `manual-article.test.ts`で同一投稿の異形URL2回投入→Post/Article各1件・同一articleIdを確認。
- [ ] 実行ボタン連打で二重作成されない（実行中は無効化）: UI側は`useActionState`の`isPending`で
  ボタン・入力欄を`disabled`にする実装済みだが、**ブラウザでの実クリック連打までは未検証**
  （ライブラリ関数側の二重防止＝P2002衝突フォールバックはコードレビューベースで安全側に倒しているが
  結合テストでの意図的な同時実行までは行っていない）。
- [x] 手動記事化も安全フィルタを通り、NGワード含有はheld＋理由付きで保留キューに入る:
  `manual-article.test.ts`のNGワードテスト（X経由、tweet本文にNGワード）で`status==="held"`・
  `heldReason==="ng_word"`を確認。
- [x] 手動記事化実行後も自動収集パイプラインの動作・実行ログは壊れない: 手動記事化は独立した新規
  ファイル（`manual-article*.ts`）のみで実装し、`pipeline.ts`/`post-pipeline.ts`/収集アダプタ本体は
  一切変更していない。既存の該当テスト（`generation-post-pipeline*.test.ts`等）を含む全1949件が
  引き続きGreen。

## アプリの起動方法
```bash
npm install
npx prisma generate   # 初回のみ（postinstallで自動実行済みのはず）
ADMIN_USER=<任意> ADMIN_PASSWORD=<任意> npm run build && npm run start   # または npm run dev
```
- `/admin` はBasic認証必須（未設定時は保護のため503）。
- パネルは `/admin` トップの「指定URLから記事化」セクション。
- テスト: `npx vitest run`（142ファイル・1949件、全Green。本スプリントで+3ファイル・+31テスト追加）
- 型チェック: `npx tsc --noEmit`（エラー0）／ Lint: `npm run lint`（既存の警告7件のみ、新規警告なし）／
  ビルド: `npm run build`（成功）

## 既知の問題・懸念点
- **X単一tweet取得エンドポイントの仕様が未確認**: GetXAPIは`advanced_search`（検索）の利用実績はあるが、
  「tweet id 1件を直接取得する」専用エンドポイントの公式ドキュメントは本スプリントでは参照できなかった。
  `GET /twitter/tweets?tweet_ids=<id>`（公式Twitter API v2の`GET /2/tweets?ids=`と同じREST慣習、
  レスポンス形は`advanced_search`と同じ`{tweets:[...]}`）という設計仮定で実装した。テストはHTTPレイヤーを
  スタブしているため仮定の妥当性は検証できておらず、実際のGetXAPI契約と食い違う場合は本番投入前に
  実APIへの疎通確認（または正しいエンドポイント仕様の確認）が必要。X_API_KEY未設定時（既定・無課金）は
  この経路自体が実行されないため、鍵を設定しない限りコスト・破損リスクは発生しない。
- **ブラウザでの実クリック操作は未検証**: `useActionState`によるパネルのpending表示・結果表示・連打時の
  二重防止は実装レベル・DB結合テストでは検証済みだが、Next.js Server Actionsの内部エンコーディングの
  都合で`curl`による素朴な模擬に向かず、実際のブラウザクリックまでは確認していない（S1selfevalと同じ
  制約）。evaluatorのPlaywright実機操作での最終確認を推奨。
- Reddit投稿本体は取得できたがコメント取得のみ失敗した場合はOP単体（コメント0件）で記事化を続行する
  仕様にした（brief記載の「返信0件でも本文が空にならない」はXの受け入れ基準だが、対称性のため補助データ
  欠落時に本体を止めない方針をRedditにも適用。既存コードにも同種の「1件の失敗が全体を止めない」方針が
  一貫している）。

## 追加したテスト
- `src/lib/__tests__/manual-article-url.test.ts`（12件）: 対応/非対応ホスト・クエリ/末尾スラッシュ/大小文字の
  同一化・非URL文字列/危険スキーム拒否。
- `src/lib/__tests__/manual-article-fetch.test.ts`（12件）: Reddit/X単発取得の成功・404/データ空・401/403・429・
  コメント取得のみ失敗時のOP単体続行・X_API_KEY未設定時の未通信拒否。
- `src/lib/__tests__/manual-article.test.ts`（8件、DB結合）: 未認証拒否・入力エラー/非対応ホスト・
  Hotness迂回（低score/低comment数でも作成）・二重防止（異形URL2回投入で1件のまま）・取得失敗時の非作成・
  X_API_KEY未設定時の拒否＋同画面でReddit正常動作・X経由作成（返信0件で本文非空含む）・NGワードheld。

## 関連ドキュメント
- [[admincms-s2-brief]]（本スプリントの仕様抜粋）
- [[admin-cms-v2-spec]]（製品仕様書）
