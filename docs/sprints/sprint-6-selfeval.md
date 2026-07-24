---
tags: [sprint-selfeval]
sprint: 6
---

# Sprint 6 自己評価レポート

## 実装した内容
- `Article` に公開状態を追加（Prisma マイグレーション `20260724215900_add_article_moderation_status`）:
  - `status`（既定 `"published"`。値: `"published"` | `"held"`）
  - `heldReason`（保留理由コード: `ng_word` / `missing_source` / `personal_attack` / `duplicate`）
  - `heldDetail`（保留理由の人間可読な詳細メッセージ）
  - `unconfirmed`（未確定・噂レベル情報の「未確認」ラベル対象フラグ）
  - 既存行は既定値で自動的に `status="published"` になる（マイグレーションで確認済み）。
- 安全フィルタ本体を `src/lib/moderation/` に新設（LLM非依存の決定論的純関数）:
  - `ng-words.ts`: NGワードリスト＋検出/除去関数を一元化。**Sprint 5 の `generation/title.ts` の暫定 `NG_WORDS`/`stripUnsafe` はこちらを呼ぶだけに書き換え、二重管理を解消**。
  - `personal-attack.ts`: 人物名パターン（◯◯選手/さん/氏 等・英字固有名詞）＋攻撃語の同一文共起、または個人情報暴露キーワード（本名は／住所は等）で中傷・晒しを検出。
  - `rumor.ts`: 噂・未確定を示すマーカー語検出（「未確認」ラベルの対象判定）。
  - `duplicate.ts`: F6 と同じ文字bi-gram Jaccard類似度（`collection/similarity.ts` 流用）で既存公開記事との重複を検出。
  - `moderate.ts`: 上記を統合し `moderateArticleContent()` で `published`（+`unconfirmed`）/`held`（+理由）を1回で判定。
  - `queue.ts`: 保留キュー読み取り `listHeldArticles()`。
- `src/lib/generation/pipeline.ts`: 生成直後に `moderateArticleContent` を実行し、通過なら `status="published"`、不通過なら `status="held"`＋理由を設定して `Article` を作成（CollectedItem は生成成功として `articled` のまま。二重生成を防止）。重複判定は直近公開記事プール（最大200件、実行内で公開した記事も追加）と比較。
- 閲覧系クエリを「公開済み(`status="published"`)のみ」に限定: `listArticles`/`listArticlesByCategory`/`listArticlesByTag`/`listPopularArticles`/`listRelatedArticles`/`searchArticles`/`getArticleBySlug`（`src/lib/articles.ts`・`src/lib/search.ts`）。`getArticleBySlug` は保留記事の slug を直接叩いても null（404）を返す。
- 記事個別ページ（`src/app/articles/[slug]/page.tsx`）に「未確認情報」ラベル（メタ情報の赤バッジ＋本文上部の注意書き）を追加。
- `scripts/generate.ts` の出力に公開/保留ステータスを表示。
- `README.md` に F9 安全フィルタの挙動を追記。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の決定論的純関数方針（Vitest・LLM非依存）を踏襲。重複判定は F6 で確立済みの文字bi-gram Jaccard類似度をそのまま再利用（新規アルゴリズム導入を避け一貫性を優先）。

