# 拡張E53 — パッチ記事を「チャンピオン画像＋変更前後を詳しく」表示（lol-times風の詳細パッチ記事）

運用フィードバック起点（参考: https://lol-times.com/archives/8250 の詳細パッチ記事）。対象: Web。

## 背景（なぜ）
現在のパッチ記事は簡潔な事実速報（画像＋見出し＋定型文＋公式リンク・拡張E42/E51）。ユーザーはlol-timesのように
**チャンピオンごとに画像を添え、変更前後（A ⇒ B）を詳しく**載せた記事にしたい。公式パッチノートには各チャンピオンの
数値変更（拡張E40の決定的抽出で逐語取得済み）と、チャンピオン画像（Data Dragon）が使える。

## 参考構造（lol-times）
バナー画像→タイトル→導入→チャンピオン変更（チャンピオン名見出し＋画像＋スキル/項目＋「変更前 ⇒ 変更後」の箇条書き）
→アイテム変更→出典。※本スプリントはチャンピオン変更の詳細化＋画像を主眼にする（バフ/ナーフ分類・アイテム詳細は後続）。

## 含まれる機能

### F-E53-1: 詳細パッチ本文コンポーザ（compose.ts）
- `PATCH_ARTICLE_MODE` に **`"detailed"` を追加し、これを既定にする**（従来の `"fact"`＝簡潔速報／`"summary"`＝LLM要約は残す）。
- detailed の本文構成（riot・パッチノート本文が取得できているとき）:
  1. `imageUrl`（og:image バナー）があれば先頭に image ブロック（拡張E42同様・credit「画像: Riot Games 公式パッチノートより」）。
  2. 見出し「パッチ<番号> の変更点」＋短い導入段落（一般的事実のみ・捏造なし）。
  3. **チャンピオンごとのセクション**（`extractPatchChangesDeterministic`＝拡張E40の逐語抽出を使用。値の連結修正済み）:
     - 各チャンピオン（最大 ~12体）について:
       - 見出し（チャンピオン名）
       - **チャンピオン画像**（image ブロック。`buildChampionSplashUrl(championId)`＝公式スプラッシュ。チャンピオン名→id は
         純粋な対応表で解決。id 不明のチャンピオンは画像を省略しテキストのみ）
       - 変更点の段落（`extractPatchChangesDeterministic` が返す**逐語の「項目 ：A ⇒ B」**を箇条書き的に段落で。捏造禁止＝本文の部分文字列のみ）
  4. 出典リンクボタン（`linkButton`＝公式パッチノートURL・拡張E42）。
- **フォールバック**: `extractPatchChangesDeterministic` が変更点を取れない場合は、従来の事実速報（`composePatchFactFlashBody`＝E42）にフォールバック（＝壊れない・捏造しない）。
- 逐語維持（変更点は本文の部分文字列のみ）。AIは使わない（決定的抽出＋公式画像）。SEO（S5b）・タイトル事実化（E40）は従来どおり。

### F-E53-2: チャンピオン名→id の純粋対応表（画像URL解決）
- `src/lib/generation/champion-splash.ts`（http非依存）に、チャンピオン**日本語表示名→championId**の対応表（`champion-thumbnail.ts` の
  `FALLBACK_JP_NAME_TO_ID` 相当）を**純粋データとして持たせる**（または新規純粋モジュール）。compose から http依存を持ち込まずに
  `championNameToId(name)` → `buildChampionSplashUrl(id)` で画像URLを作れるようにする。`champion-thumbnail.ts` は必要なら
  この純粋モジュールから import して再利用（重複を避ける）。

## 制約・非目標
- **バフ/ナーフ/調整のグルーピング・アイテム/ルーンの詳細化・目次(TOC)・新スキン節は本スプリント対象外**（後続で追加余地）。
  まずは「チャンピオンごとに画像＋変更前後を詳しく」を実装する。
- 捏造禁止（変更点は逐語・チャンピオン名/id は対応表の範囲）。AIによる変更点生成はしない（決定的抽出）。新規依存なし。
- 5ch/reddit・hotness・moderation・翻訳・SEO・サムネ表示には触れない（パッチ本文コンポーザのみ）。
- 公式ニュース(riot-news)ページのlol-times風化は別スプリント（本スプリントはパッチのみ）。
- mock/パッチ本文が無いときは従来どおり（detailedでも本文が無ければfact-flash）。live時のみ実パッチノートから詳細生成。

## テスト（必須・実API/実ネット非依存＝fixture/スタブ）
1. `championNameToId`/純粋対応表: 主要チャンピオン名→id、未知名は null。`buildChampionSplashUrl` と組み合わせて画像URL生成。
2. detailed 本文（fixtureのパッチノートテキスト）: image(バナー)→見出し→チャンピオンごとに[見出し＋image(スプラッシュ)＋変更点段落]→linkButton
   の順で組まれる。変更点は逐語「A ⇒ B」を含む。id不明チャンピオンは画像省略しテキストのみ。
3. フォールバック: 変更点が抽出できないパッチ本文では `composePatchFactFlashBody`（事実速報）にフォールバック。
4. `PATCH_ARTICLE_MODE` 既定が detailed。fact/summary 指定時は従来どおり（回帰なし）。
5. 既存の compose/patch/generate-article テストが回帰しない（detailed既定化に伴う期待更新は最小限）。

## 受け入れ基準
1. `npx vitest run` 全Green（新規/更新含む）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. パッチ記事が既定で「バナー画像＋チャンピオンごとの画像＋変更前後(A ⇒ B)を詳しく＋公式リンク」の詳細記事になる。
   変更点が取れないときは事実速報にフォールバック。捏造なし・逐語維持・新規依存なし・AIは変更点生成に使わない。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過。mock/生成が回帰しない（コンソールエラー0・本文無し時はfact-flash）。
- チャンピオン名→id→画像URL、detailed本文のチャンピオンごと画像＋変更前後、フォールバックがテスト/データで確認できる。
- 受け入れ基準1〜3を満たす。
