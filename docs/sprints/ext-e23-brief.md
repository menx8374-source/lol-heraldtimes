# 拡張E23 ブリーフ — 5chのShift_JIS文字化けを修正

運用フィードバック起点のバグ修正。対象プラットフォーム: Web（Next.js 16 / Vitest）。

## 背景（なぜ）
- 5ch（`egg.5ch.net/game`）を実データ収集したところ、生成記事の本文が文字化けした。
- 原因: 5chの `subject.txt`/`dat` は **Shift_JIS系（Windows-31J/CP932）** で配信されるが、`fivech.ts` は追加依存回避のため `fetchTextSafe`（標準 `Response#text()` ＝UTF-8前提）で読んでいる（`src/lib/collection/adapters/fivech.ts` の16-18行コメントに既知の限界として明記済み）。UTF-8として解釈するため日本語が壊れる。
- Node標準の `TextDecoder('shift_jis')` がフルICU（Node 20+既定）で利用可能。**追加依存なし**で正しくデコードできる（`node -e` で確認済み）。

## 含まれる機能

### F-E23-1: 5chの応答をShift_JISでデコードする
- 対象: `src/lib/collection/adapters/http.ts` と `src/lib/collection/adapters/fivech.ts`。
- `http.ts` に、指定charsetでバイト列をデコードするテキスト取得ヘルパーを追加する。例: `fetchTextSafe` に任意の `charset`（既定は従来どおりUTF-8＝`res.text()`）を渡せるようにする、または `fetchShiftJisTextSafe`（`res.arrayBuffer()` → `new TextDecoder("shift_jis").decode(buf)`）を新設する。既存の `fetchTextSafe` のUTF-8挙動は変えない（他ソースに影響させない）。
- `fivech.ts` の subject.txt / dat の取得を、上記のShift_JISデコード経由に差し替える。エラー時 null（例外を投げない）の従来挙動は維持する。
- `fivech.ts` の「Shift_JISをUTF-8で読む」旨の既知の限界コメント（16-18行付近）を、実際にShift_JISでデコードする旨へ更新する。
- 既存の `decodeEntities`（数値文字参照のデコード）・`decodeDatBody`・タグ除去等の後段処理はそのまま（Shift_JISデコード後のテキストに適用されればよい）。

## 受け入れ基準（検証可能な形で）
1. `npx vitest run` 全Green（新規テスト含む）。
2. Shift_JISでエンコードされたバイト列（例: 日本語を含む subject.txt/dat 断片）を、新デコード経路が**正しい日本語文字列**に復元する（UTF-8デコードでは化ける入力が、Shift_JISデコードで一致することをテストで確認）。
3. `fivech.ts` の subject.txt/dat 取得がShift_JISデコード経路を使っている。UTF-8前提の `fetchTextSafe` を5ch取得で直接使っていない。
4. 既存の他ソース（reddit/riot/clip）のテキスト/JSON取得は従来どおりUTF-8のまま（回帰なし）。`fetchTextSafe` の既定挙動を変えていない。
5. `npx tsc --noEmit`・`npm run build`・`npm run lint` が通る。

## 評価基準（evaluator向け）
- テストスイートGreen（1件でも失敗ならFAIL）。特にShift_JISデコードのテスト。
- `fetchTextSafe` の既定（UTF-8）が不変で、reddit/riot/clip の既存テストが全て通る（回帰なし）。
- `npx tsc --noEmit`・build・lint 通過。
- 受け入れ基準1〜5を満たす。

## 補足（オーケストレーター対応・実装対象外）
- 既にDBに入った文字化け記事は、修正後に5chを再収集し直す必要がある（DBリセット＋`npm run pipeline`）。これは実装ではなく運用手順。
