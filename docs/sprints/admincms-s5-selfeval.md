---
tags: [sprint-selfeval]
sprint: 5
---

# Sprint admincms-S5 自己評価レポート

## 実装した内容

### F10: 公開後編集の即時反映（設計整理版）
- **一覧・詳細ページの即時反映は同一プロセス内の直接`revalidatePath`のみで保証する**方針に統一（機能B=`/api/revalidate`のHTTPループバックは使わない）。
  - `src/lib/generation/revalidate-listings.ts`に`revalidateListingPathsInProcess()`を新規export（`/`・`/tags`・`/patches`・`/archive`・`/tier`・`/champions`・`/category/[slug]`・`/tags/[tag]`・`/patches/[version]`・`/archive/[key]`の10パスを直接`revalidatePath`する**唯一のsource of truth**）。`/api/revalidate/route.ts`もこの共有関数を使うようリファクタリング（重複するパス列挙を解消、挙動・テストは不変）。
  - `revalidatePublishedListings()`（機能B・HTTPループバック）は**パイプライン(`run-pipeline.ts`)専用**として維持し、管理画面からは呼ばない（戻り値も`boolean`→`void`に戻し、パイプライン側が使わない不要な戻り値を削除）。
- `updateArticleContent`（`articles-admin.ts`）は保存後の`{slug}`を返す（フォームはslugを編集できないため保存前後で同一値だが、詳細ページの`revalidatePath`に必要）。
- `updateArticleAction`（`actions.ts`）保存成功時、`revalidatePath("/admin")`＋`revalidateListingPathsInProcess()`＋`revalidatePath(/articles/[slug])`を**try/catchで包む**。これらは同一プロセス内の直接呼び出しのため通常失敗しない＝**既定構成（`REVALIDATE_SECRET`未設定）でも反映は保証される**。catchでthrowを捕捉した**真の失敗時のみ**`{success:true, revalidateWarning:true}`を返しredirectしない（DB保存は既に確定済みで巻き戻さない）。成功時は従来どおり`redirect("/admin")`。
- `ArticleEditor.tsx`が`revalidateWarning:true`のとき警告バナー（`data-revalidate-warning`）を表示。

### F11: レビュー運用効率化（個別/一括の反映を対称化）
- `listReviewQueue({ category? })`にカテゴリ絞込を追加（未指定=全件、`status:"review"`条件と併用のため他状態は混ざらない）。
- `approveReviewArticle`（lib）から機能B呼び出しを撤去し、`{slug}`を返すよう変更（反映は呼び出し元のin-process呼びに集約。1件承認ごとにHTTP往復していた旧実装を解消）。
- `approveReviewArticleAction`（個別承認）: 承認後、共有`revalidateListingPathsInProcess()`＋当該記事の`/articles/[slug]`をin-processで再検証。
- `bulkApproveReviewArticles(articleIds, auth)`（lib、新規）: 1件ずつ`approveReviewArticle`を呼び`{succeeded:{id,slug}[], failed:[{id,reason}]}`を集計。1件の失敗が他を止めない（部分成功）。**evaluatorフィードバック対応**でsucceededに`slug`も含めるよう変更（後述）。
- `bulkApproveReviewArticlesAction`（新規）: ループ内では再検証せず、**最後に1回だけ**`revalidateListingPathsInProcess()`＋承認に成功した各記事の`/articles/[slug]`を呼ぶ（N件承認してもHTTP往復0回・一覧再検証1回にまとめる。個別承認と同じ共有関数を使うため反映経路が対称）。
- `ReviewQueueList.tsx`（新規クライアントコンポーネント、**evaluatorフィードバックで構造を修正**。詳細は後述）: レビューキュー全体で、個別の「承認して公開」「却下」は記事ごとの独立した`<form action={...}>`＋`<input type="hidden" name="articleId">`（S1で実績のある方式）。一括選択のチェックボックス（`name="selectedIds"`）と「選択した記事をまとめて承認」ボタンは、HTML5の`form`属性（`form="review-queue-bulk-approve-form"`）で物理的に離れた場所にある一括用`<form id="review-queue-bulk-approve-form">`に紐付ける（`<form>`の入れ子を回避しつつ個別/一括を1画面で共存させる）。`useActionState`で一括承認の集計結果を表示。
- `/admin`ページにカテゴリ絞込フォーム（`method="get"`、JS不要）と`未レビュー`バッジ件数を`countReviewQueue()`（絞込に影響されない全体件数）に変更。`listReviewQueue({category: categoryFilter})`に簡素化（`category`はoptionalなので内部guardに任せる）。`<ReviewQueueList>`は0件時も含め常に同一コンポーネントとしてレンダーする（後述の結果表示消失バグの修正）。

