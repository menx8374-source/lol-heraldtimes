---
tags: [sprint-selfeval]
sprint: E10
---

# Sprint E10 自己評価レポート

## 実装した内容
- F-E10-1 タグ一覧ページ `/tags`
  - `src/lib/tags.ts` に `listAllTagsWithCounts()` を追加（公開記事が1件以上付くタグを全件、記事数の多い順・同数は名前順で返す。既存の `rankTags` を上限なし(`Infinity`)で再利用）。
  - `src/app/tags/page.tsx`（新規）: 全タグを記事数付きで一覧表示。
  - `src/components/tag-listing.tsx`（新規、クライアントコンポーネント）: タグ名の部分一致で絞り込むテキスト入力欄（「タグでも検索できる」導線）。既存 `tagCloudSizeClass` を流用しタグクラウド的にサイズ変化。
  - `src/components/site-header.tsx`: グローバルナビ（攻略・データ行）に「タグ一覧」「アーカイブ」リンクを追加。
  - `src/app/sitemap.ts`: `/tags` エントリを追加。
- F-E10-2 カレンダー式アーカイブ＋日付絞り込み
  - `src/lib/archive.ts` に追加: `dayKeyOfJST`（UTCインスタント→JST暦日キー化。サーバーのローカルタイムゾーンに依存せず常に+9時間の明示オフセットで計算）、`isValidDateKey`（実在する暦日を厳密検証）、`dateLabel`、`dayDateRangeJST`/`monthDateRangeJST`（JST日/月境界をUTCインスタントの半開区間で返す）、`groupByDayJST`、`prevMonthKey`/`nextMonthKey`、`todayMonthKeyJST`、`buildMonthCalendar`（月グリッド生成、日曜始まり・前後月パディング）、`listArticlesByDate`（公開記事のみ、日単位ページング）、`dayCountsForMonth`（月に絞ってからJST日別集計。無界フェッチにしない）。
  - `src/components/archive-calendar.tsx`（新規）: 月カレンダー（テーブル形式の日付グリッド）。記事のある日をバッジ表示で強調し、日クリックで `/archive/[date]` へ。前月/翌月ナビゲーション付き。
  - ルーティング: Next.js App Router は同一階層に異なる名前の動的セグメント（`[month]`と`[date]`）を共存させられない（ビルド時 "Ambiguous app routes" エラーで発覚）ため、`/archive/[month]` と新設予定の `/archive/[date]` を単一の `src/app/archive/[key]/page.tsx` に統合し、`key` の形式（`isValidDateKey`/`isValidMonthKey`）でページ内容を振り分け。
  - `src/app/archive/page.tsx`: JSTの当日基準の今月カレンダーを既定表示に追加。従来の月一覧（拡張E4）は下部にそのまま残す。

## 技術選定
- 追加の日付ライブラリは導入せず、JS標準の `Date`/`Date.UTC`のみでJST変換・カレンダー生成を実装（architecture.mdの「重量級の日付ライブラリは追加しない」指針に従う。運用コスト増なし・追加依存ゼロ）。

## 受け入れ基準チェック（自己申告）
- [x] `/tags` で全タグが記事数付きで一覧表示され、各タグから `/tags/[tag]` に遷移できる（`curl`で `/tags` の200確認、`href="/tags/..."` リンク存在確認済み）。
- [x] グローバルナビから `/tags` に到達できる（`site-header.tsx` にリンク追加）。タグ名で該当記事に辿り着ける（`/tags/[tag]` は既存実装、日本語タグの `decodeTagParam` も既存のまま維持）。
- [x] タグ一覧・記事数は公開記事のみを対象（`listAllTagsWithCounts` は `PUBLISHED_ONLY` を適用。DB結合テストで保留記事を含まないことを検証）。
- [x] アーカイブがカレンダー（日付グリッド）表示になり、記事のある日が強調される（`/archive` `/archive/[key]`（月形式）双方で `ArchiveCalendar` を表示、実機curlで日リンク・件数バッジ確認）。
- [x] カレンダーの日をクリックすると `/archive/[date]` が表示される（実機で `/archive/2026-07-25` 200・見出し「2026年7月25日」確認）。
- [x] 前月/翌月の移動ができ、日付境界がJSTで正しい（`/archive/2026-07` の前月/翌月リンクが `2026-06`/`2026-08` に一致することを実機確認。JST境界はテストで UTC 14:59:59Z/15:00:00Z の境界越えを検証）。
- [x] 記事の無い日・未来日は空一覧（`/archive/2099-01-01` `/archive/2099-01` とも200・空状態表示）。不正な日付は404（`/archive/2026-02-30`（実在しない暦日）・`/archive/not-a-date` とも404を実機確認）。
- [x] `npm test` が全てGreen（後述）。

