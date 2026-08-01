# revalidate-S1 — 一覧ページの自動更新（A: 短いISR ＋ B: 公開時オンデマンド再検証）

自動公開した記事が一覧ページ（home/category/tags/patches/archive/tier）に**再ビルドせず反映される**ようにする。現状これらは `revalidate`/`dynamic` 指定が無く **ビルド時SSGのまま＝新着が出ない**（完全自動運営の根幹の欠陥）。まとめサイトの定石「静的配信＋公開時にキャッシュ更新」をNext.jsに写す。**A＋B併用**（B=公開で即更新が主、A=短いISRが保険）。

## 含まれる機能

### F-RV1-1: A＝一覧ページに短いISR（`revalidate`）
- 共有定数を用意（例 `src/lib/revalidate-config.ts` に `export const LISTING_REVALIDATE_SECONDS = 300;`）。
- 次の一覧ページに **`export const revalidate = LISTING_REVALIDATE_SECONDS;`** を追加（静的解析可能な定数importで付与）:
  - `/`(home = src/app/page.tsx)・`/category/[slug]`・`/tags`・`/tags/[tag]`・`/patches`・`/patches/[version]`・`/archive`・`/archive/[key]`・`/tier`・`/champions`・`/champions/[slug]`
- **対象外**: `/articles/[slug]`（既に動的＝reflects DB。変更しない）、`/search`（クエリ動的）、`/glossary`・`/contact`・`/privacy`・`/disclaimer`・`/admin*`（静的固定 or 既にforce-dynamic）。
- これにより最悪でも `LISTING_REVALIDATE_SECONDS`（5分）で新着が反映される（Bが効けば即時）。SSGのキャッシュ性能は維持。

### F-RV1-2: B＝オンデマンド再検証API（`/api/revalidate`）
- 新規 Route Handler `src/app/api/revalidate/route.ts`（POST）:
  - **認証必須**: env `REVALIDATE_SECRET`。リクエストの `x-revalidate-secret` ヘッダ（またはJSON body `secret`）が一致しなければ **401**。`REVALIDATE_SECRET` 未設定なら機能無効として **404 or 401**（開けっ放しのDoS可能な再検証口を作らない）。
  - 一致時、**固定の一覧パス群を再検証**する（`revalidatePath`）:
    - 静的index: `revalidatePath("/")`, `"/tags"`, `"/patches"`, `"/archive"`, `"/tier"`, `"/champions"`
    - 動的ルート全体: `revalidatePath("/category/[slug]", "page")`, `revalidatePath("/tags/[tag]", "page")`, `revalidatePath("/patches/[version]", "page")`, `revalidatePath("/archive/[key]", "page")`
  - 返却: `{ revalidated: true }`（200）。例外時も500で本体（呼び出し側pipeline）を巻き込まない（呼び出し側がcatch）。
  - `export const dynamic = "force-dynamic"`（Route Handler自体はキャッシュしない）。
- **セキュリティ**: シークレット比較は**タイミング安全**（少なくとも固定文字列比較でよいが、`REVALIDATE_SECRET`が空/未設定のとき絶対に通さない）。GET等POST以外は405。パス列挙は固定（ユーザー入力のパスを`revalidatePath`に渡さない＝任意パス再検証・情報漏れを防ぐ）。

### F-RV1-3: pipelineから公開時にBを呼ぶ（run-pipeline.ts / 新規delivery）
- `src/lib/generation/revalidate-listings.ts`（`delivery.ts`のnotifyPublishedArticlesと同型の補助処理）を新設: `revalidatePublishedListings(): Promise<void>`
  - `REVALIDATE_SECRET` 未設定なら **no-op**（何もしない・ログのみ）。
  - 設定時、**内部URL**（`REVALIDATE_URL` env、既定 `http://127.0.0.1:${process.env.PORT || 3000}/api/revalidate`）へ `x-revalidate-secret` 付きでPOST。**内部URLにするのは nginx の Basic認証を回避するため**（公開SITE_URL経由だと401になる）。
  - タイムアウト付き（例5秒）。失敗（HTTP/ネット断/タイムアウト）は例外にせずログのみ（**補助処理は本体を止めない**原則）。
