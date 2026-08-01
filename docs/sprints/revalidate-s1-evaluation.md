---
tags: [sprint-evaluation]
sprint: revalidate-S1
result: PASS
---

# Sprint revalidate-S1 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）＋ 本番ビルド起動（`npm run start -- -p 3100`）でのcurl実測・tsxによる関数実測
未検証のネイティブ専用機能は無し。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 受け入れ基準1〜3の全項目を実機で再現確認。API認証・固定パス・POST限定・B の no-op/握りつぶし・一覧の実反映すべて期待どおり |
| コンソールエラー0件 | PASS | Playwrightで `/`・`/tags`・`/category/5ch`・`/archive`・`/tier`・`/patches`・`/champions` を巡回し `browser_console_messages(all)` = Total 0（Errors 0 / Warnings 0） |
| 受け入れ基準充足率100% | PASS | 下記「受け入れ基準の実測」参照（1〜3すべて充足） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → Test Files 128 passed / Tests 1798 passed（失敗0） |

### ビルド/静的検査
- `npx tsc --noEmit` → 終了コード0（エラー0）。
- `npm run lint` → `0 errors, 7 warnings`（7件はすべて今回変更外の既存ファイル由来）。
- `npm run build` → 成功（`revalidate`の静的解析OK）。ルート表:
  - `○ Static, Revalidate 5m`: `/tags`・`/patches`・`/archive`・`/tier`
  - `ƒ Dynamic`（毎リクエストSSR＝常に最新）: `/`・`/category/[slug]`・`/tags/[tag]`・`/patches/[version]`・`/archive/[key]`・`/champions`・`/champions/[slug]`
  - **一覧系に「revalidate無しの素のSSG（=stale）」は1つも残っていない**ことを確認。
- HTTPヘッダ実測: `/tags` → `x-nextjs-cache: HIT` / `x-nextjs-stale-time: 300` / `Cache-Control: s-maxage=300, stale-while-revalidate=31535700`（A=ISR 300秒が実際に効いている）。記事詳細 `/articles/<slug>` → `Cache-Control: private, no-cache, no-store...`（従来どおり動的・不変）。