## アプリの起動方法
- 開発: `npm run dev`（デフォルト http://localhost:3000）
- 本番相当の自己確認: `npm run build && npm run start -- -p <PORT>`
- 今回の自己確認は `npm run build && npm run start -- -p 3910` で起動し、確認後に停止済み（ポート解放確認済み）。

## 既知の問題・懸念点
- カレンダーの日セルは記事0件でも `/archive/[date]` へのリンクとして機能する（クリック可能）。0件日は視覚的に非強調（グレー）だがクリック自体は塞いでいない。仕様上「クリックすると遷移」は強調日について要求されており矛盾はないが、evaluatorが「0件日はクリック不可であるべき」と解釈する場合は要調整。
- 既存の月別アーカイブ（拡張E4）の `monthDateRange`/`monthKeyOf`（サイドバーウィジェット・従来の月一覧集計で使用）はサーバーのローカルタイムゾーンに依存する実装のまま（本スプリントのスコープ外、既存コードを壊さない方針のため変更していない）。今回新設したJST厳密変換（`dayKeyOfJST`/`dayDateRangeJST`/`monthDateRangeJST`）は日別機能・カレンダー日強調表示にのみ使用しており、両者は独立して共存する。
- Playwright MCPでの実機ブラウザ操作（クリック遷移・レスポンシブ・コンソールエラー）は未実施（generatorの自己確認はcurlでのHTTPレベル検証とビルド/テストのみ）。evaluatorでの実ブラウザ確認を推奨。

## 追加したテスト
- `src/lib/__tests__/archive-calendar.test.ts`（新規）: `dayKeyOfJST`（JST日境界の直前/ちょうど/繰り上げの3ケース含む）、`isValidDateKey`（うるう年・存在しない暦日・不正形式）、`dateLabel`、`dayDateRangeJST`/`monthDateRangeJST`（半開区間のUTC値をISO文字列で厳密検証）、`groupByDayJST`、`prevMonthKey`/`nextMonthKey`（年またぎ含む）、`todayMonthKeyJST`（UTC深夜またぎ）、`buildMonthCalendar`（7の倍数長・日1〜月末の過不足なし・曜日オフセット・件数反映）。
- `src/lib/__tests__/archive-calendar-db.test.ts`（新規）: `listArticlesByDate`（JST境界での公開記事のみ・保留記事除外・未来日空一覧・不正キーnull）、`dayCountsForMonth`（対象月のみJST日別集計・保留記事/他月除外・不正キー空マップ）。
- `src/lib/__tests__/tags-ranking-db.test.ts`（既存ファイルに追記）: `listAllTagsWithCounts`（公開記事のみ・記事数降順・0件タグ除外・タグ0件時は空配列）。

## テスト結果（実数）
- `npx tsc --noEmit`: エラー0件。
- `npm test`: Test Files 57 passed (57) / Tests 504 passed (504)。
- `npm run build`: 成功（`next build`、全ルート生成完了。`/archive`は静的、`/archive/[key]`・`/tags/[tag]`はサーバーレンダリング、`/tags`は静的）。

## 関連ドキュメント
- [[ext-e10-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
