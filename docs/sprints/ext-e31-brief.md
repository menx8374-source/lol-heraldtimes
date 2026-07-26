# 拡張E31 — 記事サムネイル改善: (A)チャンピオン検出→公式スプラッシュ ＋ (B)カテゴリ別の既定画像

運用フィードバック起点。対象: Web。

## 背景（なぜ）
- 現状サムネは「ソース自身の画像(Reddit投稿/クリップ) → 無ければ汎用既定`/default-thumb.svg`」の2段。実データが5ch/Riot中心の今、**ほとんど同じ既定画像**になり見栄えが弱い。
- 要望: (A)記事がチャンピオンの話題なら**そのチャンピオンの公式スプラッシュ**を出す（「リリアの記事ならリリア画像」）。(B)チャンピオンが特定できないときは**カテゴリ別の見栄えする既定画像**を出す。

## サムネ決定の優先順（実装後）
1. **ソース自身の画像**（`candidate.imageUrl` が https で安全なとき）— Reddit投稿/クリップ由来。従来どおり最優先。
2. **チャンピオン・スプラッシュ**（本文＝title+contentからチャンピオンを検出できたとき）。
3. **カテゴリ別の既定画像**（表示時フォールバック。カテゴリに応じて出し分け）。
4. カテゴリ不明時のみ従来の汎用 `/default-thumb.svg`。

## 含まれる機能

### F-E31-1: チャンピオン検出→公式スプラッシュURL
- 新モジュール（例 `src/lib/generation/champion-thumbnail.ts`）に:
  - `buildChampionSplashUrl(id)` = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`（E20で削除したが単純なURLテンプレートなので再定義）。
  - `fetchChampionNameToIdMap()`: Data Dragon の `champion.json`（locale=ja_JP、versionsの最新）を取得し「表示名→championId」のMapを作る純粋な取得関数。**キー不要の公開CDN**。取得失敗/不正時は例外を投げず、**ハードコードのフォールバック表**（主要＋ID不規則なチャンピオンを網羅: 例 ウーコン→MonkeyKing, ヌヌ→Nunu, カイサ→Kaisa, カジックス→Khazix, チョガス→Chogath, コグマウ→KogMaw, レク・サイ→RekSai, ヴェルコズ→Velkoz, ベル=ヴェス→Belveth, リー・シン→LeeSin, マスターイー→MasterYi, ミス・フォーチュン→MissFortune, タム・ケンチ→TahmKench, ツイステッド・フェイト→TwistedFate, シン・ジャオ→XinZhao, オレリオン・ソル→AurelionSol, ジャーヴァンIV→JarvanIV, ドクター・ムンド→DrMundo, ルブラン→Leblanc, レナータ・グラスク→Renata 等）を返す。
  - `detectChampionSplashUrl(text, nameToIdMap): string | null`: text 中に含まれるチャンピオン表示名を**最長一致優先**で検出（「ジンクス」を「ジン」と誤検出しない等）。見つかればそのidのスプラッシュURL、無ければ null。英語表記名もMapにあれば拾う。
- パイプライン(`pipeline.ts`)は run 開始時に `fetchChampionNameToIdMap()` を**1回だけ**取得し、生成に渡す（毎記事フェッチしない）。generate-article はこのMapを任意引数で受け取り、`thumbnailUrl` 決定に使う（Mapが無い/検出無しなら従来どおり）。

### F-E31-2: thumbnailUrl 決定ロジックの更新（generate-article.ts）
- `thumbnailUrl` を次の優先で決める:
  1. `isSafeImageUrl(candidate.imageUrl)` なら `candidate.imageUrl`。
  2. でなければ、渡されたMapで `detectChampionSplashUrl(title+content, map)` が取れれば**スプラッシュURL**（httpsなので isSafeImageUrl を通る）。
  3. どちらも無ければ `null`（表示側でカテゴリ別既定にフォールバック）。

### F-E31-3: カテゴリ別の既定画像（表示フォールバック）
- 4カテゴリ（パッチ/メタ・5chの反応・海外の反応・eスポーツ）ごとに、見栄えする既定サムネSVGを `public/` に用意（例 `default-thumb-<categorySlug>.svg`。既存 `default-thumb.svg` の作りに倣い、カテゴリ色（`CATEGORY_GRADIENTS`）＋カテゴリ名ラベルで差別化。LoLテーマ・オリジナル作成で実在IP画像は使わない）。
- `ArticleThumbnail` コンポーネントに記事のカテゴリ（またはcategorySlug）を渡し、`thumbnailUrl` が無効/未設定なら**カテゴリ別既定**を表示。カテゴリ不明時のみ従来の `/default-thumb.svg`。表示前の `isSafeImageUrl` 二重検証は維持。
- `ArticleThumbnail` を使う呼び出し側（記事カード・PICKUP等）に category を渡す。

## 制約・非目標
- Data Dragon は公開CDN・キー不要。ネットワーク取得は pipeline 開始時1回のみ（generate-article 内でフェッチしない＝テスト容易）。取得失敗はフォールバック表で継続（本体を止めない）。
- 記事タイトル生成(E24-E26)・レス編集(E25/E28)・NG(E27/E29/E30)には触れない。逐語転載に影響しない（サムネのみ）。
- スプラッシュ画像は `<img>` で表示（frame-src CSPはiframe用でimgに影響しない）。新規npm依存なし。
- 既存の title.ts の CHAMPIONS 語彙は流用してよいが、championId対応はこのスプリントで用意する（表示名→IDのMap）。

## テスト（必須・実API非依存）
1. `detectChampionSplashUrl`: 「リサンドラが強い」→ Lissandra のスプラッシュURL。最長一致（「ジンクスは〜」→Jinx、「ジン強い」→Jhin 等、部分誤検出しない）。該当無しは null。
2. `fetchChampionNameToIdMap`: fetchをモックし正常時のMap生成／取得失敗時にフォールバック表を返す（例外を投げない）。
3. generate-article: source画像あり→それ／無くチャンピオン検出→スプラッシュ／どちらも無し→null（Mapはテストでスタブ、実APIを叩かない）。
4. `ArticleThumbnail`: thumbnailUrl無効時にカテゴリ別既定SVGを表示、カテゴリ不明時は汎用既定。有効URLはそれを表示。
5. 既存のサムネ/記事カード/PICKUPテストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green（新規含む・実API非依存）。
2. `npx tsc --noEmit`・`npm run build`・`npm run lint` 通過。
3. チャンピオン話題の記事にそのスプラッシュ、特定不可はカテゴリ別既定、ソース画像優先、が成立。
4. Data Dragon取得失敗でもフォールバックで動く（本体を止めない）。新規依存なし。

## 評価基準（evaluator向け）
- テストGreen・build/tsc/lint通過。実機(mock)でトップ/記事カードのサムネがコンソールエラー0で表示（カテゴリ別既定・スプラッシュ配線が壊れていない）。
- 受け入れ基準1〜4を満たす。
