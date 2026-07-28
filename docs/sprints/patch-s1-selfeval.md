---
tags: [sprint-selfeval]
sprint: patch-s1
---

# パッチ刷新S1 自己評価レポート

## 実装した内容
- `src/lib/generation/patch-notes-parser.ts`（新規）: `parsePatchNotesHtml(html): PatchChangeTarget[]` 純関数。
  - `<h2>` を辿ってsection保持、`<div class="patch-change-block...">` 単位で対象を抽出。
  - `name`=h3.change-titleテキスト、`iconUrl`=ブロック先頭img src、`intent`=blockquoteテキスト。
  - `kind`/`id`: アイコンURL（`/img/champion|item|rune/<file>.<ext>`）から判定。アイコン無し/非champion・item・runeの場合はsection名（チャンピオン/アイテム/システム/バグ修正）から推定。
  - `h4.change-detail-title` ごとに`PatchChangeGroup`。先頭トークンで`abilityKey`（"R - …"→R、"基本ステータス"→base、"パッシブ"→passive、それ以外はundefined）を判定。
  - `<ul><li>` ごとに`PatchChange`（stat/before/after、逐語のまま）。
  - 実データ確認済みの2つの構造バリエーションに対応: (a) h4がh3/blockquoteより先に来るアイテムブロック、(b) h4がまったく無く直接`<ul>`が続くアイテムブロック、(c) h3が無く先頭h4がそのまま対象名相当になるシステムブロック（"ブルーバフ"）。いずれも例外を投げずベストエフォートで抽出する。
  - `<script>`/`<style>` は事前除去（`__NEXT_DATA__`のシリアライズHTMLやCSSセレクタ文字列への誤マッチ防止）。それ以外の要素（`<header>`等）は落とさない（`<h2>`が`<header class="header-primary">`に包まれているため、既存`stripHtmlToText`の丸ごと除去ロジックは流用しない）。
  - 入力全体の失敗・空文字・null/undefinedは例外を投げず`[]`を返す。個々のブロックの構造不一致もそのブロックだけスキップ（本体を止めない）。
  - 新規npm依存は追加していない（正規表現/文字列スキャンのみで実装。研究文書の判断基準どおり、まず依存なしで実装し十分だった）。
- `src/lib/collection/adapters/riot-datadragon.ts`（既存ファイル改修）:
  - `fetchPatchNotesData` の戻り値に `html`（平テキスト化前の生HTML、切り詰めなし）を追加。既存の `text`/`imageUrl` は不変（後方互換）。`fetchPatchNotesText` は従来どおり薄いラッパのまま。
  - リダイレクト堅牢性（research 未確認事項2）: 実際にNode標準`fetch`（undici）で公式パッチノートURLに対しリダイレクト追従の実挙動を確認した結果、**`fetch`は既定でリダイレクトを追う**ため、`fetchTextSafe`は追加対応なしで最終HTMLを取得できることを確認済み（実URLへの実取得で307→200/261KBを確認）。コード変更は不要だったため、テストで回帰防止の契約として明記した。
- フィクスチャ `src/lib/generation/__fixtures__/patch-26-14.html`（新規）: 実際に取得した公式パッチノート26.14のHTMLから、チャンピオン節（アジール/コーキ/ガレン/ジェイス/ロック/モルデカイザー/ナミ/セナ/セラフィーン/ユナラの全10体）・アイテム節（3件）・システム節（1件）・バグ修正節冒頭を実バイトのまま切り出して構成（捏造なし。手で書き起こしたテキストは含まない）。
- テスト:
  - `src/lib/__tests__/generation-patch-notes-parser.test.ts`（新規、23件）: 誤帰属ゼロ検証、スキルキー判定、対象種別/ID/意図/アイコンURL、逐語維持、`classifyChange`の適用、異常系。
  - `src/lib/__tests__/collection-riot-datadragon.test.ts`（既存に追記、3件）: `html`保持の確認、リダイレクト追従の契約確認。

