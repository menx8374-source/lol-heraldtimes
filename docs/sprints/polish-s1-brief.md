# polish-S1 — /api/revalidate をBasic認証除外（Bを非公開時も有効化）＋ 5ch反応を時系列表示

ユーザー要望2件（小改修・独立）。

## F-P1-1: `/api/revalidate` を proxy の Basic 認証から除外（B を SITE_PRIVATE 下でも有効化）
- 現状 `src/proxy.ts` は `SITE_PRIVATE=true` のときサイト全体（`matcher`が全ルート）に Basic 認証を課すため、pipeline が内部URLで叩く `/api/revalidate` も 401 で弾かれ **B（公開時オンデマンド再検証）が no-op** になる（実データで確認済み）。
- **`/api/revalidate` は独自の `REVALIDATE_SECRET` で保護済み**（未設定/誤りは401・固定パスのみ再検証・POST限定）なので、Basic 認証を**課さず素通し**にしてよい。
- 実装: `proxy()` の**先頭**で `request.nextUrl.pathname === "/api/revalidate"` なら `NextResponse.next()` で即通す（`/admin` 判定や `SITE_PRIVATE` 判定より前）。これにより SITE_PRIVATE 下でもBが200を返せる（＝pipeline公開後に一覧が即時反映）。
  - **`/admin` 配下の保護・SITE_PRIVATE時の他ページ保護は不変**（除外は `/api/revalidate` の完全一致のみ。`/api/` 全体は除外しない＝他のAPIルートがあれば従来どおり保護）。
  - `/api/revalidate` 自体のセキュリティは Route Handler 側の `REVALIDATE_SECRET` に委ねる（多層防御は不要・むしろ内部呼び出しを通すのが目的）。

## F-P1-2: 5ch反応レスの表示順を時系列（レス番号 昇順）にする
- 現状、5ch（reactqual-S4で統一選定）は `selectScoredAnchorReses` の**チェーン整合順（新しめ＝高score primary が前）**で表示され、「新しい塊が先・発端レスが末尾」になり読みにくい。
- **選定（どのレスを載せるか＝新しめ優先）はそのまま**にし、**表示順だけをレス番号 昇順（古い→新しい＝掲示板の時系列）**にする。
- 実装: `compose.ts` `buildReactionBlocks` で、**5ch かつ統一選定を使った場合のみ**、`selectScoredAnchorReses` が返した `selectedIndices` を **`reses[i].number` の昇順にソートしてから**ブロック化する（reddit=upvote順／X=like順の**チェーン整合順は不変**）。
  - レス番号昇順は自然に「親（小さい番号）→子（大きい番号）」になり会話も繋がる。`number`（表示するレス番号）・逐語・強調・アンカー・S3の空レス非掲載/本文保持は不変。
  - 5ch llm経路（`selectMajorConversationCluster`）は従来どおり（本改修は5ch rules統一選定の並び替えのみ）。

## 制約・非目標
- **F-P1-1**: `/admin`・SITE_PRIVATE時の他ページのBasic認証は不変。除外は `/api/revalidate` 完全一致のみ。`/api/revalidate` の認可は `REVALIDATE_SECRET`（Route Handler）が担う。
- **F-P1-2**: 5chの**選定内容（新しめ優先）は変えない**（表示順のみ時系列化）。reddit/X/llm経路は不変。逐語・強調・アンカー・S3不変。
- スキーマ変更なし・新規依存なし・LLM増なし。既存挙動（B以外の一覧鮮度・reddit/X表示・moderation）は不変。

## テスト（必須）
1. proxy: `SITE_PRIVATE=true` でも `/api/revalidate` は `NextResponse.next()`（Basic認証を課さない・素通し）。`/admin` は SITE_PRIVATE/公開どちらでも保護（401 or 503）。SITE_PRIVATE時に `/`・`/category/x` 等は従来どおり保護（401）。`/api/revalidate` 以外の `/api/...`（あれば）はSITE_PRIVATE時に保護される（＝除外は完全一致のみ）。
2. 5ch表示順: 統一選定が返す新しめ優先の集合を、**レス番号昇順**でブロック化する（例 選定=[404,405,401,402,403,...] → 表示=[401,402,403,404,405,...] のように number昇順）。**選定される集合自体は不変**（新しめ優先のまま）。reddit/X はチェーン整合順のまま（並び替えない）。S3再現（#102本文保持）・空レス非掲載・逐語・強調維持。
3. 既存の proxy / compose / 5ch / reddit / X テストが回帰しない（reddit/X順・5ch選定内容・S3不変を明示）。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. SITE_PRIVATE下でも `/api/revalidate` がBasic認証を通り（＝Bが200・公開後に一覧即反映）、`/admin`・他ページの保護は不変。5ch反応が**時系列（古い→新しい）**で表示され、選定は新しめ優先のまま。reddit/X不変。
3. スキーマ/依存不変・S3/reactqual/resel/revalidate と整合。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- proxy: `/api/revalidate` 素通し・他保護不変（テスト＋可能なら実起動curlで SITE_PRIVATE時に /api/revalidate が401でなくRoute Handlerに到達＝secretで判定）。
- 5ch: 表示がレス番号昇順・選定は新しめ優先・reddit/X/ S3不変。
- 受け入れ基準1〜3を満たす。
