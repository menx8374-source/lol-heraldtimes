---
tags: [sprint-selfeval]
sprint: E2
---

# Sprint E2（コメント欄）自己評価レポート

## 実装した内容
1. **データモデル**: `ArticleComment`（Prismaマイグレーション `20260725054244_add_article_comments`）。`articleId`(FK, onDelete Cascade)・`number`(記事内連番、`@@unique([articleId, number])`)・`name`・`body`・`anchors`(Json, `>>N`抽出結果)・`createdAt`・`status`(published/held)・`heldReason`。
2. **投稿API**: `POST /api/articles/[slug]/comments`（Route Handler）。ハニーポット判定→入力検証（本文必須・最大1000字、名前任意・最大30字）→連投スパム判定（同一本文10秒以内は拒否）→安全フィルタ（既存`findNgWord`/`detectPersonalAttack`を再利用）→採番・永続化（トランザクション、`aggregate(_max:number)+1`）→公開時のみ`Article.commentCount`加算。保留(held)は詳細理由を返さず穏当なメッセージのみ返す。
3. **表示**: 個別記事ページ本文下（出典の後、関連記事の前）に`<CommentSection>`（クライアントコンポーネント）。まとめ速報レス形式に統一（`article-body-view.tsx`から`ResHeader`/`ResLines`を抽出・エクスポートして再利用、既存reactionブロックの描画結果は不変）。0件時「まだコメントはありません」。見出しは「コメント (N)」。
4. **コメント数連携**: 公開時に`Article.commentCount`を実加算。記事カード（💬）・個別記事上部バッジ・コメント欄見出しがすべて同じ実データに連動。
5. **新着コメントウィジェット**: `PageWithSidebar`（トップ/カテゴリ/タグ/検索/個別記事のサイドバー共通）に`RecentCommentsWidget`を追加。全記事横断で直近5件の公開コメント（抜粋40字＋記事タイトルへのリンク＋相対時刻）を表示。対象記事は`status="published"`のみに限定。
6. **XSS対策**: コメント本文・名前は常にReact子要素として描画（`{c.body}`等）。`dangerouslySetInnerHTML`はコメント関連コードで一切未使用（grep確認済み）。実機で`<script>alert()</script>`を投稿し`&lt;script&gt;`にエスケープされ実行されないことを確認。
7. **保留コメントの非公開**: `listPublishedCommentsBySlug`/`listRecentComments`はいずれも`status="published"`のみ抽出。DBには`held`行として記録は残る（理由コードのみ、E7のモデレーション画面向け）。

## 技術選定
- 新規npm依存の追加なし。既存のNext.js Route Handler・Prisma・Vitest構成の範囲内で実装（architecture.mdのベースライン維持）。
- クライアント/サーバーの分離: `src/lib/comments.ts`（純関数・型のみ、Prisma非依存）と`src/lib/comments-db.ts`（Prisma使用、サーバー専用）に分割し、クライアントコンポーネント（`comment-section.tsx`）からは前者のみimportすることでPrismaがクライアントバンドルに混入しないようにした（`reactions.ts`/`reaction-buttons.tsx`の既存パターンを踏襲）。
- コメント投稿はRoute Handler方式を採用（Server Actionではなく、既存の絵文字リアクションAPI(`/api/articles/[slug]/reactions`)と同じfetchベースのクライアント連携パターンに揃えるため）。
- スパム対策はログイン無し方針に合わせ「ハニーポット隠しフィールド」＋「同一記事内での直前と同一本文・短時間連投の拒否」のみ（厳密なユーザー識別・IP制限等は行わない。仕様の「軽量対策でよい」に沿う判断）。

## 受け入れ基準チェック（自己申告）
- [x] コメントのデータモデル: `ArticleComment`追加・マイグレーション適用済み（`npx prisma migrate dev`で作成、`db push`によるテストDBにも反映）。連番採番はトランザクション内`aggregate(_max)+1`＋`@@unique([articleId, number])`を安全網に実装。DB結合テストで5件並行投稿しても番号が1〜5で重複しないことを確認。
- [x] コメント投稿: フォーム実装・Route Handlerでの検証/モデレーション/採番/commentCount加算をDB結合テスト11件＋Route Handlerテスト6件で検証。実機でも投稿→一覧反映→リロード後も永続化を確認。
- [x] コメント表示: レス形式（番号:名前=緑、`>>N`アンカー=オレンジ）で表示。実機HTMLで`text-green-700`（名前）・`text-orange-600`（`&gt;&gt;1`等）のクラス出現を確認。0件記事は「まだコメントはありません」（コンポーネントロジックで確認、テストはDB結合テストの範囲外だが目視コードレビュー済み）。
- [x] コメント数の連携: `commentCount`加算を実機・テスト双方で確認（投稿前後でトップページのカード💬数・個別記事バッジ・コメント欄見出しの3箇所が一致することを実機で確認）。
- [x] 新着コメントウィジェット: `PageWithSidebar`に追加、DB結合テストで「公開記事の公開コメントのみ・新しい順」を確認。実機でトップページのサイドバーに抜粋＋記事タイトルリンク＋相対時刻の表示を確認（記事ページへの`#comments`アンカーリンク付き）。
- [x] XSS/安全性: `dangerouslySetInnerHTML`未使用（grep確認）。実機で`<script>`/`onerror`属性を含むコメントを投稿し、HTML出力が`&lt;`エスケープされ生タグとして出力されないことを確認。
- [x] 保留コメントの非表示: NGワード「カス」・個人中傷（「田中選手は本当に無能だ」）を含むコメントがRoute Handlerで422/held判定になり、`listPublishedCommentsBySlug`の結果に含まれない・`commentCount`も増えないことをDB結合テスト＋実機curlの両方で確認。