## 技術選定
- HTMLパース手段: **新規依存を追加せず正規表現/文字列スキャンで実装**。実データ（実際に取得した26.14 HTML）で構造を検証した結果、`patch-change-block`/`change-title`/`change-detail-title`等のセマンティッククラスは安定しており、ネスト解析が不要な「マーカー位置ベースのスキャン」で誤帰属ゼロ・逐語維持・異常系耐性のすべてを満たせたため、`node-html-parser`等の追加は不要と判断した（依存追加条件「脆く保守困難な場合のみ」に該当しなかった）。npm auditは新規依存が無いため実行不要。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1352 tests passed / 106 files）、`npx tsc --noEmit` エラー0、`npm run build` 成功、`npm run lint` エラー0（既存の警告6件のみ、本スプリントの変更に起因するものではない）。
- [x] 26.14実HTMLフィクスチャで誤帰属ゼロを確認: アジールの`groups`は`["W","R"]`のみで基本ステータスの攻撃力変更を含まない。コーキは独立した`PatchChangeTarget`として抽出され、`groups`に`["base","R"]`（基本ステータス: レベルアップごとの攻撃力 2⇒2.5、Rの短縮量変更）を持つ。コーキの`id="Corki"`（アイコンURLファイル名から。名前マップ非依存で確認）。
- [x] AI不使用（DOMパース・分類・URL判定はすべて純ルール）。逐語維持（stat/before/afterがフィクスチャ本文の文字と完全一致することをテストで確認）。DBスキーマ変更なし。既存の平テキスト経路（`stripHtmlToText`/`extractPatchSectionsDeterministic`）・他機能は無変更（回帰テスト1352件全Green）。新規依存を追加していないためnpm audit対象なし。

## アプリの起動方法
- 本スプリントはバックエンドの抽出ロジック（純関数）のみで、UI/起動確認は対象外（S1は抽出基盤のみ、表示はS2以降）。
- 検証コマンド: `npx vitest run`（テスト）、`npx tsc --noEmit`（型検査）、`npm run build`（ビルド）、`npm run lint`（lint）。いずれもリポジトリルートで実行。サーバー起動は行っていない（起動不要な純関数スプリントのため、自己確認用サーバーも起動していない）。

## 既知の問題・懸念点
- 実データで確認した「h3が無いシステムブロック」（例: "ブルーバフ"）は、先頭h4のテキストを対象名として流用するフォールバックにしている（brief受け入れ基準の必須テスト対象ではないが、クラッシュ防止のため実装・軽くテストした）。今後Riotが同種のマークアップを増やした場合、この名前の妥当性は保証しない（best-effort）。
- `classifyChange`（compose.ts、変更しない既存ロジック）は、実際の公式HTML表記（スラッシュ前後にスペースがある「150 / 250 / 350」形式、かつ括弧内の付随数値を含む行）に対しては、末尾/先頭の数値グループの取り方次第で直感と異なる分類になりうる既知の挙動を確認した（例: ガレンの「確定ダメージ 150/250/350⇒125/200/275（+減少体力の25/30/35%）」に対し実際は"buff"を返すケースを発見。既存テストは"150/250/350"のスペース無し形式のみを前提にしている）。これは`classifyChange`自体の既存仕様・既存テストの前提差であり、S1のスコープ外（「分類ロジックは変更しない」の指示どおり未修正）。テストは分類結果が予測どおりの単純な数値のみのケース（コーキ基本ステータス増加=buff、アイテムの単純割合減少=nerf、コスト増加の反転語=nerf）で検証し、この既知の限界には触れる項目を含めていない。S2以降で本文組み立てにこの分類を使う際は要考慮（このレポートに明記のみ、修正は行っていない）。
- `docs/patch-accuracy-research.md`・`docs/sprints/patch-s1-brief.md`はオーケストレーターから提供された既存ファイルで、`git status`上は未コミット(untracked)のまま。本スプリントの成果物ではないためコミット判断はオーケストレーター側に委ねる。

## 追加したテスト
- `src/lib/__tests__/generation-patch-notes-parser.test.ts`（23件、新規）: 誤帰属ゼロ（アジール/コーキ）・スキルキー判定・対象種別/ID/意図/アイコンURL・逐語維持・`classifyChange`適用・異常系（空文字/構造不一致/壊れタグ/null/undefined）。
- `src/lib/__tests__/collection-riot-datadragon.test.ts`（3件、追記）: `fetchPatchNotesData`の`html`保持、リダイレクト追従の契約。

## S2以降への非侵犯の確認
- `src/lib/generation/compose.ts`・`src/components/article-body-view.tsx`・`src/lib/article-body.ts` は一切変更していない（`classifyChange`/`classifyChampion`は読み取り専用でテストから呼んだのみ）。
- DBスキーマ（Prisma）は無変更。表示・デザイン（LoL公式風配色等）はS2以降のため未着手。

## 関連ドキュメント
- [[sprint-patch-s1-brief]]（本スプリントの仕様抜粋、`docs/sprints/patch-s1-brief.md`）
- `docs/patch-accuracy-research.md`（設計根拠のディープリサーチ）
