---
tags: [sprint-evaluation]
sprint: admincms-S2
result: PASS
---

# Sprint admincms-S2 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・`npm run build` → `npm run start` の本番ビルドをlocalhost:3000で起動）
- Basic認証はブラウザのクレデンシャルキャッシュ経由で通過（資格情報は本レポートに記載しない）。
- **X経路の実取得は X_API_KEY 未設定のため未検証**（既定＝無課金構成。下記「未検証項目」参照）。
- 検証前に `prisma/dev.db` をバックアップし、検証後に復元済み（記事・Post・実行ログの追加は全て巻き戻し、`git status` はスプリント成果物のみ）。

## ビルド系の結果（必須項目）
| コマンド | 結果 |
|---|---|
| `npx vitest run` | **PASS** 142ファイル / **1949テスト 全Green**（exit 0, 35.1s） |
| `npx tsc --noEmit` | **PASS** エラー0（exit 0） |
| `npm run build` | **PASS** 成功（exit 0・全ルート生成） |
| `npm run lint` | **PASS** `0 errors, 7 warnings`（警告はすべて既存ファイル: img要素・未使用`_`変数。今回追加ファイル由来の警告なし） |

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 受け入れ基準の全操作を実機再現し、記事非作成・二重作成・不変条件破りは0件 |
| コンソールエラー0件 | PASS | `/admin`・プレビュー・各操作後の`browser_console_messages`が毎回 0 errors / 0 warnings。ネットワークも全て200（server actionのPOST /admin ×3含む） |
| 受け入れ基準充足率100% | PASS | 検証可能な基準は全て充足（X実取得依存の4項目は分母から除外・下記に明記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` 1949件全Green。新規3ファイル32件も単体実行でGreen |

## 実機で確認した受け入れ基準（要点）
- **パネル存在**: `/admin` に「指定URLから記事化」・URL入力欄・「記事化する」・対応URL形式の説明（X/Reddit・5ch対象外・Hotness無視の旨）が表示。
- **Reddit実記事化（実ネットワーク・Arctic Shift・キー不要）**: `https://www.reddit.com/r/leagueoflegends/comments/1va8t8n/i_wish_we_had_old_health_bars_in_classic/` を入力し**実クリック**→ボタンが `実行中...`＋disabled（入力欄もdisabled）→「記事を作成しました」＋プレビュー/編集リンク表示。
- **レビューキュー出現・公開側非露出**: 作成記事は `status="review"`、`/admin` の「未レビュー」バッジが 0→1→2→3 と増加。公開側は トップ/検索(4種クエリ)/カテゴリ/タグ/アーカイブ/`sitemap.xml`/`news-sitemap.xml`/`feed.xml`/`/api/*` いずれにも `manual-` slug の露出0件、個別URL `/articles/manual-...` は**404**（3記事とも）。公開記事ページの関連記事にも0件。
- **プレビュー内容**: カテゴリ「海外の反応」バッジ、`redditSource`ブロック（原題 `I wish we had old health bars in Classic` / `by u/michixinq in r/leagueoflegends` / 「Redditで見る」＝元スレURLリンク）、「反応まとめ」見出し＋コメント由来のレスブロック14個。スクリーンショット `admincms-s2-preview-2.png`。
- **URL正規化＋二重防止**: 同一スレを `https://old.reddit.com/r/LeagueOfLegends/comments/1va8t8n/...`（末尾スラッシュ無し・サブ名大文字違い・`?utm_source=share&utm_medium=web`）で再投入→「この URL は記事化済みです」＋既存記事(同一ID)へのプレビュー/編集リンク。未レビュー件数は増えず、DBも `Post`/`Article` 各1件のまま。
- **Hotness迂回**: score=1 / comments=1 の低調スレ（`1vcirp0`）でも弾かれず「記事を作成しました」。
- **X（キー未設定・既定）**: `https://x.com/<user>/status/<id>` → 「X の API キーが未設定のため利用できません」・記事非作成（件数不変）。`https://twitter.com/<user>/status/<id>?s=20` も同一メッセージ＝X経路として正しくパースされている。**同じ画面で直後にReddit URL（`1va91rs`）を実行して正常に「記事を作成しました」**。
- **入力エラー**: `https://example.com/foo`→「この URL 形式には対応していません」／空文字・`abc`→「有効なURLを入力してください」／存在しないスレ `.../comments/zzzzzzz/...`→「指定のRedditスレッドが見つかりません（削除済みの可能性があります）」。いずれも未レビュー件数不変・DB上も記事/Post増加0（空記事・本文欠落記事は発生せず）。
- **二重送信防止（連打）**: 未記事化URL（`1va9jbz`）に対し同一tickで5回＋pending中に5回、計10クリック→DB上 `Post` 1件・`Article` 1件のみ。pending中はボタン/入力欄がdisabled。
- **安全フィルタ**: `manual-article.ts` が `moderateArticleContent` を通し、不通過時 `status="held"`＋`heldReason`/`heldDetail` を保存する実装を確認。NGワードは全て日本語語彙のため実Reddit（英語）では誘発不能→`manual-article.test.ts` のNGワードheldテスト（Green）で担保。
- **非回帰**: 手動記事化後に `npm run pipeline` を1回実行→exit 0・`統合パイプライン完了`・`PipelineRunLog` に `status="success"`（収集14/候補4）が記録され、既存の実行ログ表示も従来どおり。差分は `src/app/admin/{actions.ts,page.tsx}`＋新規ファイルのみでパイプライン系コードは無変更。
- **S1機能の非回帰**: レビューキューからの「却下」→`status="rejected"`・キュー件数3→2、「承認して公開」→`status="published"` となり公開トップに掲載・個別URL 200。プレビュー画面（S1）も手動記事で正常表示。

