---
tags: [sprint-evaluation]
sprint: admincms-S1
result: FAIL
---

# Sprint admincms-S1 評価レポート

## 総合判定: FAIL

要レビュー記事の公開側非表示（最重要の不変条件）・ポリシートグル・承認/却下の実クリックはすべて期待どおり動作した。
FAILの原因は1点のみ: **パイプラインCLIが `status="review"` で保存した記事を `status=published` と誤って出力する**（本スプリントで `publicationStatus` に `"review"` を追加した際、消費側 `scripts/pipeline.ts` を更新し忘れたもの）。DB・管理ダッシュボードの表示は正しい。

## 検証モード: Playwright（Web実機）

- Basic認証はブラウザにオリジン単位でキャッシュさせ、ページURLに資格情報を含めない形で操作した（後述「軽微な改善点」参照）。
- 検証用DBは `prisma/eval-a/b/c.db` を新規作成して使用し、終了時に削除。`prisma/dev.db` は事前バックアップから復元済み（24 published / 4 held / policies 0 = 検証前と同一）。サーバー停止・ポート3100解放済み。

## 基準ごとの結果

| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | FAIL | 問題1: パイプラインCLIが要レビュー保存の記事を `status=published` と誤出力（同一出力内の `公開=0` と矛盾） |
| コンソールエラー0件 | PASS | `/admin`・`/`・レビューキュー操作後・プレビュー: いずれもアプリ由来エラー0件。記事ページ/プレビューで出る 429・permissions policy は埋め込みTwitchプレイヤー（外部オリジン）由来で本スプリント無関係 |
| 受け入れ基準充足率100% | PASS | 下記「受け入れ基準の実機確認」のとおり全項目確認済み |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **138ファイル / 1911テスト全passed**（33.9s）。`npx tsc --noEmit` エラー0。`npm run build` 成功。`npm run lint` エラー0（警告7件は既存の`<img>`/未使用変数） |

## 受け入れ基準の実機確認（すべてPlaywright実操作）

- **公開ポリシー**: 6カテゴリが1行ずつ・初期は全行「要レビュー」。「パッチ/メタ」の**トグルボタンを実クリック**→その行だけ「自動公開」・他5行不変。DB `CategoryPublishPolicy` に `[["パッチ/メタ",true]]` 永続化。再読込後も保持。**サーバー停止→再起動後も保持**。「要レビューに切替」実クリックで `false` に戻り全行「要レビュー」に復帰。
- **未レビューバッジ**: 0件時「未レビュー 0件」＋「要レビューの記事はありません」。10件時「未レビュー 10件」。承認で10→9、却下で9→8と増減。
- **パイプラインのポリシー尊重（A/B対照・同一入力）**:
  - eval-a（全カテゴリ要レビュー）: 生成2件 → 全て `status="review"`、公開記事総数 12→12 で不変、`PipelineRunLog.reviewCount=2`。
  - eval-c（「Xの反応」のみ自動公開・他は要レビュー）: **同一の入力Postから**生成2件 → `status="published"`、公開総数 12→14、`publishedCount=2 / reviewCount=0`。→ `decidePublishState` の分岐が実パイプラインで確認できた。
  - eval-b（「パッチ/メタ」のみ自動公開）: 非自動公開カテゴリ（5ch/Riot公式/Xの反応/海外の反応）計6件が review、公開総数は不変。
  - **held優先**: 「パッチ/メタ」＝自動公開の状態で安全フィルタ該当（duplicate）記事は `status="held"`＋理由付きで保留キュー行き（reviewにもpublishedにもならない）。personal_attack 例も同様。