## アプリの起動方法
```
npm install
npx prisma migrate dev   # 初回のみ（本スプリントで新規マイグレーション追加: 20260725054244_add_article_comments）
npm run db:seed          # サンプル記事12件＋一部記事にサンプルコメント（拡張E2）を投入
npm run build && npm run start -- -p 3100   # または npm run dev
```
- http://localhost:3100/articles/patch-2614-jungle-nerf-hikkuri-kaeru （コメント欄・サンプルコメント確認用）
- コメント投稿API確認例（PowerShellはcurl.exeの引数エンコードが崩れやすいため、UTF-8ファイル経由の`--data-binary @file`を推奨）:
  `curl -X POST -H "Content-Type: application/json; charset=utf-8" --data-binary @comment.json http://localhost:3100/api/articles/<slug>/comments`
- サイドバー「新着コメント」はトップページ等どのページでも右カラム（PC）/本文下（スマホ）に表示される。

## 既知の問題・懸念点
- **ブラウザ実機（クリック操作）検証は未実施**: 本セッションではPlaywright等のブラウザ操作ツールが利用できず、フォームへの実際の入力・送信ボタンクリック・投稿後のUI遷移（楽観的でなくサーバー応答待ちのローディング表示等）はcurlでのAPI直叩き＋SSR後のHTML静的確認に留まる。evaluatorのPlaywright実機検証で最終確認が必要。
- **Windows PowerShell/Git BashからのcurlでのUTF-8引数崩れ**: `-d '{"body":"日本語"}'`のようにシェル引数へ直接日本語を渡すと文字化けする場合がある（今回の自己確認中にも遭遇）。UTF-8ファイル経由の`--data-binary @file`で回避した。evaluator側で同様の手段を使う場合は同じ回避策を推奨（アプリ側の実装問題ではない）。
- **連投スパム対策は簡易**: 「同一記事内で直前と完全一致する本文かつ10秒以内」のみを拒否する軽量対策。IPアドレスやCookie等によるユーザー識別は行っていない（ログイン無し方針・仕様の「軽量対策でよい」の範囲内の判断）。悪意ある高頻度投稿を完全には防げない。
- **保留コメントの運営UI（一覧・承認/却下）は本スプリントの対象外**: `heldReason`はDBに記録しているが、閲覧・操作するCMS画面はE7で実装予定（仕様どおり）。
- **既存の`Article.commentCount`のシード値を実データに合わせて再定義**: E1では見栄え用の任意の大きな数値だったが、E2では実際のコメント投稿数と表示件数の整合性を保つため、サンプルコメントを追加した3記事（jungle-nerf/ヤスオOTP/worlds組み合わせ）以外は`commentCount: 0`にリセットした（カード💬表示とコメント欄見出し「コメント (N)」の不一致を防ぐため）。見栄え上のコメント数は減ったが、実データとの整合性を優先した。

## 追加したテスト
- `src/lib/__tests__/comments.test.ts`（純関数26件: 入力検証/エラーメッセージ/NGワード・中傷モデレーション/アンカー抽出/行分割/ハニーポット判定/連投スパム判定/抜粋生成）
- `src/lib/__tests__/comments-db.test.ts`（DB結合17件: コメント投稿・採番・NGワード/中傷held・spam拒否・アンカー保存・並行投稿の採番衝突無し・新着コメント取得・Route Handlerの各種ステータスコード）
- テスト実行結果: `npm test` → 35ファイル 269件 全PASS（3回連続実行で決定的にGreenを確認）。`npx tsc --noEmit`エラー0件。`npm run lint`エラー0件（既存の無関係警告1件のみ、本スプリント差分外）。`npm run build`成功（`/api/articles/[slug]/comments`ルート含む全ルート生成）。

## 関連ドキュメント
- [[ext-e1-selfeval]]（前スプリント: 回遊・エンゲージメントUI）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
