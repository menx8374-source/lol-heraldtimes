---
tags: [sprint-evaluation]
sprint: X-reply-S1
result: PASS
---

# Sprint X-reply-S1 評価レポート

## 総合判定: PASS

## 検証モード: テスト＋静的確認（Playwright不適用）
- 本スプリントはUIを持たないバックエンド収集ロジック（関連フィルタ・集計値・検索クエリ定数）のみの変更で、ブラウザで操作できる画面追加・変更がゼロ。よってPlaywright MCPは不適用とし、自動テスト実行＋型/ビルド/lint＋差分の静的確認で検証した（Bash縮退ではなく変更の性質による正当な選択）。
- 実HTTP（GetXAPI）呼び出しは行っていない（`X_API_KEY`はopt-in・課金対象のため）。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 受け入れ基準1〜3に該当する不具合なし。差分は4ファイル（filter.ts / x.ts / テスト2本）のみで、他ソース・スキーマ・hotnessに波及なし |
| コンソールエラー0件 | PASS | `vitest` / `tsc` / `build` / `lint` すべてエラー出力なし。UIなしのためブラウザコンソールは対象外 |
| 受け入れ基準充足率100% | PASS | 基準1〜3を個別確認（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **Test Files 119 passed / Tests 1659 passed**（failed 0、34.24s） |

## 受け入れ基準の個別確認
- **基準1（test/tsc/build/lint）**: PASS
  - `npx vitest run` → 1659 passed / 0 failed。
  - `npx tsc --noEmit` → 出力なし・exit 0。
  - `npm run build` → 成功（ルート一覧まで出力、`.next/BUILD_ID` 更新を確認）。
  - `npm run lint` → **0 errors** / 6 warnings（`site-header.tsx`のno-img-element、テスト内の未使用`_messages`等。いずれも本スプリント無関係の既存warning、変更ファイル由来ではない）。
- **基準2（バイパス・commentCount合算・議論クエリ・hotness不変）**: PASS
  - (a) `filter.ts:49` に `if (item.sourceType === "x") return true;` を`riot-news`バイパス直後に追加。reddit（サブレディット許可リスト）・5ch/riot（キーワード一致）の分岐は**行単位で無変更**（diffは追加5行のみ）。テスト`collection-filter.test.ts`でLoLキーワード非一致タイトル（`#LJL 今日の試合…`）がtrueになることを確認。
  - (b) `x.ts:160` `commentCount: (tweet.replyCount ?? 0) + (tweet.quoteCount ?? 0)`。`quoteCount?: number` は `GetXApiTweet` 型（x.ts:113）に**変更前から実在**するフィールド（diffに型定義の追加なし＝捏造でない）。`score: tweet.likeCount ?? 0` 他のマッピングは無変更。`fetchTweetsForQuery` は `json?.tweets` をそのまま返すためフィールド落ちなし。テストで `replyCount:48 + quoteCount:12 → 60`、`score=320`不変を確認。
  - (c) `DISCUSSION_QUERY = '(LoL OR LJL OR "リーグ・オブ・レジェンド") min_replies:30 min_faves:30 lang:ja -filter:retweets'` を追加し `DEFAULT_SEARCH_QUERIES` が3本（国内/海外/議論特化）。テストで `parseSearchQueries(undefined/""/"   ")` が3件、うち1件が`min_replies:`含有、`X_SEARCH_QUERIES`指定時はカスタムのみ（`min_replies:`を含まない）を確認。
  - (d) `src/lib/hotness/evaluator.ts` は **git diff空＝完全無変更**（`isControversial`の判定式・閾値とも不変。変わったのは入力値のみ）。
  - (e) `prisma/` は **git diff空＝スキーマ変更なし**。`package.json` も未変更（新規依存なし）。
- **基準3（スキーマ/依存/回帰/コスト）**: PASS
  - `git status` の変更は `src/lib/collection/filter.ts` / `src/lib/collection/adapters/x.ts` / テスト2本のみ。
  - `pbe-x-source.ts` は `parseSearchQueries(raw, [DEFAULT_PBE_QUERY])` と自前既定を渡すため、既定3件化の影響を受けない（回帰なし）。
  - `X_API_KEY` 未設定時は `fetchItems()` 冒頭でスキップし空配列を返す分岐が無変更＝キー無しで$0。キー設定時のみ収集runあたり+1コール。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- `x.ts:195` の `XAdapterOptions.queries` のJSDocが「未設定時は既定クエリ**2件**」のまま（実装は3件）。クラス本体のコメントは3件に更新済みなので、この1行だけ古い記述が残っている（動作影響なし）。
- Xバイパスにより、X由来アイテムはキーワード関連判定を一切通らなくなる。検索クエリのoperatorが唯一の関連性担保となるため、将来 `X_SEARCH_QUERIES` env を緩いクエリで上書きすると無関係投稿が保存され得る（今回の受け入れ基準の範囲外・仕様どおりの設計判断）。

## 未検証項目（実機確認が必要）
- GetXAPIへの実HTTPリクエストによる `quoteCount` の実データ返却有無（`X_API_KEY` opt-in・従量課金のため未実行）。型上は既存フィールドで、未提供時も `?? 0` により従来どおり `replyCount` のみとなり安全側にフォールバックする。
- 議論特化クエリ（`min_replies:30`）が実際にヒット件数を返すかの本番確認（同上、実APIコール未実行）。
- 実収集ランでのX saved件数が0でなくなること（本番/実データ実行が必要）。

## プレビュー画像
- 該当なし（UIを持たない変更のため）。

## 関連ドキュメント
- [[x-reply-s1-selfeval]]（ジェネレーターの自己評価レポート）
- [[x-reply-s1-brief]]（本スプリントの仕様抜粋）
