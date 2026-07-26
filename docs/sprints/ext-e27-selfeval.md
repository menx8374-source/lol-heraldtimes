---
tags: [sprint-selfeval]
sprint: ext-e27
---

# 拡張E27 自己評価レポート

## 実装した内容
- `src/lib/moderation/ng-words.ts`: `maskNgWords(text)` を追加。`NG_WORDS` の各語を `"*".repeat(word.length)` に置換する純関数（既存の `findNgWord`/`stripNgWords` はそのまま維持）。
- `src/lib/generation/compose.ts`: `buildReactionBlocks` 内、レス各行の `text` 生成時に `maskNgWords` を適用（`import { maskNgWords } from "@/lib/moderation/ng-words"` を追加）。逐語（元の文字数・語順）は保ったままNG語のみアスタリスクに置換される。JSDocコメントも拡張E27の意図を追記。
- `title.ts` の `stripNgWords` 呼び出し箇所は**変更せず据え置き**（ブリーフの「迷う場合は本文優先・タイトルは既存のままでも可」に従った。タイトル生成は候補文字列の長さ・穴埋めロジックに依存しており、削除→伏字化に切り替えると検証/フォールバック挙動への影響範囲の確認コストが高いため）。
- `moderateArticleContent`（`moderate.ts`）・personal_attack/missing_source/duplicateのロジックは無変更。

## 技術選定（該当する場合のみ）
- 新規ライブラリ追加なし。既存の `NG_WORDS`/`String.split().join()` パターンを再利用した純関数のみで実装（LLM非依存・新規依存なし、というブリーフの制約どおり）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 実行 → 73ファイル / 709テスト 全Green（既存702件＋新規7件）。
- [x] 基準2: `npx tsc --noEmit`（エラーなし）・`npm run build`（成功）・`npm run lint`（エラー0、既存由来の警告4件のみ・新規警告なし）いずれも通過。
- [x] 基準3: reddit反応記事のレス本文に「死ね」を含めて `composeArticleBody`→`bodyBlocksToText`→`moderateArticleContent` を通したテストで `status: "published"` を確認（伏字化後 `findNgWord` がnullになるため ng_word 保留が発生しない）。他の保留理由（missing_source/personal_attack/duplicate）は既存テストのまま無変更・全Green（回帰なし）。
- [x] 基準4: 逐語維持を確認するテスト（NGワード混入時に文字数・語順を保ったままNG語だけが同数のアスタリスクになっていること／NGワードを含まない場合は完全に無変更であること）を追加し通過。新規依存追加なし。

## アプリの起動方法
- `npm run dev`（http://localhost:3000）。本スプリントは表示ロジックの変更を伴わない純関数・生成パイプライン内部の変更のため、開発サーバーは自己確認のため起動していない（起動・停止は行っていないので停止対応も不要）。
- 検証は `npx vitest run` / `npx tsc --noEmit` / `npm run lint` / `npm run build` のコマンドのみで実施。

## 既知の問題・懸念点
- タイトルのNGワード処理は `stripNgWords`（削除）のまま据え置き。ブリーフ上「本文優先で可」とされているため許容範囲と判断したが、タイトルにNGワードが混入した場合は引き続き「削除」（伏字ではない）挙動になる点は仕様上の非対称として残る。
- `moderateArticleContent` 自体（`findNgWord` によるng_word判定ロジック）は変更していないため、compose.ts を経由しない経路（例: 手動投入やRiot公式記事title等）でNG語が直接渡された場合は従来どおり保留される（ブリーフの対象は反応記事本文のみのため想定どおり）。

## 追加したテスト（任意）
- `src/lib/__tests__/moderation.test.ts`:
  - `maskNgWords`単体（単一置換／複数種・複数出現／非該当文字列は不変）3件。
  - reactionブロックが伏字化済みの本文であれば `moderateArticleContent` が `published` になる統合テスト1件。
- `src/lib/__tests__/generation-compose.test.ts`:
  - 反応記事(5ch)のレス本文にNGワードが含まれる場合、`composeArticleBody` 出力の逐語テキストがNG語のみ伏字化されることを確認。
  - NGワードを含む反応記事(reddit)が `composeArticleBody`→`bodyBlocksToText`→`moderateArticleContent` の一連の流れで `ng_word` 保留されず `published` になることを確認（`findNgWord` がnullであることも確認）。
  - NGワードを含まない反応記事はテキストが完全に不変であることを確認（回帰なし）。

## 関連ドキュメント
- [[ext-e27-brief]]（本スプリントの仕様抜粋）
