---
tags: [sprint-evaluation]
sprint: E3
result: PASS
---

# Sprint E3（コンテンツ表現）評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・Chromium）
- `npm run db:seed` → `npm run build` → `npm run start -- -p 3100` で自己起動し実ブラウザ検証。
- 検証後にサーバー停止・`npm run db:seed` でDB復元済み。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 全観点で期待どおり描画。破綻・例外なし |
| コンソールエラー0件 | PASS | 記事4本＋トップで `browser_console_messages` errors/warnings=0 |
| 受け入れ基準充足率100% | PASS | 観点1〜7すべて実機で確認（下記） |
| テストGreen（全テスト成功） | PASS | `npm test`（vitest run）→ 37ファイル 307件 全PASS |

## 観点ごとの結果
1. 記事内画像: PASS — jungle-nerf/overseas記事本文に `<img src=/mock-images/*.svg loading=lazy decoding=async>`。`<figcaption>` に「画像: LoLまとめ速報編集部（オリジナル作成…実際の…画面ではありません）」のクレジット表示。
2. アイキャッチ画像: PASS — トップ12記事中 jungle-nerf/worlds の2件のみ実SVGサムネイル（loading=lazy）、残10件は従来のカテゴリ色グラデプレースホルダ（後方互換）。SVGは全て HTTP 200。
3. 埋め込みプレースホルダカード: PASS — clip(🎬)/X(twitter)/youtube の3種で「プロバイダ名ラベル＋caption＋元URLリンク＋『※埋め込みは本番接続時に表示されます』注記」のカードを表示。全ページ `iframe` 0件、外部script 0件、HTML内に embed iframe/script 0件。seedに不正/ホワイトリスト外URLは存在しないため非表示ケースは実データでは発生せず。parse時＋描画時の二重ホワイトリスト検証は `embed.test.ts`(9件)・`article-body.test.ts`・`article-body-view.test.tsx`(不正URL非表示)でGreen確認。
4. AA/顔文字: PASS — 5ch記事レス11の箱型AA「GG!」が `whitespace-pre-wrap` + monospace(ui-monospace…)で先頭スペース保持のまま崩れず表示。レス10の顔文字 `(^^)/` は通常テキスト（font-monoなし）で崩れず。
5. 海外の反応の原文併記: PASS — overseas記事reddit系レス1/3で「原文: I'm shocked…（英語）」「原文: Honestly this feels…（英語）」＋日本語訳を上下併記。
6. クレジット/出典: PASS — 画像figcaptionクレジット・埋め込みprovider名・記事末尾「出典」節（Riot公式/Reddit）が整合表示。
7. 回帰・安全: PASS — 既存レス/コメント(5)/リアクション/ページネーション/関連記事/ランキング/新着コメント/法務フッター正常。ダークモード切替後も画像・埋め込み・AAが崩れず（preview-1/2）。デスクトップ幅で横スクロールなし（scrollWidth==clientWidth）。埋め込みURLリンクは `word-break: break-all` でモバイル折返し対応。`/admin` は公開ナビ非露出（既存分離維持）。ページHTMLに実iframe/外部script混入なし。

## 発見したバグ・問題点（FAILの原因）
- なし

## 軽微な改善点（ブロッカーではない）
- 埋め込みプレースホルダの元URLはダミー値（clips.twitch.tv/Sample…、x.com/example…、youtube watch?v=sample…）。実iframeは読み込まないため実害なしだが、クリック時に外部側で404になる旨は自己評価どおり。
- コメント欄（`commentBodyToLines`）は各行 `trim()` のため、ユーザー投稿コメント内でのAA先頭インデントは崩れ得る（今回のAAデモはreaction側のため影響なし）。

## 未検証項目（実機確認が必要）
- 該当なし（対象は全てWebで検証可能なモック/プレースホルダ実装）。実物の外部埋め込み本接続は仕様上スコープ外。

## プレビュー画像
- `ext-e3-preview-1.png`（overseas記事・ダーク: 記事内画像＋X埋め込みカード＋原文併記）
- `ext-e3-preview-2.png`（5ch記事・ダーク: クリップ埋め込みカード＋顔文字＋箱型AA）

## 関連ドキュメント
- [[ext-e3-selfeval]]（ジェネレーターの自己評価レポート）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