## 受け入れ基準チェック（自己申告）
- [x] 記事は「安全フィルタ通過」状態にならない限り公開されず、公開記事は必ずフィルタ通過済みである: 生成パイプラインが `moderateArticleContent` の結果で `status` を確定させ、それ以外の経路（seed）は元々安全な固定コンテンツのため `published` 既定で問題ない。閲覧系クエリは全て `status="published"` を条件に含む。
- [x] 定義済みNGワード（差別語・過度な暴言等）を含む記事は保留となり公開されない: 単体テストで確認。実機確認でも「カス」を含む生成記事が `status="held", heldReason="ng_word"` になり、`listArticles()`・`getArticleBySlug` から除外されることを確認。
- [x] 出典リンクを持たない記事は保留となり公開されない: `moderateArticleContent` が `sourceCount<=0` で `missing_source` を返すことを単体テストで確認。生成パイプライン経路では上流（`generate-article.ts`）で出典URL欠落の候補はそもそも `GenerationError` になり記事化されないため、実質的にも出典欠落記事が公開されることはない（多重防御）。
- [x] 特定個人を名指しで中傷／晒す内容と判定された記事は保留となり公開されない: 単体テスト（人物名+攻撃語／個人情報暴露キーワード）で確認。実機確認でも「田中選手は本当に無能だ」を含む生成記事が `held/personal_attack` になることを確認。
- [x] 保留記事は保留理由（NGワード／出典欠落／重複／中傷等）付きで保留キューに記録され、公開キューに入らない: `Article.heldReason`/`heldDetail` に記録し、`listHeldArticles()` で参照可能。閲覧系クエリからは除外を実機確認（漏洩件数=0）。
- [x] 未確定・噂レベルの表現を含む記事は「未確認」ラベルが付与された上で公開される: 単体テストおよび実機確認（`unconfirmed=true` で公開され、記事ページにラベル表示）で確認。
- [x] 安全な通常記事はフィルタを通過して公開状態になり、閲覧サイトに表示される: シード12件・収集→生成6件がいずれも `published` になり、トップページ等に表示されることをビルド・起動・curl確認済み。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev   # 本スプリントのマイグレーション(20260724215900_add_article_moderation_status)を含め適用
npm run db:seed          # サンプル記事12件（すべてpublished）
npm run dev              # http://localhost:3000
```
- 生成パイプライン確認: `npm run collect` → `npm run generate`（`status=published`/`held(理由:...)` がコンソールに表示される）
- テスト: `npm test`（Vitest, 115件）
- 本番相当確認: `npm run build && npm run start`

## 既知の問題・懸念点
- **重複検出(duplicate)の実効性には限界がある**: F9の重複判定は F6 と同じ文字bi-gramのJaccard類似度（既定しきい値0.5）を、生成後の最終記事（テンプレートで大きくリライトされた本文）に対して適用する。実機確認で、同一の元ソースを候補として2回生成させたところ、リライトの度合いが大きいと類似度が0.5を下回り重複と判定されないケースを確認した（単体テストでは同一に近い本文で正しく検出できることを確認済み）。極端に近い内容（ほぼ同一文）は確実に検出できるが、表現が大きく変わる同一トピックの記事は見逃す可能性がある。既存のF6用アルゴリズムをそのまま流用したための特性であり、閾値調整やアルゴリズム変更はスコープ外と判断し見送った。
- `regenerateArticleTitle`/`regenerateAllArticleTitles`（Sprint5由来）はタイトル再生成後に安全フィルタを再実行しない。タイトル生成自体が共通NGワードで除去処理済みのため実害は限定的だが、再生成によりNGワード付きタイトルになった場合の再保留化は本スプリントでは未実装（Sprint5機能の追加改修でスコープ外と判断）。
- 出典欠落チェックは生成パイプライン経路では上流の `GenerationError` により実質到達しないため、実機での「出典欠落→held」の直接シナリオは単体テストでのみ検証（`sourceCount=0` を直接渡すケース）。将来、生成以外の経路（手動投入等）が増えた場合に備えた多重防御として有効。
- 保留キュー（`listHeldArticles`）は読み取り関数のみ実装。閲覧・再審査用の管理画面は Sprint 9（運営監視ダッシュボード）のスコープと判断し、本スプリントでは実装していない。

## 追加したテスト
- `src/lib/__tests__/moderation.test.ts`（新規、18ケース）:
  - `findNgWord`/`stripNgWords`: NGワード検出・除去（合格/不合格双方）
  - `detectPersonalAttack`: 人物名+攻撃語での検出／個人情報暴露での検出／人物名のみ(攻撃語なし)は非検出／チャンピオン名等一般名詞は非検出
  - `containsRumorMarker`: 噂マーカーの検出/非検出
  - `findDuplicateArticle`: 高類似度での重複検出／無関係記事での非検出
  - `moderateArticleContent`: 通常記事published／NGワードheld／出典欠落held／中傷held／重複held／未確認ラベル付きpublishedの統合ケース
- 既存97件+新規18件=115件、`npm test` で全件Green確認済み。

## 関連ドキュメント
- [[sprint-6-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