- `run-pipeline.ts` の**公開後ブロック**（既存 `newlyPublishedArticleIds.length > 0` の中、`notifyPublishedArticles` の隣）で、**新規公開が1件以上あるときだけ** `revalidatePublishedListings()` を呼ぶ（try/catchで本体を止めない）。予約公開昇格(`promoteScheduled`)で公開が増えた場合も対象（newlyPublishedArticleIdsに含まれる）。

### F-RV1-4: env
- `.env.example` に追記: `REVALIDATE_SECRET`（B有効化に必須・未設定ならBはno-op＝Aのみで動く）、`REVALIDATE_URL`（任意・既定 `http://127.0.0.1:<PORT>/api/revalidate`）、`LISTING_REVALIDATE_SECONDS`（Aの秒数・コード定数だが将来env化する場合の説明。今回はコード定数でよい）。

## 制約・非目標
- **記事詳細（/articles/[slug]）・既存の動的/静的挙動は変えない**（一覧の鮮度だけ直す）。`/admin`のforce-dynamicは不変。
- **セキュリティ**: 再検証APIは必ずシークレット保護（未設定で無効）・固定パスのみ・POST限定。任意パス/タグをユーザー入力から再検証しない。
- **本体を止めない**: B（API呼び出し）の失敗はpipelineを一切止めない（ログのみ）。`REVALIDATE_SECRET`無し・キー無しでも pipeline は従来どおり動く（Aだけ効く）。
- **スキーマ変更なし・新規npm依存なし**（fetchは標準・revalidatePathはnext標準）。hotness/収集/生成/moderationは不変。
- ビルドが通ること（`revalidate`の静的解析・Route Handlerの型）。

## テスト（必須）
1. `/api/revalidate`: 正しい`x-revalidate-secret`で200＋`revalidatePath`が期待パス群に対して呼ばれる（`next/cache`の`revalidatePath`をモック）。誤/欠落シークレットで401。`REVALIDATE_SECRET`未設定で無効(401/404)。GETは405。任意パスがbodyにあっても固定パスしか再検証しない。
2. `revalidatePublishedListings`: `REVALIDATE_SECRET`未設定でPOSTを呼ばない(no-op)。設定時は`REVALIDATE_URL`（既定の内部localhost）へシークレット付きPOST。失敗（fetch reject/非200/タイムアウト）で例外を投げず握りつぶす。
3. run-pipeline: 新規公開>0のとき`revalidatePublishedListings`を呼ぶ、0のとき呼ばない。呼び出しが失敗してもpipelineのreport生成は継続（本体不変）。既存のnotifyPublishedArticles/公開集計テストが回帰しない。
4. 各一覧pageが `revalidate` を export する（静的値）。既存のpage描画・テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`（`revalidate`静的解析OK）・`lint` 通過。
2. 一覧ページがISR(A・既定300s)を持ち、pipelineの公開後に内部URL経由でオンデマンド再検証(B)が走る（シークレット保護・内部URLでBasic認証回避）。新着が再ビルドなしで一覧に反映される。
3. 記事詳細/管理画面・既存挙動不変・本体を止めない・スキーマ/依存変更なし・APIはシークレット必須で安全。

## 評価基準（evaluator向け・Playwright可）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- `/api/revalidate` がシークレット無しで401、有りで200＋固定パス再検証。pipeline公開後にBが呼ばれ（REVALIDATE_SECRET設定時）失敗しても本体継続。一覧pageにrevalidateが付く。
- 可能なら実機/統合で「記事公開→（Bまたは最大300sのAで）一覧に新着が出る」を確認（Playwrightで一覧の記事数がDB実態に追随）。
- 受け入れ基準1〜3を満たす。
