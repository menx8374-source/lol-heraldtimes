---
tags: [sprint-selfeval]
sprint: PBE-S6
---

# PBE-S6 自己評価レポート

## 実装した内容
- **事前調査（curl実データ確認、推測なし）**: `raw.communitydragon.org/pbe|latest/.../ja_jp/v1/items.json` と `default` locale 版を実際に取得し確認。
  - `inStore:true` だけでは削除済み/アリーナ専用アイテム（Deathfire Grasp id=3128, Eleisa's Miracle id=3063 等）を除外できない（実測でも `inStore:true` のまま残置）ことを確認。
  - `inStore && displayInItemSets` の組み合わせのみが実際のSR通常ショップアイテム集合（217件、実測でRabadon's Deathcap/Infinity Edge等の現行アイテムと一致）と一致することを実データで確認。この2フィールドをdiffItemsの絞り込み条件に採用。
  - `default`(英語)ロケールの`<stats>`ブロックは常に「数値[%] + 英語ステータス名」の並び（例 `65% Attack Speed`）であることを実測確認し、パース規則を確定。
- **F-PBE6-1**（`src/lib/generation/pbe-item-diff.ts` 全面書き換え）:
  - `isRealStoreItem`（`inStore===true && displayInItemSets===true`、pbe/latest双方）でフィルタし、削除済み/非店売り/内部アイテムを除外。
  - 英語プロース(description全文)の比較を廃止。`<stats>`ブロック内の「数値+既知の英語ステータス名」だけを対訳glossary（`STAT_NAME_JA`、22語、実測語彙のみ収録）で日本語化して比較。対訳の無い語は捏造せず読み飛ばす。
  - 価格(`priceTotal`)差分は `価格` stat・`"<数値>ゴールド"`形式（既存の公式パッチノートパーサーと同じ単位表記に統一）。
  - 素材(from)/合成先(to)/店舗掲載(inStore変化)/説明(prose)の差分報告は廃止（意味のある変更=価格・既知ステータスのみに限定）。
  - `src/lib/collection/adapters/cdragon-pbe.ts`: `CDragonItem` 型に任意フィールド `displayInItemSets?: boolean` を追加（既存フィクスチャ・validatorは変更なし、回帰ゼロ）。
- **F-PBE6-2**（`src/lib/generation/pbe-compose.ts`）: 冒頭サマリの件数集計文を削除し、`PBE {ver}（テストサーバー）で確認された変更のまとめです。正式な数値は公式パッチノートで確定します。` のみに変更（「0体」等の不体裁を解消）。
- **F-PBE6-3**（`pbe-compose.ts` に `resolvePbeThumbnailUrl` 追加、`pbe-article.ts` から呼び出し）: チャンピオン変更あれば `buildChampionSplashUrl`（先頭チャンピオンの alias）を優先、無ければ先頭アイテムの `buildCDragonItemIconUrl`、どちらも無し/`isSafeImageUrl`不通過なら `null`。`null` は `Article.thumbnailUrl`（既存の任意String列、スキーマ変更なし）にそのまま入り、表示側 `ArticleThumbnail` の既存カテゴリ既定サムネイル（`パッチ/メタ`→`/default-thumb-patch-meta.svg`）フォールバックにそのまま乗る（新規デフォルト画像は追加不要、既存の仕組みを流用）。

## 技術選定
- 新規ライブラリ追加なし。既存の `isSafeImageUrl`/`buildChampionSplashUrl`/`buildCDragonItemIconUrl`/`ArticleThumbnail` の既存フォールバック機構を再利用し、実装を最小限に抑えた。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（119ファイル/1618テスト）・`tsc --noEmit` エラー0・`npm run build` 成功・`npm run lint` エラー0（既存の無関係な警告6件のみ、Critical/Highなし）。
- [x] PBEアイテム欄が実在アイテムのみ・日本語（ラベル対訳＋数値）・ノイズ無しになる: `displayInItemSets`条件で削除済み/専用アイテムを実データ相当のフィクスチャで除外確認、英語プロース(casing含む)の差分が出ないこと・価格/日本語ラベルステータスのみになることをテストで確認。
- [x] 冒頭の件数文が消える: `pbe-compose.test.ts`・`pbe-article.test.ts`双方でテキストに「体・アイテム」「0体」等が出ないことを確認。
- [x] PBE記事にサムネが付く: `resolvePbeThumbnailUrl`の優先順位（チャンピオン→アイテム→null）をユニットテストで確認、統合テストで実際に`Article.thumbnailUrl`に先頭アイテムのアイコンURLが設定されることを確認。
- [x] Xツイート統合・未確定・出典・LoLデザインは維持: 既存テスト（PBE-S5関連）は無変更のまま全てGreen。
- [x] AI不使用・逐語維持・捏造なし・opt-in（既定off回帰ゼロ）・DBスキーマ変更なし・新規依存なし: `prisma/schema.prisma`・`package.json`は無変更（`git diff --stat`で確認）。`PBE_ARTICLE_MODE`未設定/offの既存no-op挙動は無変更。

## アプリの起動方法
- テスト: `npx vitest run`
- 型検査: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- （本スプリントはロジック層のみの変更のためDev server起動確認は不要と判断。UIコンポーネント（ArticleThumbnail等）は無変更で既存の表示ロジックをそのまま利用）

## 既知の問題・懸念点
- 対訳glossary(`STAT_NAME_JA`)は実測(2026-07-30時点、PBE 16.16)の店売りアイテム217件の`<stats>`語彙に基づく22語。今後新語が追加された場合、対訳が無い語は出力されない（誤訳より安全側に倒す設計だが、有用な情報が欠落する可能性はある）。将来的に語彙追加が必要になったら実データで確認の上glossaryを追記する運用を想定。
- `resolvePbeThumbnailUrl`はチャンピオン/アイテムそれぞれ「先頭の変更対象」のみを見る（複数変更がある場合も1件目固定）。brief通りの優先順位実装であり仕様通り。
- 実データでの動作確認はcurlによる静的確認とフィクスチャテストのみ（`PBE_ARTICLE_MODE=on`での実運用・実CDragon疎通は本スプリントでは未実行、既存PBE-S1〜S5と同じ検証範囲）。

## 追加したテスト
- `generation-pbe-item-diff.test.ts`: 価格差分（ゴールド単位）、既知ステータス(魔力/攻撃速度/クールダウン短縮)の日本語ラベル差分、英語prose(casing含む)差分が出ないこと、対訳の無い語を出力しないこと、`inStore=false`/`displayInItemSets=false`（削除済み・エリーサの奇跡/デスファイア グラスプ相当）の除外、`displayInItemSets`未設定アイテムの除外、意味のある差分が無ければ0件、等を追加・既存テストを新仕様に合わせて更新。
- `generation-pbe-compose.test.ts`: 冒頭サマリの新文言確認、件数文言が出ないことの確認、`resolvePbeThumbnailUrl`の優先順位（チャンピオン→アイテム→null、壊れたURLのフォールバック）を新規追加。
- `generation-pbe-article.test.ts`: フィクスチャに`displayInItemSets:true`を追加（新フィルタ条件に対応）、`article.thumbnailUrl`がアイテムアイコンURLになること・件数文言が出ないことのアサーションを既存テストに追加。

## 前回フィードバックへの対応
- 該当なし（新規スプリント、フィードバックの引き継ぎなし）。

## 関連ドキュメント
- [[pbe-s6-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
