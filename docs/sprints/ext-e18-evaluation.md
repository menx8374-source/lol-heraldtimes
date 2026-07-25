---
tags: [sprint-evaluation]
sprint: E18
result: PASS
---

# 拡張スプリント E18 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機）＋ fetchモック（オフライン）＋ live収集の実挙動確認
- 実5chアクセスはベストエフォート（ブリーフ前提）。既定板 `egg.5ch.net/livegame` の subject.txt は実環境で HTTP 404 → 握り潰して空＋スキップログ（仕様どおり、FAIL要因にしない）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | mock記事表示・live収集・riot実ネットいずれも例外なし |
| コンソール・実行エラー0件 | PASS | 5ch記事ページのconsole errors=0。5ch 404 / reddit未設定スキップは仕様上の想定内ログ |
| 受け入れ基準充足率100% | PASS | F-E18-1/2 全項目確認（下記） |
| テストGreen（全テスト成功） | PASS | `npm test` → 69ファイル / 628テスト全passs |

## 観点ごとの結果
- **1. テストGreen（fivechfetchモック網羅）**: PASS。`collection-fivech.test.ts` が (a)subject.txtパース→スレ一覧, (b)LoLキーワード絞り込み＋上位N件, (c)datパース→スレッドダンプ（レス番号/`<br>`→改行/`&gt;`等エンティティデコード/`>>N`保持/`<a>`タグ除去）, (d)`parseThreadReses`で3レスに正しく分解（下流互換・アンカー抽出）, (e)sourceUrl=read.cgi一意でdedup, (f)板未設定/subject403/datネット断→空＋スキップログ（throwしない）を全て検証。
- **2. mockモードで5ch記事が反応形式で生成・表示**: PASS。`npm run db:seed` 後 `/articles/5ch-yasuo-otp-densetsu-no-play` を表示。「反応まとめ」見出し＋レス羅列（`1: 国内プレイヤーさん` … `2: >>1` アンカー、赤/オレンジ強調）が正しくレンダリング。console errors=0。他の5ch記事（support-item-change-giron・toplane-matchup）も一覧・関連記事に表示。
- **3. 段階的live→全4ソース**: PASS。`collection-adapters-registry.test.ts` で `getAllAdapters("live")` が riot+reddit+clip+5ch の4件（未実装スキップ無し＝フェーズ2完了）。`getAdapter("5ch","live")` が `FiveChAdapter` を返す。mockは従来どおり全4 MockSourceAdapter。
- **4. live時のグレースフル**: PASS。`COLLECTION_MODE=live npm run collect` が exit 0 で完了。5chは実404を握り潰し `fetched=0 saved=0`（throwなし）、redditはキー無しでスキップ、riot/clipは実行間隔内で rate-limit スキップ、パイプライン全体は停止せず完了。
- **5. 回帰（fetchJsonSafe/fetchTextSafe→fetchSafe集約）**: PASS。`RiotDataDragonAdapter().fetchItems()` を実ネットで直接実行し16件取得（refactored `fetchSafe` のJSON経路が健全）。redditはキー無しでグレースフルにスキップ。既存の記事生成・カテゴリ・サイト表示・デザイン切替に回帰なし。`tsc --noEmit` / `next build` / `eslint` いずれもexit 0（eslintは既存の無関係warning 1件のみ、E18関連0）。新規依存なし。
- **6. 後始末**: PASS。dev server停止・`npm run db:seed` でDB復元済み（live collectでの汚染を戻した）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 既定板 `egg.5ch.net/livegame` は実在サーバだが当該板の subject.txt が404（板構成が変わっている可能性）。ブリーフ前提どおり運営者が `FIVECH_BOARDS` を実在板に差し替える運用であり、コード上の不具合ではない。
- Shift_JIS配信の古い板は文字化けし得る（追加依存回避のためUTF-8前提read。コード/READMEに明記済み・許容範囲）。
- 既存の無関係eslint warning: `generation-generate-article.test.ts:94` `_messages` 未使用（E18対象外）。

## 未検証項目（実機確認が必要）
- 実5chからの subject.txt/dat 実取得・実スレッドの記事化: 未検証（ベストエフォート・未保証）。既定板が404のため実データ収集は再現できず。取得成否に関わらずFAIL要因にしない（ブリーフ評価基準どおり）。実運用では運営者が有効な `FIVECH_BOARDS` を設定し robots/転載規約順守・削除依頼即応を担う。

## プレビュー画像
- `ext-e18-preview-1.png`（mockモードの5ch反応記事ページ・レス羅列表示）

## 関連ドキュメント
- [[ext-e18-selfeval]]（ジェネレーターの自己評価レポート）
- [[ext-e18-brief]]（本スプリントの仕様抜粋）
