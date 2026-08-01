---
tags: [sprint-selfeval]
sprint: reactqual-S3b
---

# reactqual-S3b 自己評価レポート

## 実装した内容
- `src/lib/moderation/ng-words.ts`: 既存の `findNgWordExcluding` と同方式（除外語をプレースホルダでマスク→NG判定/処理→マスクを元の文字列に復元）で、`stripNgWordsExcluding(text, exemptions)` と `maskNgWordsExcluding(text, exemptions)` を新設。
  - 既存の `stripNgWords` / `maskNgWords` はシグネチャ・実装・挙動を一切変更していない（他callerへの回帰なし）。
- `src/lib/generation/title.ts`: タイトル生成の3箇所（`generateHookTitle` の主語穴埋め・本文コンテキストプール穴埋め、`generateHookTitleLLM` のLLM出力後処理）で `stripNgWords(...)` → `stripNgWordsExcluding(..., CHAMPIONS)` に置換。`CHAMPIONS` は同ファイル内で既に定義済みのため追加import不要。関連コメントも実態に合わせて更新。
- `src/lib/generation/compose.ts`: `NG_REPHRASE_MODE=mask` 経路（`buildReactionLinesBatch` 内）で `maskNgWords(sentence)` → `maskNgWordsExcluding(sentence, CHAMPIONS)` に置換。`CHAMPIONS` はS3で既にimport済み。既定の soften/remove モードでは非発火のためmaskモードにのみ影響。
- `src/lib/__tests__/moderation.test.ts` にS3b用のテストケースを追加（下記参照）。

## 技術選定（該当する場合のみ）
- 該当なし（新規ライブラリ・技術選定は無し。既存の `findNgWordExcluding` と同じマスク→復元パターンを踏襲）。

## 受け入れ基準チェック（自己申告）
- [x] `stripNgWordsExcluding("グレイブスの育ち方が異常", CHAMPIONS)` はチャンピオン名を保持しつつ本物NGは除去する: テストで確認（`"グレイブス使ってるやつ死ね"` → `"グレイブス使ってるやつ"`、`死ね`のみ除去）。
- [x] `maskNgWordsExcluding("グレイブスはゴミ", CHAMPIONS)` はチャンピオン名を保持しつつ本物NGは伏字化する: テストで `"グレイブスは**"` を確認。
- [x] title.tsのタイトル生成でチャンピオン名が欠損しない: 3箇所すべて `stripNgWordsExcluding(..., CHAMPIONS)` に置換済み。既存の `generation-title.test.ts` は無変更のまま全パス。
- [x] 既存の title/moderation/compose テストが回帰しない: `npx vitest run` で131ファイル・1849テスト全てGreen。
- [x] 既存 `stripNgWords`/`maskNgWords` のシグネチャ・挙動不変: 関数定義自体は無変更。`moderation.test.ts` に既存挙動（チャンピオン名を誤って欠損/伏字化する）の回帰確認テストを追加し、変わっていないことを明示的に検証。
- [x] 本物のNGワードは依然として除去/伏字化される: `"このゴミチャンピオンは強い"` で `stripNgWordsExcluding`/`maskNgWordsExcluding` ともにチャンピオン名は保持、`ゴミ`は除去/伏字化されることをテストで確認。
- [x] `npx vitest run`(全Green)/`npx tsc --noEmit`(0)/`npm run build`(成功)/`npm run lint`(0エラー、既存の7件のwarningのみ・本タスクの変更とは無関係)を実施済み。

## アプリの起動方法
- 本スプリントはロジック層（NGワードフィルタ・タイトル生成・記事本文組み立て）のみの修正で、UI・画面挙動の変更なし。
- 開発サーバー確認は不要と判断（`npm run build` の成功で静的/動的ルート生成に問題が無いことを確認済み）。起動する場合は `npm run dev`（http://localhost:3000）。

## 既知の問題・懸念点
- `src/lib/generation/compose.ts` の `findNgWord(text)`（392行目、`softenNgSentences` のLLM出力再検証用）はCHAMPIONS除外を使っていないが、今回の指示範囲（`stripNgWords`/`maskNgWords`経路）外のため変更していない。もしLLMの言い換え結果にチャンピオン名が含まれ「ブス」等が部分一致した場合、再検査で誤ってNG判定される可能性は理論上残るが、S3時点から既存の挙動であり今回のスコープ外。
- サーバー起動確認は行っていない（ロジックのみの変更のためbuild成功で代替。UIに影響する変更はしていない）。

## 追加したテスト（任意）
- `src/lib/__tests__/moderation.test.ts` に `describe("stripNgWordsExcluding / maskNgWordsExcluding（reactqual-S3b...）")` を追加:
  - `stripNgWordsExcluding` がチャンピオン名を保持しつつ本物NG（例: 死ね）は除去することを確認。
  - `stripNgWordsExcluding` がチャンピオン名の外側の単独NG（例: ゴミチャンピオン）は従来どおり除去することを確認。
  - 既存 `stripNgWords` の挙動不変（チャンピオン名を誤って欠損させる回帰確認、変わっていないことの証明）。
  - `maskNgWordsExcluding` がチャンピオン名を保持しつつ本物NGは伏字化することを確認。
  - 既存 `maskNgWords` の挙動不変（チャンピオン名を誤って伏字化する回帰確認）。
  - NGワードを含まない文はそのまま返すことを確認。

## 前回フィードバックへの対応（再実装の場合のみ）
- 指摘: `stripNgWords`（タイトル）と `maskNgWords`（NG_REPHRASE_MODE=mask時）でチャンピオン名がNGワードの部分文字列として誤って除去/伏字化される（例: `"グレイブスの育ち方が異常"` → `"グレイの育ち方が異常"`、`"グレイブスはゴミ"` → `"グレイ**は**"`）。
  → 対応: `stripNgWordsExcluding`/`maskNgWordsExcluding` を新設し、title.ts（3箇所）・compose.ts（maskモード1箇所）をこれらに置換。既存関数は不変のまま維持し、他callerへの影響ゼロを確認。

## 関連ドキュメント
- [[reactqual-s3-brief]]（S3の仕様抜粋。S3bはS3の残タスク）
- [[reactqual-s3-evaluation]]（S3b着手のきっかけとなった指摘元）
