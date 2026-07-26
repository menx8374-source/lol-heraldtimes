---
tags: [sprint-selfeval]
sprint: E35
---

# 拡張E35 自己評価レポート

## 実装した内容
- **F-E35-1（取得量拡大・ノイズ低減）** `src/lib/collection/adapters/riot-datadragon.ts`
  - `PATCH_NOTES_MAX_LENGTH` を 15000 → 60000 に拡大。
  - `stripHtmlToText` で `<nav>/<header>/<footer>/<aside>` 要素をタグ除去前に丸ごと除去する処理を追加。
  - 3件以上連続する「2文字以下の極端に短い行」をまとめて間引く `dropShortFragmentRuns` を追加（単発の短い行は残す）。
  - 直前行と完全一致する連続行を間引く `dedupeConsecutiveLines` を追加（ナビの繰り返しラベル対策）。
- **F-E35-2（要約プロンプト強化）** `src/lib/generation/compose.ts`
  - `PATCH_SUMMARY_SYSTEM_PROMPT` を強化。「渡す本文はページ全体のダンプでナビ/日付/eスポーツ告知/関連記事/Wiki導線等の無関係ノイズを含む。無視してチャンピオン/アイテムの数値変更のみ拾う」「変更が明確でないカテゴリは空配列（ノイズを変更点として拾わない＝捏造禁止）」を明記。
  - 出力JSON形式・`extractJsonObject` による堅牢解析は変更なし。
- **F-E35-3（失敗時のクリーンフォールバック）** `src/lib/generation/compose.ts`
  - `composeCleanPatchFallbackBody` を新設: パッチ本文（≥PATCH_NOTES_MIN_LENGTH）で `composePatchSummaryBody` が null のとき、`composeFactBody`（ノイズ本文の逐文リライト、破綻の原因）へは一切フォールバックせず、見出し「パッチ<番号>の変更点」＋定型段落2つ＋出典URL段落のみで構成するクリーン記事を返す。
  - `extractPatchNumberLabel` で候補のタイトル（常に "数字.数字" を含む）または sourceUrl（buildPatchNoteUrl形式）からパッチ番号を導出。どちらも取れなければ「今回のパッチ」に汎用化。
  - `composeArticleBody` の riot分岐を更新（本文ありでも要約失敗時はクリーン記事、本文なし＝汎用短contentは従来どおり composeFactBody のまま＝回帰なし）。

## 技術選定（該当する場合のみ）
- 新規依存追加なし（既存の正規表現ベースのHTML処理・既存LLMClient抽象を利用）。architecture.md の更新は不要（技術ベースラインに変更なし）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（782件、新規/更新テスト含む。実API/実ネット非依存 = fetch/LLMは全てモック/スタブ）。
- [x] 基準2: `npx tsc --noEmit`（エラー0）・`npm run build`（成功）・`npm run lint`（エラー0、警告4件は本スプリント対象外の既存warning）通過。
- [x] 基準3: スタブLLMで要約成功時は「主な強化/弱体チャンピオン・アイテム」まとめ記事（既存挙動、回帰なし）。要約失敗時（mock/不正JSON/空文字/全カテゴリ空/例外）は「パッチ<番号>の変更点」見出し＋定型段落＋出典のクリーン記事になり、composeFactBody（速報/要点整理/まとめ見出し・quoteブロック）を経由しないことをテストで確認。破綻文・ノイズ断片（"14 Notes"・「リライトできません」等）が本文に出ないことも確認。捏造なし（本文に無い具体的変更点は書かない）。
- [x] 基準4: mock既定（MockLLMClient）でも本文取得自体はfetch(live)経由のみで走るため回帰なし・コスト0。新規npm依存なし。

## アプリの起動方法
- テスト: `npx vitest run`（DBはSQLite、テスト用DBは自動生成・実ネット非依存）
- 型チェック: `npx tsc --noEmit`
- Lint: `npm run lint`
- ビルド: `npm run build`
- 開発サーバー起動（本スプリントでは自己確認のため未起動。必要なら）: `npm run dev` → http://localhost:3000
- 本スプリントはロジック層（生成パイプライン）のみの変更のため、サーバー起動確認は行わず上記コマンドの実行結果で検証した（起動していた場合は自己評価作成前に停止済み。実際は今回サーバーは起動していない）。

## 既知の問題・懸念点
- `stripHtmlToText` のノイズ低減はbest-effort（brief記載どおり）。実際の公式パッチノートページの具体的なDOM構造（nav/header/footer/aside以外の要素にナビが入っている場合等）までは対応しておらず、後段のLLMプロンプト強化（F-E35-2）と組み合わせて許容する方針。
- クリーンフォールバック記事の本文はブリーフどおり定型文（汎用的な内容のみ、具体的な変更点は書かない）。見た目のバリエーションが少ない点は仕様どおりの割り切り。
- E34c以前に生成された既存の破綻記事（DB内の過去記事）は本スプリントの対象外（新規収集・生成時のみ改善。既存記事の再生成/修正は本スプリントのスコープ外のため未実施）。

## 追加したテスト（任意）
- `collection-riot-datadragon.test.ts`:
  - PATCH_NOTES_MAX_LENGTH拡大により旧上限(15000字)超・新上限未満の本文が切り詰められず全文入りきること。
  - nav/header/footer/asideのボイラープレートが除去され本文相当のテキストが残ること。
  - 極端に短い断片(2文字以下)が3件以上連続するケースが間引かれること。
- `generation-compose.test.ts`:
  - 要約失敗（mock/不正JSON/空文字/全カテゴリ空/例外）時にcomposeFactBodyへ落ちず、クリーンな簡易パッチ記事（見出し1件・quoteなし・300字以上）になることを共通ヘルパー`expectCleanFallback`で検証。
  - sourceUrl付き候補で要約失敗時、クリーン記事本文に出典URLが含まれること。
  - 既存の「要約成功時はまとめ体裁」「汎用contentは従来どおり」テストは回帰なしのまま維持。
- `generation-generate-article.test.ts`:
  - `generateArticleForCandidate`経由でも要約失敗時にGenerationErrorにならずクリーン記事（見出し1件・quoteなし・MIN_BODY_LENGTH以上）が生成されることを確認するよう既存テストを更新。

## 関連ドキュメント
- [[ext-e35-brief]]（本スプリントの仕様抜粋）