- **不変条件（要レビュー記事が公開側に一切出ない）**: review記事10件のスラッグ＋固有タイトル語で以下を実際に開いて全数走査し、**1件も露出なし**: トップ `/`・カテゴリ一覧6種（5ch/overseas/x/riot-official/patch-meta/esports）・`/tags`・`/tags/パッチノート`（検証のためreview記事に既存タグを付与した上で確認）・`/search`（3クエリ。「氷雪の狩人」検索は「該当する記事が見つかりませんでした」＝ヒットしたのは検索語のエコー表示のみ）・`/archive`・`/archive/2026-07`・`/archive/2026-08-01`・人気ランキング `/api/ranking?period=day|week|month`・関連記事（公開記事3ページ）・`/sitemap.xml`・`/news-sitemap.xml`・`/feed.xml`・`/robots.txt`。**個別記事URL直叩きは review 10件すべて HTTP 404**（OGP/JSON-LDも出力されない）。既存の公開記事は従来どおり200で表示。
- **レビューキュー操作（実クリック）**: 「承認して公開」→キューから消え・バッジ-1・公開総数12→13・DB `status="published"`＋`publishedAt`設定・**公開サイトのトップ/カテゴリ/サイトマップ/フィード/個別URL(200)に出現**。「却下」→キューから消え・DB `status="rejected"`・個別URL404・トップに非表示・公開総数不変。
- **既存セクションの回帰**: 保留キューの「承認して公開」「却下」「予約公開に設定」を実クリックし、それぞれ published / rejected / scheduled へ遷移することを確認。予約公開記事はその後のパイプライン実行で `予約公開昇格=1` として **published に昇格（要レビューに差し戻されない）**。保留コメント・記事管理・直近の実行結果・公開記事総数・人気記事・失敗ログの各セクションも従来どおり表示。記事管理の状態ラベルは「公開中13/保留中3/却下済み1/**要レビュー8**」と区別表示。
- **プレビュー** `/admin/articles/[id]/preview`: 公開ページと**バイト単位で同一**の本文HTMLを確認（同一記事で公開ページ側とプレビュー側の`ArticleBodyView`ルート要素を正規化比較。5ch記事: 5195文字・hash一致／パッチ記事: 1488文字・hash一致）。カバーしたブロック型 = 見出し・段落・引用(blockquote+「引用」ラベル)・画像(figure)・埋め込みカード・レス枠（レス番号「1:」名前「国内プレイヤーさん」アンカー「>>1」「>>5」まで一致）。review記事のプレビューも同体裁で表示。**プレビュー後も `status="review"` のままキューに残存**（review総数10で不変）。未認証は **401**、`<meta name="robots" content="noindex, nofollow">` を確認。
- **認可**: DOMから実際のServer Action IDを取得し、**認証なしで承認/却下/ポリシー変更のServer Actionを直接POST**→3件とも **HTTP 401**、DBの記事status・ポリシー行ともに変化なし。

## 発見したバグ・問題点（FAILの原因）

### 問題1: パイプラインCLIが「要レビュー」で保存した記事を `status=published` と誤表示し、要レビュー件数も出力されない

- **再現手順**:
  1. カテゴリの公開ポリシーを「要レビュー」（既定）にする。
  2. `npm run pipeline` を実行し、記事が1件以上生成される状態にする。
- **期待結果**: 生成行に `status=review`（要レビュー）相当が表示され、実行サマリにも要レビュー件数が出る（briefのF3「実行ログに要レビュー件数も分かる形で記録」）。
- **実際の結果**: 要レビューで保存された記事が `status=published` と表示される。同じ出力の実行サマリは `公開=0 保留=0` で、要レビュー件数の表示自体が無く、両者が矛盾する。
  ```
  [生成] postId=cmsa9327b000mvcto1d68w50m -> articleId=cmsa932ck000qvctozoeizamv status=published
  [生成] postId=cmsa93271000jvctouhih5q23 -> articleId=cmsa932cq000tvcto7mrkcdvq status=published
  実行サマリ: 収集=14 候補=12 生成成功=2 生成失敗=0 公開=0 保留=0 予約公開昇格=0
  ```
  同実行のDB実測は `published:12（実行前と不変） / review:2`、`PipelineRunLog.reviewCount=2`。→ DBは正しく、**CLI出力だけが事実と異なる**。cron運用でこのログを見る運営者が「公開された」と誤認する。
- **根拠**: `scripts/pipeline.ts:37`
  ```js
  const pub = r.publicationStatus === "held" ? `held(理由:${r.heldReason})` : "published";
  ```
  本スプリントで `publicationStatus` の型を `"published" | "held" | "scheduled"` → `"published" | "held" | "scheduled" | "review"` に拡張（`src/lib/generation/post-pipeline.ts:60`, `src/lib/generation/pipeline.ts:70`）した一方、この二分岐の消費側が未更新。`git status` のとおり `scripts/` は本スプリントで未変更。
- **疑われる原因**: 上記の非網羅なternary。`held` 以外をすべて `published` と決め打ちしているため `review`（および既存の `scheduled`）が誤ラベルになる。あわせて `scripts/pipeline.ts:45` の実行サマリ行に `report.reviewCount` が含まれていない。
- **補足（誤解防止）**: 管理ダッシュボードの「直近の実行結果」表には「要レビュー件数」列が正しく追加され実測値（4件・6件）を表示している。DB・UI・不変条件はいずれも正しく、影響範囲はCLI出力のみ。

## 軽微な改善点（ブロッカーではないもの）

- 保留キューの「予約公開に設定」は `datetime-local` が空のまま押しても無反応（エラー表示もなし）。既存機能のため本スプリントの回帰ではないが、必須である旨の表示か `required` 属性があると親切。
- レビューキューの各操作ボタンに確認ダイアログが無く、「却下」の誤クリックが即座に確定する（取り消し導線もキュー外）。
- 管理画面はダーク基調だが、再利用した `ArticleBodyView` は `dark:` バリアント前提のため、プレビュー内のレス枠・引用がライト配色で表示され配色が混在する（自己評価の申告どおり。構造は公開ページと完全一致しているため機能影響なし）。
- アクセシビリティ: 公開ポリシーのトグルは `<button>` で状態が文言のみに表れる（`aria-pressed` 等が無い）。プレビュー画面の画像は `alt` にタイトルが入っており問題なし。

## 未検証項目（実機確認が必要）

- プレビューにおける **パッチ表（patchChange）ブロックと目次（toc）ブロック** の目視: 検証データ（mockフィクスチャ由来）にこの2ブロック型を含む記事が生成されなかったため、実物での目視比較は未実施。ただし両ブロックとも公開ページと同一の `ArticleBodyView` 内で描画されており（`src/components/article-body-view.tsx` の `TocBlockView` / patchChange 分岐）、他6ブロック型で公開ページとバイト単位一致を確認済みのため構造的には同一。
- 「パッチ/メタを自動公開にしてパイプライン実行 → パッチ/メタ記事が公開される」の**パッチ/メタカテゴリそのものでの**成功系: 当該カテゴリで生成された記事がmockデータの重複判定に掛かり held となったため、代わりに同一入力での「Xの反応」自動公開/要レビューのA/B対照で `decidePublishState` の分岐を確認した（判定ロジックはカテゴリ非依存）。
- 本番相当の外部ソース（reddit/5ch/X/Riot実接続）でのパイプライン挙動は未検証（COLLECTION_MODE/GENERATION_MODE ともにmock既定で実行）。

## プレビュー画像

- 該当なし（FAIL判定のため未取得）

## 関連ドキュメント

- [[admincms-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[admincms-s1-brief]]（本スプリントの仕様抜粋）
- [[admin-cms-v2-spec]]（製品仕様書）