## 技術選定
- 新規ライブラリ追加なし。既存パターン（`useActionState`、`revalidatePath`、Prisma）を踏襲。
- **設計判断（コーディネーターの品質レビュー指摘を反映）**: F10の即時反映は「single VPS/同一プロセス」という本プロジェクトの実行構成を前提に、**in-process `revalidatePath`のみで保証する**方針に一本化した。機能B（HTTPループバック）は元々パイプライン（別プロセスのバッチ実行）が自分自身の実行中サーバーへ反映を伝える手段として設計されたものであり、管理画面のサーバーアクション（既にNext.jsサーバープロセス内で実行中）がこれを介して自分自身にHTTPを打つのは迂遠かつ`REVALIDATE_SECRET`という追加の設定要件を持ち込むだけだった。一本化した結果:
  - 一覧・詳細への反映は環境変数の設定有無に関わらず常に保証される（既定構成で誤警告が出ない）。
  - 個別承認・一括承認・編集保存の3経路が同じ共有関数（`revalidateListingPathsInProcess`）を使うため反映経路が対称になった。
  - 一括承認のHTTP往復がN回→0回に削減された。
  - 「再検証が実行できない時の警告」という受け入れ基準は、in-process反映が原理的に常に成功するため**既定では警告が出ない＝反映成功という上位互換**になる（警告バナーの仕組み自体は、in-processのrevalidatePathが真に例外を投げた場合のために残してある）。

## 受け入れ基準チェック（自己申告）
- [x] タイトル変更保存→トップ一覧の見出し反映: `revalidateListingPathsInProcess()`で`/`を直接revalidatePath。テストで確認。
- [x] 個別記事ページも保存直後に反映: `revalidatePath(/articles/[slug])`。テストで確認。
- [x] 段落ブロック追加/削除の反映: 本文全体を`updateArticleContent`が置換保存するため、詳細ページrevalidatePathと合わせて反映される（ロジック自体は不変、反映経路のみ整理）。
- [x] カテゴリ変更→旧/新カテゴリ一覧の反映: `/category/[slug]`(page全体revalidate)を直接呼ぶため`REVALIDATE_SECRET`の設定有無に関わらず反映。
- [x] タグ追加→タグ一覧に反映: `/tags/[tag]`(page全体revalidate)を直接呼ぶ。
- [x] 承認直後にトップへ反映: `approveReviewArticleAction`が`revalidateListingPathsInProcess()`（`/`含む）＋詳細ページを呼ぶ。
- [x] 要レビューへ差し戻し→公開側から消えレビューキューに現れる: `updateArticleAction`は`status`変更時も同じ経路で一覧/詳細/カテゴリ/タグをrevalidatePathする（分岐なく常に呼ばれる）。
- [x] 検証エラー時は公開内容が一切変わらない: `updateArticleContent`が例外を投げた場合、revalidatePathは一切呼ばれない（コード順序で保証、テストで確認）。
- [x] 設定不足でも保存成功＋警告表示（上位互換）: in-process反映は環境変数に依存せず常に成功するため、既定構成では警告は出ずそのまま反映される。警告は「in-process再検証が実際にthrowした」真の失敗時のみ表示（テストで`revalidatePath`をthrowさせて確認）。
- [x] レビューキューのカテゴリ絞込: `listReviewQueue({category})`＋`/admin`の`<select name="reviewCategory">`（「すべて」＋6カテゴリ）。テストで対象カテゴリのみ・他状態が混ざらないことを確認。
- [x] チェックボックスで複数選択→まとめて承認: `ReviewQueueList`のチェックボックス＋`bulkApproveReviewArticlesAction`。3件中2件選択のテストで、選択2件がpublished・未選択1件がreviewのまま残ることを確認。
- [x] まとめて承認後の結果表示＋バッジ減少: `{status:"done", succeededCount, failed}`をUIに表示。バッジは`countReviewQueue()`（全体件数、承認後は減る）。
- [x] 0件選択で「記事が選択されていません」: `{status:"no_selection"}`、DB変更なし・エラーなし。テストで確認。
- [x] 0件表示・フィルタ/一括操作でエラーにならない: `ReviewQueueList`は常にレンダーし、`articles.length===0`のときはコンポーネント内部で「要レビューの記事はありません」を表示する（フィルタフォームは常に描画）。
- [x] S1〜S4機能の回帰なし: 全2008件のテストがGreen。個別「承認して公開」/「却下」ボタンの実クリック相当の動作は、実際にdevサーバーへ本物のHTTP POSTを送って検証済み（後述）。
- [x] 要レビュー記事が公開側の全経路に出ない不変条件: `updateArticleContent`・公開限定クエリ(`PUBLISHED_ONLY`)のロジック自体は変更しておらず、既存テストがそのままGreenで維持されていることで確認。

## evaluator FAIL（致命的バグ）の修正