### API セキュリティ実測（`/api/revalidate`、実起動サーバへcurl）
| ケース | 実測 |
|---|---|
| (a) `REVALIDATE_SECRET`未設定＋正しそうなヘッダ | 401 `{"error":"not_configured"}` |
| (a') 未設定＋ヘッダ無し / GET | 401 / 405 |
| (b) 誤シークレット / シークレット欠落 | ともに 401 `{"error":"unauthorized"}` |
| (c) 正しい `x-revalidate-secret` | 200 `{"revalidated":true}`＋固定10パスへ`revalidatePath`（`next/cache`モックの単体テストで引数一致を確認: `/`・`/tags`・`/patches`・`/archive`・`/tier`・`/champions`＋`/category/[slug]`・`/tags/[tag]`・`/patches/[version]`・`/archive/[key]`の`"page"`指定） |
| (d) GET / PUT / DELETE | すべて 405 |
| (e) bodyに任意パス（`path:"/admin"`, `paths:["/../etc/passwd"]`）を混入 | 200 だが再検証は固定パスのみ（単体テストで`revalidatePath`が`/admin`・`/../etc/passwd`で呼ばれないこと＋呼び出し回数10回固定を確認）。ユーザー入力のパスは一切渡していない（`route.ts`の`revalidateListingPaths()`はリテラルのみ） |

### B（pipeline側 `revalidatePublishedListings`）の実測（実サーバ3100に対してtsxで直接実行）
- `REVALIDATE_SECRET`未設定 → `fetch`呼び出し回数 **0**（完全no-op）。
- 設定時 → 内部URL（`REVALIDATE_URL`未設定なら `http://127.0.0.1:<PORT|3000>/api/revalidate`）へ `x-revalidate-secret` 付きPOST 1回。
- 到達不能URL（`127.0.0.1:59999`）→ 例外を投げず3msで解決（ログ1行のみ）。
- 非2xx（誤シークレットで401）→ 例外を投げず解決（`status=401`をログ）。
- 応答しないTCPサーバへのPOST → **5005msでabort・例外を投げず解決**（5秒タイムアウト経路も実測）。
- `run-pipeline`結線: 新規公開>0でPOSTが呼ばれる／0件で呼ばれない／`REVALIDATE_SECRET`未設定で呼ばれない／fetch reject時も `report.status==="success"`・`publishedCount>0` のまま完走（`pipeline-run-pipeline.test.ts`の4ケース、全Green）。実装側も関数内握りつぶし＋呼び出し側try/catchの二重防御。

### E2E（記事DB追加 → B → 一覧に反映）
1. 一時記事＋固有タグ `evaltagzz9` をDBに追加 → `/tags`（ISRキャッシュ）は **0件ヒット＝stale**、`/`（Dynamic）は即座に新記事slugを表示（1件ヒット）。
2. `POST /api/revalidate`（正しいシークレット）→ 直後の1回目のGETで `/tags` に `evaltagzz9` が出現（**再ビルドなしで反映**）。
3. 2件目 `evaltagzz8` で同様に、`revalidatePublishedListings()`（pipelineが呼ぶ関数そのもの）経由でも `/tags` に反映されることを確認。
4. 検証用データはすべて削除済み（articles 2件・tags 2件、残存0）。削除後に再度再検証APIを叩き、`/tags` から消えることも確認（キャッシュも整合）。

### 既存挙動・不変条件
- `prisma/schema.prisma`・`package.json` は無変更（`git status`／`git diff --stat`で確認。変更は`.env.example`・一覧page 11本・`run-pipeline.ts`・テストと新規3ファイルのみ）。
- `/articles/[slug]`＝200・`no-store`（不変）、`/search?q=lol`＝200、`/glossary`＝200、`/feed.xml`＝200、`/admin`＝503（`ADMIN_USER/ADMIN_PASSWORD`未設定時の既存proxy仕様。今回変更外）。
- `export const revalidate = 300` は対象11ページちょうどに付与（他ページへの波及なし）。`listing-revalidate.test.ts` が全11ページで `revalidate === LISTING_REVALIDATE_SECONDS` を検証。

## 発見したバグ・問題点（FAILの原因）
- 該当なし。

## 軽微な改善点（ブロッカーではないもの）
- `SITE_PRIVATE=true` 運用時は、内部URL（127.0.0.1）宛でも **アプリ側proxy（`src/proxy.ts`、matcherが全ルート）でBasic認証が要求され `/api/revalidate` が401/503になる** ため、Bは事実上no-op（ログのみ）に落ちる。briefが想定していたのはnginxのBasic認証回避のみで、アプリ側の全体保護は考慮外。実害はA（ISR 300秒／Dynamic）で吸収され本体も止まらないが、将来 `SITE_PRIVATE` 運用と併用するなら proxy 側で `/api/revalidate` を除外するか、B側でBasic認証ヘッダを付ける対応が要る。
- シークレット比較が `!==`（非タイミングセーフ）。briefの許容範囲内だが `crypto.timingSafeEqual` 化の余地あり。
- `revalidate = 300` の数値リテラルが11ファイルに重複（Next.jsの静的解析制約による不可避の対応）。`LISTING_REVALIDATE_SECONDS` との同期はテストで担保されているものの、値変更時は11箇所の手修正が必要。
- `/`・`/category/[slug]` 等は `searchParams` 利用で `ƒ Dynamic` のため、付与した `revalidate=300` は実質的に無効（＝常に最新なので目的は達成。既存パターン起因でスコープ外）。
- アクセシビリティ上の明らかな問題（ラベル無し入力欄・alt無し画像）は巡回時に確認できず。

## 未検証項目（実機確認が必要）
- 本番VPS（nginx Basic認証＋実運用env）上でのB経路。ローカルでは内部URLへの到達・認証・反映まで実測済みだが、nginx配下での実挙動は本番デプロイ時に要確認。
- A（300秒経過による自動ISR再生成）は時間経過を待たず、HTTPヘッダ（`s-maxage=300` / `x-nextjs-stale-time: 300`）とビルド出力（`Revalidate 5m`）で確認。

## プレビュー画像
- `revalidate-s1-preview-1.png`（`/tags`＝ISR対象の一覧ページ）
- `revalidate-s1-preview-2.png`（`/champions`）

## 関連ドキュメント
- [[revalidate-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[revalidate-s1-brief]]（本スプリントの仕様抜粋）
