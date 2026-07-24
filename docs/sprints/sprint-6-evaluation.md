---
tags: [sprint-evaluation]
sprint: 6
result: PASS
---

# Sprint 6 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機） + Bash/curl（HTTPステータス・DB直接確認）
- Playwright MCP でブラウザ操作可能。加えて curl でHTTPステータス、tsx スクリプトでクエリ関数/DB状態を直接検証。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | E2E（seed→collect→generate）成功、生成6件published/0失敗。閲覧・404・ラベルすべて期待通り |
| コンソールエラー0件 | PASS | トップ・未確認記事ページともに console error 0件。保留slugの404ページのみ「Failed to load resource: 404」が出るが、これは保留記事が404を返すという受け入れ基準の意図した挙動そのもの（アプリのJSエラーではない） |
| 受け入れ基準充足率100% | PASS | 下記7項目すべて充足（詳細は下記） |
| テストGreen（全テスト成功） | PASS | `npm test`（Vitest）: 18ファイル / 115件 全passed |

## 受け入れ基準の個別検証
- 公開記事は必ずフィルタ通過済み: PASS。閲覧系クエリ（listArticles/ByCategory/ByTag/Popular/Related/search/getArticleBySlug）はすべて `status="published"` を条件に含む（`src/lib/articles.ts` の `PUBLISHED_ONLY` を全経路で経由）。生成パイプラインは `moderateArticleContent` の結果で status を確定。
- NGワード記事は保留: PASS。`moderateArticleContent({title:"あいつは死ねばいい",...})` → `held/ng_word「死ね」`。
- 出典欠落記事は保留: PASS。`sourceCount:0` → `held/missing_source`。
- 特定個人の中傷は保留: PASS。「田中選手は本当に無能だ」→ `held/personal_attack`（人物名「田中選手」+攻撃語「無能」同一文共起）。
- 保留理由付きで保留キューに記録・公開キューに入らない: PASS。held記事は `heldReason`/`heldDetail` に記録。DBにheld fixtureを投入し、listArticles/listPopularArticles（viewCount 9999でも）/listArticlesByCategory/search いずれからも除外を確認。slug直アクセスは HTTP 404（curl・ブラウザ・getArticleBySlug=null すべて一致）。
- 未確定・噂は「未確認」ラベル付きで公開: PASS。`unconfirmed=true` で published、記事ページに「未確認情報」バッジ＋本文上部の注意書きを実ブラウザで表示確認。rumorマーカー（噂/リーク情報/真偽不明等）で `containsRumorMarker` 検出。
- 安全な通常記事は公開され表示される: PASS。seed12件＋生成6件=18件すべて published、トップに表示（held fixtureは非表示）。
- （追加）重複記事は保留: PASS。同一本文を既存プールに持たせると `held/duplicate`。

## 実施した検証の要点
- `npm test` → 115件Green（安全フィルタ判定の単体テスト18件含む）。
- E2E: `npm run db:seed`（12件）→ `npm run collect`（queued=6）→ `npm run generate`（success=6, published=6, failure=0）。
- `moderateArticleContent` を現実的な不正入力（NGワード/出典欠落/中傷/噂/重複）で直接実行し、held理由・unconfirmedが正しく返ることを確認。
- held/unconfirmed の fixture をDB投入 → `npm run build && npm run start`（PORT=3100）で起動し、閲覧除外・404・ラベル表示を curl とブラウザで確認。検証後 fixture は削除しDBを原状復帰（total 18 / held 0）。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 重複検出（duplicate）は生成後のリライト度合いが大きいと類似度が閾値0.5を下回り見逃す可能性がある（self-eval 既知の懸念と一致）。ほぼ同一本文は確実に検出。本スプリントのスコープ外の閾値調整事項。
- `regenerateArticleTitle`（Sprint5由来）はタイトル再生成後に安全フィルタを再実行しない。共通NGワード除去済みのため実害は限定的。

## 未検証項目（実機確認が必要）
- 生成パイプライン経路での「出典欠落→held」の直接シナリオは、上流 `generate-article.ts` が出典URL欠落候補を先に `GenerationError` にするため到達せず、単体テスト（`sourceCount=0` 直接投入）でのみ検証。多重防御として妥当。
- それ以外に環境制約由来の未検証項目は該当なし。

## プレビュー画像（PASS）
- `sprint-6-preview-1.png`（未確認情報ラベル付き記事ページ）
- `sprint-6-preview-2.png`（トップ一覧・保留記事非表示）

## 関連ドキュメント
- [[sprint-6-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-6-brief]]（本スプリントの仕様抜粋）