### バグ: レビューキューの個別「承認して公開」「却下」ボタンが常に500エラー（S1機能の回帰）
- **原因**: `ReviewQueueList.tsx`が`<button type="submit" formAction={approveReviewArticleAction} name="articleId" value={article.id}>`という構成を使っていた。**React DOMはServer Actionを持つsubmitterボタンの`name`属性を、アクションIDを伝達するための内部名に上書きする**ため、実クリック時の実際のFormDataでは`articleId`という名前のフィールドが送られず、サーバー側`formData.get("articleId")`が常に`null`になり例外（`articleId が指定されていません`）→500エラーになっていた。
- **なぜテストで検知できなかったか**: `approve-review-article-action.test.ts`等は`fd.set("articleId", id)`済みのFormDataをactionへ直接渡しており、Reactが実クリック時に実際に組み立てるFormData（＝ボタンのnameが上書きされた状態）を経由しないため、この不具合を検知できなかった。
- **修正**: `ReviewQueueList.tsx`を全面的に構造変更（詳細は上記「実装した内容」参照）。個別承認/却下を記事ごとの独立した`<form>`＋`<input type="hidden" name="articleId">`に戻し（S1の実績パターン）、一括選択は`form`属性で離れた場所の一括用`<form>`に紐付ける方式に変更。`formAction`＋ボタンの`name`を併用するパターンは完全に排除した。
- **再発防止テスト**: `src/app/admin/__tests__/review-queue-list-markup.test.tsx`（新規）を追加。`react-dom/server`の`renderToStaticMarkup`（新規重量級依存なし、既存の`react-dom`のみ使用）でレンダーしたHTML文字列を検査し、「`articleId`がhidden inputとして専用formの中に存在する」ことを構造的に確認する。**この検査は実際に有効性を検証済み**（修正前の壊れたパターンに一時的に戻して実行したところ、このテストは実際に失敗することを確認してから元に戻した）。
- **さらに実機相当の検証**: dev サーバーを起動し、実際にHTTP POSTリクエスト（Next.jsが実クリック時に送信するのと同じ`$ACTION_...`系hiddenフィールド＋`articleId`フィールドを含むmultipart/form-data、`Next-Action`ヘッダは付けない=非JS/progressive enhancement相当のプレーンなform submit）を`/admin`へ送信し、(a) 個別承認、(b) チェックボックス一括承認（2件中1件選択）の両方で200 OK・記事のstatus遷移が正しいこと（選択/対象記事のみpublished、非対象はreviewのまま）を確認した。使用した一時テスト記事はテスト後に削除済み（DB総件数28件のまま変化なし）。Playwright実クリックによる最終確認はevaluatorに委ねる。

### 軽微指摘の修正
- **一括承認が`/articles/[slug]`を再検証しない（個別承認との非対称）**: `bulkApproveReviewArticles`の`succeeded`を`string[]`から`{id,slug}[]`に変更し、`bulkApproveReviewArticlesAction`が承認成功した各記事の`/articles/${slug}`を`revalidatePath`するよう修正（個別承認と対称）。
- **全件承認時に結果表示が消える**: 原因は`page.tsx`が`reviewQueue.length===0`のとき`<ReviewQueueList>`を`<p>要レビューの記事はありません。</p>`に**差し替えて**いたこと。全件承認するとreviewQueueが空になり、直後のサーバー再検証で`ReviewQueueList`ごとアンマウントされ、`useActionState`が保持していた「まとめて承認」の結果（成功件数等）が消えていた。修正: `page.tsx`は常に`<ReviewQueueList articles={reviewQueue}>`をレンダーし、0件時の表示は`ReviewQueueList`内部に持たせる（同一コンポーネントインスタンスが保たれるため、propsが空配列に変わってもuseActionStateの内部状態は消えない）。

## アプリの起動方法
```
ADMIN_USER=<任意> ADMIN_PASSWORD=<任意> npm run dev
# または npm run build && npm run start
```
- ポート既定3000。`/admin`はBasic認証必須（`ADMIN_USER`/`ADMIN_PASSWORD`未設定時は常に401）。
- `REVALIDATE_SECRET`は**管理画面の即時反映には不要**（in-process `revalidatePath`のみで完結する）。設定するとパイプライン（`npm run pipeline`、別プロセス）が公開後に自分自身へオンデマンド再検証を掛けられるようになる（従来どおり、任意）。
- テスト: `npx vitest run`。

