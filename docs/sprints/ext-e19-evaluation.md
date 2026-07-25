---
tags: [sprint-evaluation]
sprint: E19
result: PASS
---

# Sprint E19 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）
- `npm run build && npm run start`（本番相当, port 3000）で起動して検証。DBは mock seed + `npm run collect && npm run generate` で各カテゴリの記事を用意。検証後 `npm run db:seed` で復元済み、サーバー停止済み。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 主要フロー（トップ/カテゴリ/記事/デザイン切替）で機能不全なし |
| コンソール・実行エラー0件 | PASS | アプリ由来のエラー0件。唯一の2件は mock フィクスチャの外部画像URL（i.ytimg.com）の404で、ブリーフが明示的にFAIL根拠から除外する「外部画像の実読込失敗」。ローカル既定/mock画像は全て正常表示（naturalWidth=640/800） |
| 受け入れ基準充足率100% | PASS | F-E19-1〜4 全て充足（下記） |
| テストGreen（全テスト成功） | PASS | `npm test` → 70 files / 654 tests 全passed。`npx tsc --noEmit`・`npm run build` 成功 |

## 受け入れ基準ごとの結果
- F-E19-1/2 4カテゴリ化: PASS
  - ヘッダーナビ = トップ・パッチ/メタ・5chの反応・海外の反応・eスポーツ。「公式ニュース」「動画・クリップ」タブ消滅（スクショ・DOM確認）。
  - sitemap.xml = `/category/{patch-meta,5ch,overseas,esports}` の4つのみ。
  - DB確認: 生成記事の category は `パッチ/メタ・海外の反応・5chの反応・eスポーツ` の4種のみ。clip記事は全て「eスポーツ」、riot/patch系は「パッチ/メタ」。5ch/reddit は従来カテゴリ維持。
- F-E19-3 サムネイル画像: PASS
  - 記事一覧・記事ページのサムネがカテゴリ色プレースホルダーではなく画像。画像URLのある記事は当該画像（`/mock-images/...svg` 正常表示、外部URLは404だがブリーフ除外対象）、無い記事は汎用既定画像 `/default-thumb.svg`（naturalWidth=640で正常ロード）を表示。
  - `isSafeImageUrl`（https/ローカルパスのみ許可、http/data:/javascript:/プロトコル相対を拒否）に専用テストあり。不正URLは既定画像フォールバック（テスト+実装確認）。
- F-E19-4 タイトル「…」廃止: PASS
  - 生成記事23件中、タイトルに `…` を含むもの 0件（DB全走査）。
  - 記事一覧（新着まとめ・カテゴリ一覧）・人気ランキングとも完結した読めるタイトルを全文表示（article-card は line-clamp 無し）。
  - 注記: 注目記事PICKUPカルーセルのみ CSS `line-clamp-2` により長い完結タイトルの末尾が視覚的に「…」表示される（下記・軽微な改善点）。

## 発見したバグ・問題点（FAILの原因）
- なし（FAILなし）。

## 軽微な改善点（ブロッカーではない）
- 注目記事PICKUPカルーセル（`src/components/pickup-carousel.tsx`）は `line-clamp-2` により、長いタイトルの末尾を CSS で「…」表示する。ただしこれは E1 由来の固定幅カード用の既定レイアウトで、生成タイトル起因の「…」ではなく（手書きのシード完結タイトルも同様にクランプされる）、E19 では未変更。ブリーフの表示側要件は article-card 基準（line-clamp 無しを担保、充足済み）で、受け入れ基準原文の対象は「記事一覧・ランキング」でありいずれも全文表示のため充足と判断。PICKUPでも完全表示したい場合は当該コンポーネントの line-clamp 見直しを検討。
- `ArticleThumbnail` の `<img alt="">`（装飾画像として空alt）。カード全体がリンクでタイトルテキストを持つため実害は小さいが、意味のある代替テキストがあると尚良い。

## 未検証項目（実機確認が必要）
- Riot Data Dragon のチャンピオンスプラッシュ画像の実データ表示: mock の riot.json にチャンピオン紹介アイテムが無く、`COLLECTION_MODE=live` はネット到達性・スコープ外のため end-to-end 実画像は未確認。`buildChampionSplashUrl`/imageUrl 反映のユニット・結合テストで代替担保済み（ブリーフ通りFAID根拠にしない）。
- 外部画像（i.ytimg.com / twitch / i.redd.it）の実読込: ネット不可のため404。ブリーフ明示によりFAIL根拠外。

## プレビュー画像
- `ext-e19-preview-1.png`（トップ: 4カテゴリナビ・既定/mockサムネイル画像・省略なしタイトル）
- `ext-e19-preview-2.png`（記事ページ）

## 関連ドキュメント
- [[ext-e19-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e19-brief]]（本スプリントの仕様抜粋）
