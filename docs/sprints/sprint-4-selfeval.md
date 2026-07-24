---
tags: [sprint-selfeval]
sprint: 4
---

# Sprint 4 自己評価レポート

## 実装した内容
- `src/lib/generation/` を新設（architecture.md の `LLMClient` 抽象・純関数方針に準拠）
  - `llm-client.ts`: `LLMClient` インターフェース + 決定論的モック実装 `MockLLMClient`（APIキー不要）。`GENERATION_MODE`（既定`mock`）で `live` 指定時は本接続未実装を示す明示エラー（`adapters/index.ts` の mock/live 切替と同じ構造）。
  - `text-utils.ts`: 文分割・短い手がかり(gist)抽出・引用抜粋(excerptForQuote)の純関数（逐語コピー回避の土台）。
  - `verbatim.ts`: 逐語一致率判定（文字12-gramの被覆率、LLM非依存の純関数）。`computeVerbatimMatchRatio`/`isVerbatimCopy`。
  - `quote-ratio.ts`: 引用の主従関係判定（引用ブロック文字数/全体文字数、LLM非依存の純関数）。`computeQuoteRatio`/`hasAcceptableQuoteRatio`。
  - `compose.ts`: 構成分岐（reddit/5ch→「話題→寄せられた反応→まとめ」、riot→「速報→要点整理→まとめ」）。`LLMClient.generate()`をリライト文取得に必ず経由し、引用は原文の一部(最大50%・上限30字)のみ使用。
  - `generate-article.ts`: 最低300字・逐語一致率・引用比率・出典必須を検証し、満たさなければ `GenerationError`。
  - `pipeline.ts`: DB連携。記事化候補キュー(status=queued)を1件ずつ処理し、成功時は `Article`+`ArticleSource`作成と`CollectedItem`(articleId+status="articled")の更新を1トランザクションで原子的に実行。失敗時は`status="generation_failed"`+`generationError`を記録し、他候補の処理を継続。
- `prisma/schema.prisma`: `CollectedItem.generationError`(String?)を追加、`status`コメントに`generation_failed`を追記。マイグレーション`20260724210443_add_generation_error`を作成・適用済み。
- `scripts/generate.ts` / `npm run generate`: 生成パイプラインの単独実行スクリプト（`npm run collect`の後に実行する想定）。
- `.env.example`・`README.md`: `GENERATION_MODE`（任意・既定mock）を追記。

## 技術選定（該当する場合のみ）
- LLMはarchitecture.md・brief記載の通り、当スプリントは決定論的モック実装のみ（ユーザー決定によりAPIキー要求なし）。`LLMClient`抽象は維持し、後日Anthropic実装を`getLLMClient()`のlive分岐に追加すれば呼び出し側の変更は不要。
- 逐語一致率はF6の類似度判定(bi-gram Jaccard、話題の近さを緩く見る)とは別に、より長いn-gram(12文字)の被覆率という指標を新設。目的が異なる（コピー検出 vs 話題類似度）ため既存`similarity.ts`は流用せず別モジュールにした。

## 受け入れ基準チェック（自己申告）
- [x] 見出し・段落を持つ構造化された日本語まとめ記事本文（最低300文字以上）が生成される: `generate-article.ts`で検証・テスト済み。実データ(fixture 8件中生成対象7件)全て400〜600字台で生成。
- [x] 生成本文と元ソース本文の逐語一致率が定めた閾値(0.5)以下: `computeVerbatimMatchRatio`で判定。実データで0.06〜0.39の範囲(閾値未満)を確認。単体テストで合格例・不合格例(完全コピー)の両方を検証。
- [x] 構成分岐: riot→「速報/要点整理/まとめ」、5ch/reddit→「話題/寄せられた反応/まとめ」。`generation-compose.test.ts`で見出し配列を検証。
- [x] 出典リンクが本文または末尾に必ず含まれる: `ArticleSource`として必ず1件保存（`generateArticleForCandidate`が出典URL無しの候補を`GenerationError`にする）。ブラウザ確認で個別記事ページの「出典」欄にリンク表示を確認。
- [x] 引用が過大でない主従関係: `computeQuoteRatio`(閾値0.4)で判定。実データで0.04〜0.13の範囲。単体テストで「引用が大半」の不合格例も検証。
- [x] 生成に失敗した候補は「生成失敗」として記録され、他候補は継続: `generate-article.ts`のバリデーション失敗→`GenerationError`→`pipeline.ts`が捕捉し`status="generation_failed"`+`generationError`を記録、ループ継続。`generation-generate-article.test.ts`で「1候補が逐語コピー相当のLLM応答で失敗しても、別候補は正常に生成できる」ことを確認。
- [x] Sprint 1個別記事ページで正しく表示される: `npm run start`後、生成した記事(5ch/reddit/riot各1件)のページを`curl`で取得しHTMLを確認。見出し(h2)・段落・出典リンク・引用(blockquote)が崩れず表示された。

