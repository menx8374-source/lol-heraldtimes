---
tags: [sprint-selfeval]
sprint: resel-S3
---

# resel-S3 自己評価レポート

## 実装した内容
- `src/lib/generation/llm-client.ts`: `GenerationTask`に`kind:"ng-soften"`（`sentences:{index,text}[]`）を追加。mock `renderTask`は`ng-soften`で常に空文字を返す（`renderNgSoften`）。
- `src/lib/generation/compose.ts`:
  - `NG_SOFTEN_SYSTEM_PROMPT`（静的・動的値なし）を新設・export。役割・厳守事項（事実/数値/固有名詞不改変・新情報禁止・意味反転禁止・NG語を残さない）・出力JSON形式`{"softened":[{"index","text"}]}`を明記。
  - `normalizeSoftened`（LLM生JSONの形式検証、既存`normalizeTranslations`と同様のパターン）。
  - `softenNgSentences(llmClient, sentences)`: 1回のLLM呼び出しでバッチ送信→`findNgWord`で再検査→NG語が残る/空/欠落は不採用→採用分のみMapで返す。API失敗・空応答・parse不能・全件不採用は空Map（例外を投げず本体を止めない）。
  - `ngRephraseMode()`: env `NG_REPHRASE_MODE`（soften/remove/mask、既定soften）。
  - `.env.example`: `NG_REPHRASE_MODE`（soften既定/remove/mask）の説明とコメントアウト既定値を追加。

### コスト最適化リファインメント（追記）
- **問題**: evaluatorが検出した軽微点。旧`cleanNgSentencesInLines`/`buildReactionDisplayLines`は**レス単位**で呼ばれており、NGを含むレスがN件あると`softenNgSentences`（ng-soften、LLM）もN回呼ばれていた（翻訳=1記事1バッチと不整合・コスト増・429リスク）。
- **対応**: `resolveReactionDisplayLines`（表示テキスト確定のみ、純関数・LLM不使用）と`buildReactionLinesBatch`（新設）を導入。
  - `buildReactionLinesBatch(entries, llmClient)`: 呼び出し側（1記事分の全選定済みレス/リプライ）から`{key, extractedLines, translatedText}[]`を受け取り、各エントリの表示テキスト・強調・文分割を先に確定 → **全エントリ横断でNG文を1回だけ収集**（通し番号を振る）→ `NG_REPHRASE_MODE=soften`かつNG文が1件以上のときだけ**`softenNgSentences`を記事全体で最大1回**呼ぶ → 結果（再検査済み）を各エントリに配って最終行を組み立て、`Map<key, lines>`で返す。
  - `buildReactionBlocks`（5ch/reddit）: 選定済み全レスをまとめて`buildReactionLinesBatch`に1回渡すよう変更（旧: レスごとに`Promise.all`内で個別呼び出し）。
  - `buildXReactionBlocks`（X）: 同様に選定済み全リプライをまとめて1回`buildReactionLinesBatch`に渡すよう変更。
  - 旧`cleanNgSentencesInLines`/`buildReactionDisplayLines`（レス単位の非同期関数）は削除し、上記に統合。
  - **挙動不変を担保**: soften結果の採用条件（`findNgWord`再検査でNG語残存/空/欠落は不採用）・削除フォールバック・`remove`/`mask`モード分岐・非NG文の逐語維持・NG無し記事/レスでのLLM未呼び出し・全行不採用レスの不掲載は一切変更していない（呼び出し回数のみ記事単位に統合）。

## 技術選定
- 新規ライブラリ追加なし。既存のLLM呼び出し抽象（`llm-client.ts`のバッチJSON方式、`translateReactionLines`と同一パターン）・既存の伏字機構（`maskNgWords`）をそのまま再利用。スキーマ変更（`article-body.ts`の型）は行っていない。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run`全Green（125ファイル/1762テスト、コスト最適化の新規2テスト含む）、`tsc --noEmit`エラー0、`npm run build`成功、`npm run lint`エラー0（既存の無関係な警告7件のみ、本スプリントの変更に起因しない）。
- [x] NG文はsoften時にLLM言い換え結果（再検査済み・NG語なし）で表示される（削除されない）。言い換え不可時（再検査でNG語残存・空応答・parse失敗）は従来どおり削除にフォールバック。非NG行・非NG文は逐語（変更なし）。5ch/reddit/X全経路（`buildReactionLinesBatch`共有）に適用。
- [x] 事実/数値/固有名詞はcompose側で改変・捏造しない（NG_SOFTEN_SYSTEM_PROMPTで指示し、compose側はLLMが返した言い換え文をfindNgWordで再検査するだけで内容を書き換えない設計）。スキーマ変更なし・新規依存なし。コスト最小（NG文を含む記事のみ、かつ**1記事(=1回のbuild呼び出し)につきng-soften最大1回**にまとめてLLMへ送る。NG文が無い記事・リプ集合はLLM未呼び出し）。mock/off時（既定`GENERATION_MODE=mock`）は既存の全テストが回帰なしでGreen。
- [x] **【今回の追加要件】1記事あたりng-soften最大1回を実装・テストで担保**: `buildReactionLinesBatch`が記事内(=1回のbuildReactionBlocks/buildXReactionBlocks呼び出し)の全レス/リプライ横断でNG文を収集し、`softenNgSentences`を最大1回だけ呼ぶよう実装。新規テスト2件（5ch: NGレス3件で`ngSoftenCalls`が1回・NG文3件分をまとめて送信／X: NGリプ2件で`ngSoftenCalls`が1回・NG文2件分をまとめて送信）で明示的にアサートしGreen。
- [x] **soften結果・表示・moderation非保留・フォールバック挙動は不変**: 採用条件（`findNgWord`再検査でNG語残存/空/欠落は不採用→削除フォールバック）・`NG_REPHRASE_MODE`のsoften/remove/mask分岐・非NG文の逐語・moderation整合（`moderateArticleContent`が`ng_word`保留しない）テストは全て既存のまま変更せず実行しGreen（コード側もこれらの分岐ロジック自体は一切変更せず、呼び出し回数の集約のみ実施）。
- [x] **mock既定で回帰ゼロ**: `GENERATION_MODE=mock`（既定）下では`ng-soften`は常に空文字を返す設計のため、リファクタリング後も既存の全compose/5ch/reddit/X/moderationテストは無変更でGreen（125ファイル1762テスト、失敗0）。

## アプリの起動方法
- テスト: `npx vitest run`（ポート不要）
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`
- （画面確認は本スプリントでは未実施。理由は下記「既知の問題・懸念点」参照）

