# 拡張E20 ブリーフ — タイトル重複バグ修正 ＆ Riotチャンピオン紹介記事の廃止

運用フィードバック起点の保守スプリント。2つの独立した変更を含む。対象プラットフォーム: Web（Next.js）。

## 背景（なぜ）
- 実データ運用で「【議論】リサンドラ、リサンドラはMageタイプのチャンピオンがヤバいと話題に」という記事が生成された。
- 原因1: タイトル生成で「主語」と「本文抜粋(core)」が同じ語で始まると重複する（`リサンドラ、リサンドラは…`）。
- 原因2: Riotのチャンピオン紹介は Data Dragon の静的事典データを日替りローテで機械的に選ぶだけで「話題性」が無く、煽り速報タイトルと相性が悪い。運用方針として**チャンピオン紹介記事自体を廃止**する（パッチ検知のみ残す）。

## 含まれる機能

### F-E20-1: タイトルの「主語＝本文冒頭」重複を解消（一般バグ修正）
- 対象: `src/lib/generation/title.ts` の `generateHookTitle`。
- 現状、文字数が足りずフィラー分岐に入ると `` `${prefix}${subject}、${core}${hook}` `` を組むが、`core`（本文抜粋）が `subject`（抽出した主語）と同じ語で始まる場合に「主語、主語は…」と重複する。
- 修正方針: フィラー分岐で組み立てる際、`core` が `subject` で始まるなら**独立した主語部分を省いて** `` `${prefix}${core}${hook}` `` とする（`core` 自体に主語が含まれるため具体要素の要件は維持される）。長さ超過ガードのループ側も同じ組み立てに合わせる。
- これはRiot固有ではなくReddit/5ch由来の本文でも起こりうる一般的なバグとして直す。
- 品質チェッカー `checkTitleQuality` は変更不要（重複を除いてもラベル・具体要素・フック・文字数の要件は満たす）。文字数が MIN(20) 未満になっても既存仕様どおり完結タイトルを許容する。
- **テスト必須**: 「主語と本文冒頭が同じ語で始まるとき、タイトルに主語が二重に出現しない」ことを検証するケースを `src/lib/__tests__/generation-title.test.ts` に追加する。

### F-E20-2: Riotチャンピオン紹介記事の廃止（パッチ検知のみ残す）
- 対象: `src/lib/collection/adapters/riot-datadragon.ts` と `src/lib/__tests__/collection-riot-datadragon.test.ts`。
- `RiotDataDragonAdapter.fetchItems()` から**チャンピオン一覧の取得・チャンピオン事実紹介アイテムの生成を削除**し、**新パッチ検知アイテム（`buildPatchItem`）のみ**を返すようにする。
- それに伴い不要になる以下を**デッドコードとして削除**する（altitude/簡潔性のため残さない）:
  - `selectRotatedChampionIds` / `buildChampionItem` / `buildChampionPageUrl` / `buildChampionSplashUrl` / `ChampionSummary` 型 / `championListUrl` / `ChampionListResponse` 型
  - 定数 `DEFAULT_CHAMPION_WINDOW_SIZE` / `DEFAULT_LOCALE` / `ONE_DAY_MS`、`RiotDataDragonAdapterOptions` の `locale`・`championWindowSize`、フィールド `this.locale`・`this.championWindowSize`
  - `versions.json` 取得は引き続き必要（最新パッチ判定に使う）。`buildPatchItem`/`buildPatchNoteUrl`/`patchSlug` は残す。
- `src/lib/collection/adapters/http.ts` の `fetchJsonSafe` はまだ使うので残す。
- テスト更新: `collection-riot-datadragon.test.ts` からチャンピオン関連の describe/it を削除し、`fetchItems` のテストを「新パッチ検知1件のみを返す」「champion.json は取得しない」に更新する。パッチ関連テストは維持。
- `.env.example` の `RIOT_DDRAGON_LOCALE` 行は未使用になるため削除する（COLLECTION_RIOT_MAX_ITEMS等の他コメントは据え置き）。
- 記事生成側（`generate-article.ts`）の imageUrl／サムネイル配管は Reddit/clip で引き続き使うため**変更しない**（Riotのパッチ記事は imageUrl 無し＝既定サムネにフォールバックで正しい）。カテゴリ定義（riot→「パッチ/メタ」）も維持。

## 受け入れ基準（検証可能な形で）
1. `npx vitest run` が全Green。F-E20-1の新規テストを含む。
2. `generateHookTitle({title:"【チャンピオン紹介】リサンドラ（氷の魔女）", content:"リサンドラはMageタイプのチャンピオン。（以下略）"})` の返り値に「リサンドラ」が**2回以上出現しない**。
3. `RiotDataDragonAdapter.fetchItems()` は、versions と champion のfetchをモックした状態で**新パッチ検知1件のみ**を返し、`/champion.json` へのfetchが**発生しない**。
4. `npx tsc --noEmit` と `npm run build` が通る（未使用シンボル・未使用importが残っていない）。
5. `npm run lint`（eslint）が通る。
6. 既存の他ソース（Reddit/clip/5ch）・記事生成・タイトル品質チェッカー・サムネイル表示の挙動は不変（回帰なし）。

## 評価基準（evaluator向け）
- テストスイートGreen（テスト失敗が1件でもあればFAIL）。
- アプリが起動し、トップページ・記事一覧・記事詳細がコンソールエラー0で表示される（実データ有無に依らずレンダリングできる）。
- 上記受け入れ基準1〜6を満たす。