## 候補の状態同期（Sprint 3申し送り対応）の確認結果
- `pipeline.ts`で`prisma.$transaction`によりArticle作成・ArticleSource作成・CollectedItem更新(`articleId`+`status="articled"`)を原子的に実行。
- 実機確認: `npm run db:seed`→`npm run collect`(queued=6)→`npm run generate`(success=6)→DB確認で6件全て`articleId`が設定され`status="articled"`に同期済みであることを確認。
- `npm run collect`を再実行しても、既にarticleId設定済みの行は再候補化されない(articleId=nullの行のみが対象という既存Sprint3ロジックにより除外される)ことを確認。
  - 例外1件: `duplicate`状態だった行(articleIdはnull)が、canonical側が記事化されて候補プールから外れた結果、次回rebuild時に単独候補として再度`queued`になった。これはSprint 3の`dedupe.ts`(記事化候補プールの構成方法)由来の既存挙動であり、Sprint 4のスコープ外(同一アイテムの二重記事化ではなく、別URLの類似トピックが独立記事になる旨の既知の限界)。`npm run generate`で正常に処理でき、二重記事化(同一CollectedItemが2つのArticleに紐づく等)は発生しないことを確認済み。

## テスト実行結果
- `npm test`（Vitest）: **84件全てGreen**（既存67件 + 今回追加17件: verbatim 4件・quote-ratio 4件・compose 4件・generate-article 5件）。
- `npx tsc --noEmit`: エラー0件。
- `npm run build`（`next build`）: 成功（Turbopack、静的/動的ルート生成含め正常終了）。

## 生成の実行方法と結果
```bash
npm run db:seed   # サンプル記事12件を再投入
npm run collect   # reddit/5ch/riotから収集 → 重複排除 → 記事化候補キュー再構築
npm run generate  # 記事化候補キュー(status=queued)から記事を生成・保存
```
- 実行結果（自己確認時）: `collect`でqueued=6、`generate`で`success=6 failure=0`。その後の再`collect`で残1件がqueued化し、再`generate`で`success=1`。最終的に収集アイテム8件中7件が実際にArticleへ生成・同期済み（残り1件はSprint3由来の既存URL一致による`articled`でarticleId=null、Sprint3側の挙動）。
- 生成された記事は`/articles/gen-<collectedItemId>`のスラッグで保存される（本格タイトル/スラッグ生成はSprint 5のF8で対応予定、今スプリントは仮タイトル=候補の原題をそのまま使用）。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run collect
npm run generate
npm run dev      # http://localhost:3000 で開発サーバー起動
# または本番相当: npm run build && npm run start
```
- 生成済み記事の確認: トップページ(`/`)一覧、または個別記事ページ`/articles/<slug>`（例: `npm run generate`のログに出力される`slug=gen-...`）。

## 既知の問題・懸念点
- タイトルは仮タイトル（候補の原題そのまま）。本格的な煽り速報タイトル生成はSprint 5(F8)で実装予定（brief記載の通り想定内）。
- LLMは決定論的モック実装のみ。本接続(Anthropic Claude)はユーザー決定によりスキップ（`docs/project-memory.md`記載の既知の課題と同じ方針）。
- Sprint 3由来の候補キュー挙動（duplicate行がcanonical記事化後に単独候補として再浮上するケース）を確認したが、これはSprint 3のdedupeロジックの既存特性でありSprint 4のスコープ外。二重記事化(同一収集アイテムが複数記事に紐づく)は発生しないことを確認済み。
- 生成パイプラインのDB連携部分(`pipeline.ts`)自体の自動テストは未実装（Sprint 3の`collection/pipeline.ts`・`queue.ts`と同様の方針で、DB連携は自己確認スクリプト実行で検証し、判定ロジック本体は純関数として単体テストする方針を踏襲）。実機確認は上記の通り実施済み。

## 追加したテスト
- `src/lib/__tests__/generation-verbatim.test.ts`: 完全コピー→高一致率、要約再構成文→低一致率、空ソース、しきい値境界のケース。
- `src/lib/__tests__/generation-quote-ratio.test.ts`: 引用無し/少数/過大の3パターンと空配列。
- `src/lib/__tests__/generation-compose.test.ts`: riot→速報/要点整理/まとめ、5ch・reddit→話題/寄せられた反応/まとめの見出し構成、引用ブロックの出典付与。
- `src/lib/__tests__/generation-generate-article.test.ts`: 成功パス（最低文字数・出典・カテゴリ分岐）、失敗パス（出典URL無し・内容空・逐語コピー相当のLLM応答）と、1候補の失敗が他候補の生成を妨げないことの確認。

## 関連ドキュメント
- [[sprint-4-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
