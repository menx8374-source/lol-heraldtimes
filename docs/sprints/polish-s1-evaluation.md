---
tags: [sprint-evaluation]
sprint: polish-S1
result: PASS
---

# Sprint polish-S1 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機） + `next start` 実起動へのcurl（proxy認証境界）+ tsx実行（compose表示順）
- proxyの認証境界は**本番ビルド（`npm run build` → `next start -p 3100`）にcurl**でSITE_PRIVATE=true/公開モードの両方を実測。
- 5ch表示順は**実コード（`composeArticleBody`）をtsxで実行**して選定集合・表示順を実測（UIは既存記事＝生成済みbodyのため表示レンダリングのみ確認）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | proxy/5ch表示順とも仕様どおり。認証バイパス・回帰なし（下記実測） |
| コンソールエラー0件 | PASS | `/`・`/articles/5ch-support-item-change-giron`・`/articles/gen-cms4nuo63000cvcusj0z143kp` でconsole errors/warnings 0件。ページ内API/RSCリクエストは全200 |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3をすべて充足（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **134ファイル / 1871テスト 全passed**（Duration 34.15s、exit 0） |

### ビルド系（受け入れ基準1）
- `npx vitest run`: 134 files / 1871 tests passed（失敗0）
- `npx tsc --noEmit`: exit 0（エラー0）
- `npm run build`: 成功（Proxy (Middleware) 出力あり）
- `npm run lint`: **0 errors**（warning 7件はすべて既存・本変更と無関係の`<img>`／テストの未使用変数）

### proxy セキュリティ実測（SITE_PRIVATE=true、ADMIN_USER/PASSWORD設定、REVALIDATE_SECRET=test-secret-123）
| リクエスト | 実測 | 判定 |
|---|---|---|
| `POST /api/revalidate`（secret無し） | 401 `{"error":"unauthorized"}`・**WWW-Authenticateヘッダー無し** | Route Handlerに到達（proxyの401ではない）✔ |
| `POST /api/revalidate`（誤secret） | 401 `{"error":"unauthorized"}` | ✔ |
| `POST /api/revalidate`（正しいsecret） | **200 `{"revalidated":true}`** | B有効化＝目的達成 ✔ |
| `GET /api/revalidate`（正しいsecret） | 405 | POST限定が有効（＝到達している）✔ |
| `GET /`（認証無し） | 401 `認証が必要です。`＋`WWW-Authenticate: Basic ...` | 保護不変 ✔ |
| `GET /`（正しいBasic認証） | 200 | ✔ |
| `GET /category/lol` | 401（proxy） | 保護不変 ✔ |
| `GET /admin` / `GET /admin/xxx` | 401（proxy） | 保護不変 ✔ |
| `GET /api/ranking` | 401（proxy） | 他APIは従来どおり保護 ✔ |
| `POST /api/revalidatex` | 401（proxy） | 前方一致の穴なし ✔ |
| `POST /api/revalidate/foo` | 401（proxy） | 完全一致のみ ✔ |
| `POST /api/other` | 401（proxy） | ✔ |

パス正規化・トラバーサルによる迂回も個別に確認（いずれも穴なし）:
- `/api/revalidate/../admin`・`/api/revalidate/..%2fadmin`（`curl --path-as-is`）→ **401（proxyのbody「認証が必要です。」）**＝/admin保護は迂回されない。
- `/API/revalidate`（大文字）・`/api/revalidate%20` → 401（proxy保護側に倒れる＝安全側）。
- `/api/revalidate/`・`//api/revalidate` → 308（Next正規化リダイレクト、Location=`/api/revalidate`）。pipelineの呼び出し先は `src/lib/generation/revalidate-listings.ts` の `http://127.0.0.1:<PORT>/api/revalidate`（末尾スラッシュ無し・完全一致）で整合。
- `/api/revalidate?x=1` → クエリ付きでも `nextUrl.pathname` は `/api/revalidate` のため素通し＋secret判定（正secretで200）。クエリはRoute Handlerで未使用のため実害なし。

公開モード（SITE_PRIVATE未設定）でも従来どおり: `GET /` 200 ／ `/admin`・`/admin/xxx` 401 ／ `/api/ranking` 400（＝到達・従来どおり素通し）／ `POST /api/revalidate` は secret無し401・正secret200。