## 既知の問題・懸念点
- Playwrightによる実ブラウザでの実クリック検証はevaluatorに委ねる（generatorはPlaywright MCPを持たない）。代わりに、実際のdevサーバーへ本物のHTTP POST（Next.jsのServer Actionsが実クリック時に送信するのと同一のhiddenフィールド構造）を送って個別承認・一括承認の双方が200 OK・正しいDB遷移になることを確認済み（上記「evaluator FAIL（致命的バグ）の修正」参照）。使用した一時テスト記事はテスト後に削除し、DB件数は変化なし（28件）。
- 本設計は「single VPS/同一プロセスでpublicサイトと管理画面が同じNext.jsサーバー上で動く」という前提に立つ（現行のホスティング構成と一致）。将来、管理画面と公開サイトが別プロセス/別サーバーに分離される場合は、in-process `revalidatePath`だけでは公開サーバー側のキャッシュを飛ばせなくなるため、その時点で機能B（またはWebhook等）を管理画面側にも再度組み込む必要がある。

## 追加したテスト
- `src/lib/__tests__/revalidate-listings.test.ts`: `revalidatePublishedListings`（パイプライン専用、`void`のまま）の既存挙動は不変で確認。新規`revalidateListingPathsInProcess`が固定10パスを`revalidatePath`することを確認。
- `src/app/admin/__tests__/update-article-action.test.ts`: 既定構成（in-process成功）ではredirectし警告が出ないこと／in-process`revalidatePath`が実際にthrowしたときだけ警告付きでredirectしないこと（保存は保持）／保存成功時に一覧＋詳細パスがrevalidatePathされること／検証エラー時はrevalidatePathが一切呼ばれないこと（反映トリガー条件）。
- `src/lib/__tests__/admin-articles.test.ts`: `listReviewQueue`のカテゴリ絞込（対象カテゴリのreviewのみ、他状態混在なし）／`bulkApproveReviewArticles`の0件・全件成功（succeededがid+slugを含む）・一部失敗・未認証拒否。
- `src/app/admin/__tests__/bulk-approve-review-articles-action.test.ts`: `bulkApproveReviewArticlesAction`の0件選択／3件中2件選択で選択分のみpublished・残りreview維持（＋対象記事の`/articles/[slug]`のみrevalidatePathされ非対象は呼ばれないこと）／全件成功時も`succeededCount`が正しく返ること／一部失敗の集計。
- `src/app/admin/__tests__/approve-review-article-action.test.ts`: 個別承認後に一覧＋詳細パスがin-processでrevalidatePathされること（一括承認との対称性）／不正な状態遷移では承認・再検証とも行われないこと。
- `src/app/admin/__tests__/review-queue-list-markup.test.tsx`（新規、致命的バグの再発防止）: `ReviewQueueList`が個別承認/却下をhidden input(`name="articleId"`)＋専用formで送る構造になっていること（submitterボタンのname上書き問題を回避する構造の担保）／一括選択のcheckboxが`selectedIds`という別名前空間を使うこと／0件でもエラーなくレンダーされること。修正前の壊れたパターンに一時的に戻して実際にこのテストが失敗することを確認済み（有効性の検証）。

## 前回フィードバックへの対応

### ラウンド1（品質レビュー、設計整理）
- 指摘1（既定構成での誤警告バグ）→ 対応: F10の反映をin-process直接呼び出しに一本化し、警告はin-processが真に失敗した場合のみに限定。機能Bの呼び出し・no-op配線をactions.tsから撤去。
- 指摘2（一覧パス集合の重複）→ 対応: `revalidateListingPathsInProcess()`を`revalidate-listings.ts`にexportし、`route.ts`とactions.tsの両方がこれを使うよう統一。
- 指摘3（一括承認のN回HTTP・個別/一括の非対称）→ 対応: `approveReviewArticle`(lib)から機能B呼び出しを撤去、個別承認action・一括承認actionともin-process呼びに統一（一括は最後に1回だけ）。
- 指摘4（`listReviewQueue`呼び出しの簡素化）→ 対応: `listReviewQueue({category: categoryFilter})`に変更。

### ラウンド2（evaluator FAIL、致命的バグ）
- 致命的バグ（個別承認/却下ボタンが常に500エラー）→ 対応: `ReviewQueueList.tsx`の`formAction`+ボタン`name`パターンを撤去し、hidden input＋専用formのS1実績パターンに戻す。一括選択は`form`属性で離れた場所の一括formに紐付ける方式に変更。再発防止の構造テストを追加し、有効性を検証。実devサーバーへの実HTTP POSTでも動作確認。
- 軽微指摘1（一括承認が`/articles/[slug]`を再検証しない）→ 対応: `bulkApproveReviewArticles`が`{id,slug}`を返すようにし、`bulkApproveReviewArticlesAction`が各slugをrevalidatePath。
- 軽微指摘2（全件承認時に結果表示が消える）→ 対応: `page.tsx`が0件時に`<ReviewQueueList>`を別要素に差し替えていたのをやめ、常に同一コンポーネントをレンダー（0件表示はコンポーネント内部に持たせる）。

## 関連ドキュメント
- [[admincms-s5-brief]]（本スプリントの仕様抜粋）
- [[admin-cms-v2-spec]]（製品仕様書）