## 既知の問題・懸念点
- **moderation非保留の担保**: `softenNgSentences`が言い換え結果を`findNgWord`で再検査し、NG語が残る場合は不採用（削除フォールバック）にすることで、`moderateArticleContent`のng_word保留を招かない設計にした（変更なし）。テストでも`moderateArticleContent`を直接呼び出し`status: "published"`を確認済み。
- **NG無し記事はLLM未呼び出し（コスト最小）**: `buildReactionLinesBatch`はNG文（`findNgWord`該当）が記事内に1つも無ければ`softenNgSentences`を呼ばず早期returnする。テストで`ngSoftenCalls`の呼び出し回数が0であることを確認済み。
- **コスト最適化後もmock既定で回帰ゼロ**: mockの`renderTask`は`ng-soften`で常に空文字を返す設計のため、`GENERATION_MODE=mock`（既定）では`softenNgSentences`が常に空Mapを返し、既定`NG_REPHRASE_MODE=soften`でも実質的に従来の削除挙動にフォールバックする。呼び出し回数を記事単位に集約した後も既存テスト（`generation-compose.test.ts`のNG文削除テスト群含む）は全てGreenのまま（挙動変更ゼロ）で確認済み。
- **事実/数値/固有名詞不改変の担保**: compose側は言い換え結果を一切書き換えず、`findNgWord`による再検査のみ行う（改変・捏造を防ぐのはNG_SOFTEN_SYSTEM_PROMPTの指示とLLM側の責務であり、compose側では「LLMが返した文をそのまま採用する」ことのみをテストで確認）。実LLM（live環境）での言い換え品質そのものは本スプリントのモック中心のテストでは検証できない（実HTTP非依存というテスト方針どおり）。
- **スキーマ未変更**: `ArticleBodyReactionBlock`/`ArticleBodyReactionLine`（`article-body.ts`）の型定義は変更していない。
- Playwright等での画面確認（NG含む反応記事のUI表示）は未実施。本スプリントはNG含む記事のみに差分が出る性質のため、テスト＋静的確認（vitest/tsc/build/lint）を中心に検証した。実運用での見た目確認はevaluator側での実施を想定。

## 追加したテスト
- `src/lib/__tests__/generation-compose-resel-s3.test.ts`（13ケース、コスト最適化リファインメントで2件追加）:
  1. NG文がLLM言い換え結果（再検査済み）に置換され、非NG行は逐語のまま
  2. 1レス内の複数NG文をまとめて1回のng-soften呼び出しにバッチ送信（バッチ動作の検証）
  3. **【新規】コスト最適化: NGを含む複数レス(3件)があっても1記事(1回の`buildReactionBlocks`呼び出し)につきng-softenは最大1回・NG文3件分をまとめて送信することをアサート**
  4. 言い換え結果にNG語が残る場合は再検査で不採用→削除フォールバック
  5. LLM空応答/parse不能→空Map→削除フォールバック（全行不採用のレスは不掲載も確認）
  6. NG文を含まない記事はng-soften未呼び出し（コスト最小）
  7. `NG_REPHRASE_MODE=remove`で従来削除・LLM未呼び出し
  8. `NG_REPHRASE_MODE=mask`でNGワードのみ伏字化・LLM未呼び出し
  9. moderation整合（reddit経路、soften後の本文にNG語が残らず`moderateArticleContent`が`published`）
  10. compose側はLLMの言い換え文を改変せずそのまま採用する（事実/数値/固有名詞はLLM入力のまま渡る）
  11. X経由（`buildXReactionBlocks`）でもsoftenが適用される
  12. **【新規】コスト最適化: X経由でもNGを含む複数リプ(2件)があれば1回の`buildXReactionBlocks`呼び出しにつきng-softenは最大1回・NG文2件分をまとめて送信することをアサート**
  13. X経由でNG無しリプはng-soften未呼び出し

## 関連ドキュメント
- [[resel-s3-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