**認可の実体**: `/api/revalidate` はBasic認証を外した代わりに `REVALIDATE_SECRET`（未設定なら常に401）＋POST限定＋固定パスのみ`revalidatePath`（ユーザー入力パスを渡さない）で保護されており、非公開コンテンツの閲覧・列挙には使えない（応答は`{"revalidated":true}`のみ）。除外は完全一致1本のみで、`matcher`・`/admin`判定・SITE_PRIVATE判定は無改変。

### 5ch表示順（受け入れ基準2、実コード実行で実測）
brief記載例の再現（2クラスタ: 401←402←403 / 404←405、`REACTION_SELECT_MODE=rules`・`REACTION_MAX_RESES=5`）:
- `selectScoredAnchorReses` の生の選定順（＝表示ソート前）: **404,405,401,402,403**（新しめ優先のチェーン整合順）
- `composeArticleBody`（5ch）の表示: **401,402,403,404,405**（レス番号昇順＝時系列）✔
- 同じ構成のreddit（score:1/2/3 と 90/95）: **404,405,401,402,403**（チェーン整合順のまま）✔ 不変

選定集合の不変性（新しめ優先が維持されること）:
- 古いクラスタ10-12／新しいクラスタ200-202・`REACTION_MAX_RESES=3` → 表示 **200,201,202**（古いクラスタは選ばれない＝選定は新しめ優先のまま）✔
- 既存テスト5ファイルの更新差分は**すべて順序のみ**（採用レス番号の集合・件数は同一。例: `[413,58,59,61]`→`[58,59,61,413]`、`[3,1,2]`→`[1,2,3]`、`[50,30,40]`→`[30,40,50]`）。アサーションの削除・弱体化なし。
- 5ch llm経路（`REACTION_SELECT_MODE=llm`）は分岐に触れておらず不変（実行でも同結果）。X（`buildXReactionBlocks`）はlike由来チェーン整合順のまま（新規テストで確認）。
- reactqual-S3再現（#102の本文保持・空レス非掲載）・逐語・強調は新規テスト `generation-compose-polish-s1.test.ts` でGreen。

### スキーマ/依存/LLM（受け入れ基準3）
- `git diff` に `prisma/`・`package.json`・`package-lock.json` の変更なし（差分は `src/proxy.ts` +9行、`src/lib/generation/compose.ts` +6行、テスト7ファイルのみ）。
- LLM呼び出し増なし（表示順のソートのみ・翻訳/NG処理のバッチ構成は不変）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（PASSでもFAILでも、ブロッカーではないもの）
- `/api/revalidate` の秘密比較が `!==`（非定数時間）。実質的なリスクは低いが、Basic認証の外に出た以上 `timingSafeEqual` 相当への置換を将来検討してよい（本スプリント範囲外・既存実装）。
- 未設定時 `{"error":"not_configured"}` と誤secret時 `{"error":"unauthorized"}` でレスポンスが異なり「機能が有効か」が外部から判別可能（情報量は極小・既存実装）。
- `REVALIDATE_URL` を末尾スラッシュ付きで設定すると308リダイレクトでPOSTが素通しされない可能性がある（既定値は問題なし）。`.env.example` に「末尾スラッシュ無し」の注記があると親切。
- 記事ページの一部画像が外部fixture URL（`i.redd.it`・`cmsassets.rgpub.io`のモックパス）でORBブロックされる（既存のシードデータ由来・本スプリント無関係、コンソールエラーではない）。
- lint warning 7件（`<img>`・テストの未使用変数）は既存。

## 未検証項目（実機確認が必要）
- 本番nginx配下（Basic認証がnginx側にも掛かる構成）での `/api/revalidate` 挙動: 今回はNext単体（`next start`）で検証。pipelineは内部URL `127.0.0.1:<PORT>` を叩くためnginxを経由しない設計だが、本番VPSでの実走は未検証。
- pipeline実走（記事公開→B呼び出し→一覧即時反映）のE2E: 実データ収集・LLM呼び出しを伴うため未実施（`/api/revalidate` 単体の200・`revalidated:true` は実測済み）。
- 新規生成記事のUI上の5ch表示順: 既存記事はbody生成済みのため旧順序のまま。表示順は`composeArticleBody`実行で実測済み。

## プレビュー画像（PASSかつ画面を持つプロダクトの場合のみ）
- `polish-s1-preview-1.png`（5ch反応記事ページ）
- `polish-s1-preview-2.png`（生成記事ページ）

## 関連ドキュメント
- [[polish-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[polish-s1-brief]]（本スプリントの仕様抜粋）