## 発見したバグ・問題点（FAILの原因）
なし。

## 軽微な改善点（ブロッカーではないもの）
- 連打時、最終的にパネルへ残る文言が「この URL は記事化済みです」になることがある（同一tick内の複数submitのうち後発が二重防止分岐に入るため）。記事は1件しか作られず実害はないが、初回作成時のメッセージが上書きされ運営者には分かりにくい。
- 手動記事の `publishedAt` が要レビュー段階で既に設定される（公開判定は `status` 基準のため露出はしないが、意味論として承認時セットの方が自然）。
- 英語Redditスレでは `seo.tags` が空になり `ArticleTag` が0件で作成される（自動収集記事と同様の挙動でmock LLM環境依存。live LLMでは要再確認）。
- パネルのURL入力欄はplaceholderのみでラベル要素が無い（`aria-label`等が無く支援技術では用途が伝わりにくい）。

## 未検証項目（実機確認が必要）
- **X実取得（要 X_API_KEY）**: 以下4基準は資格情報未設定のため実機検証不能（充足率の分母から除外）。
  - X投稿URLからの記事作成・カテゴリ「Xの反応」・元ポスト/返信/引用ブロック・出典URL表示
  - `twitter.com/...?s=20` で「同じ投稿として取得され記事が作成される」こと（URLパース＝X判定までは実機確認済み）
  - 返信0件のX投稿で本文が空にならないこと（`manual-article.test.ts` で担保）
  - 削除済みX投稿での日本語エラー（`manual-article-fetch.test.ts` で担保）
  - 自己評価レポート記載のとおり、単発取得エンドポイント `GET /twitter/tweets?tweet_ids=` はGetXAPI公式仕様未確認の設計仮定。**キー投入前に実APIへの疎通確認が必要**。
- **レート制限(429)・認証エラー(401/403)時の日本語メッセージ**: 実APIで意図的に誘発できないため `manual-article-fetch.test.ts`（Green）で担保。
- **NGワードによるheld**: NG語彙が日本語のみで英語Redditからは誘発不能。コード経路＋テストで担保。
- **カテゴリ公開ポリシーのトグル操作**: ツール側の安全分類器がクリック操作を拒否したためUI実操作は未実施（S1で検証済み・関連テストGreen。今回の差分はポリシー参照経路に触れていない）。
- **LLM live時の日本語タイトル/翻訳品質**: 本検証はAPIキー未設定のmock LLMのため、生成タイトル・海外コメントの翻訳は実運用時と異なる。

## プレビュー画像
- `admincms-s2-preview-1.png`（/admin: 指定URLから記事化パネル＋レビューキュー）
- `admincms-s2-preview-2.png`（手動作成記事のプレビュー: カテゴリ「海外の反応」・元スレブロック・レスブロック）

## 関連ドキュメント
- [[admincms-s2-selfeval]]（ジェネレーターの自己評価レポート）
- [[admincms-s2-brief]]（本スプリントの仕様抜粋）
