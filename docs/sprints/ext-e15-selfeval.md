---
tags: [sprint-selfeval]
sprint: E15
---

# Sprint E15 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/riot-datadragon.ts`: `RiotDataDragonAdapter implements SourceAdapter`（`sourceType:"riot"`）を新設。
  - 取得元: `versions.json`（先頭=最新）→ `cdn/<version>/data/<locale>/champion.json`（既定locale `ja_JP`、`RIOT_DDRAGON_LOCALE`で上書き可）。
  - 生成アイテム1: **新パッチ検知**。`sourceUrl`は`patchSlug(version)`（major.minor、revision無視）から構築した公式パッチノートURL。同一パッチ(revision違い)は同一URLになりdedupが効く。
  - 生成アイテム2: **チャンピオン事実紹介**。`name`/`title`/`blurb`/`tags`から事実タイトル＋content。`sourceUrl`はチャンピオンID(patch非依存)から構築した公式チャンピオンページURLで安定・一意。
  - **ローテーション**: `selectRotatedChampionIds(allIds, now, windowSize)`。チャンピオンIDをソートし、`floor(now/1日)`を使った日次オフセットで固定幅の窓を選ぶ純関数。日が変わると窓がずれ、日を跨いで全チャンピオンを順次網羅（既存分は再取得してもupsertで重複しない）。窓幅は既定15件(`DEFAULT_CHAMPION_WINDOW_SIZE`)。
  - **信頼境界**: `fetchJson`が`AbortSignal.timeout(8000ms)`付きfetchを行い、HTTPエラー(`!res.ok`)・JSONパース失敗・fetch自体のreject(ネットワーク断)いずれも`console.error`でログしつつ`null`を返す。versions取得失敗時は`fetchItems()`が空配列を返す。champion取得のみ失敗した場合は新パッチ検知アイテムだけを返す（部分的失敗で全体を止めない）。
- `src/lib/collection/adapters/index.ts`: `getAdapter`/`getAllAdapters`を段階的live対応に変更。
  - `LIVE_ADAPTER_FACTORIES`にriotのみ登録。`getAdapter(type,"live")`はriotなら実装を返し、reddit/5chは従来どおり「未実装」でthrow。
  - `getAllAdapters("live")`はSOURCE_TYPESを順にtryし、未実装はcatchしてログ後スキップ（riotのみ含む配列を返す）。`getAllAdapters("mock")`の挙動は変更なし（従来どおり全ソース）。
- `.env.example`・`README.md`に`COLLECTION_MODE=live`でriotのみ本接続になる旨・`RIOT_DDRAGON_LOCALE`（任意、既定`ja_JP`）を追記。

## 技術選定
- 新規依存なし。Node標準の`fetch`(Node 24)＋`AbortSignal.timeout`でタイムアウト実装（HTTPクライアントライブラリ追加を回避、ブリーフの指示どおり）。

## 受け入れ基準チェック（自己申告）
- [x] `RiotDataDragonAdapter`がData Dragon(versions/champion, ja_JP)から取得し、新パッチ検知＋チャンピオン事実アイテムを`RawCollectionItem[]`で返す。実ネット実行で確認済み（後述）。
- [x] 各アイテムの`sourceUrl`が一意・安定。パッチは`major.minor`単位、チャンピオンはID単位でversionに依存しないURL。テストで検証。
- [x] チャンピオンは実行日でローテーションし複数回実行で新しいチャンピオンが順次収集される。純関数テストで日ごとに選択結果が変わることを確認。同日内の再実行は同じ窓→upsertで重複しない（実ネット確認で総数不変）。
- [x] fetchのタイムアウト/HTTPエラー/不正JSON/ネットワーク断で例外を投げず空配列を返す。テストで4パターン(HTTPエラー/不正JSON/reject/champion側のみ失敗)を検証。
- [x] `COLLECTION_MODE=live`でriotだけlive、reddit/5chは「未実装」でスキップ。`getAllAdapters("live")`がriotのみ含む。mockモードは全ソース従来どおり。テスト＋実ネット実行で確認。
- [x] `npm test`全てGreen（fetchモックのオフラインテスト。実ネットワークに出ない）。tsc/build/eslint通過。
- [x] 新規npm依存なし・秘密のハードコードなし（Data Dragonはキー不要）。

## テスト結果
- `npx tsc --noEmit`: エラーなし。
- `npm test`: **571 tests passed (66 files)**。新規追加: `collection-riot-datadragon.test.ts`(純関数・アダプタfetch成功/失敗パターン)、`collection-adapters-registry.test.ts`(getAdapter/getAllAdaptersのlive段階対応・mock回帰)。既存テストは変更なく全Green。
- `npm run build`: 成功（Next.js本番ビルド完了、型チェック含む）。
- `npx eslint`（変更ファイルのみ）: 指摘なし。

## 実ネットワーク確認
- `COLLECTION_MODE=live npx tsx scripts/collect.ts` を実行し、本物のData Dragon CDNから取得できることを確認。
  - 結果: `[riot] success: fetched=16 saved=16`（新パッチ検知1件＋チャンピオン15件）、reddit/5chは`未実装のためスキップします`のログの上でスキップ。
  - 同日内に再実行しても`fetched=16 saved=16`のまま収集アイテム総数(DB)は変化せず（`normalizedUrl`一意制約によるupsertで重複増加しないことを確認）。
  - **注意**: この検証によりローカルの`prisma/dev.db`（gitignore対象、成果物ではない）に実際のRiot Data Dragon由来データが追加されています。評価時に`npx prisma studio`等でDBを確認する場合、mock fixtureデータと実データが混在している点に留意してください（機能上の問題はありません）。

## アプリの起動方法
- 収集パイプライン単発実行: `npm run collect`（mockモード、既定）
- live収集確認: `COLLECTION_MODE=live npm run collect`（riotのみ実データ収集、reddit/5chはスキップ）
- テスト: `npm test`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- 開発サーバー: `npm run dev`（http://localhost:3000）※本スプリントでは起動不要のため未起動

## 既知の問題・懸念点
- Data Dragonが提供するのは静的データのみのため、パッチノート本文・eスポーツ記事のプローズは対象外（ブリーフの明記通り、本スプリントのスコープ外）。
- チャンピオンページURLは`https://www.leagueoflegends.com/ja-jp/champions/<id小文字>/`という規約で構築しているが、Riot公式サイトの実際のスラッグは一部レガシーチャンピオン(例: 内部id "MonkeyKing"=悟空 等)で異なる可能性がある。URLの一意性・安定性（dedup要件）は満たすが、実在ページと厳密に一致しない場合がある点は既知の制約。
- ローテーション窓幅(既定15件)は固定値。将来env化の余地はあるが、ブリーフが要求する「常識的な範囲の候補を返す」を満たすため今回は環境変数化していない。

## 追加したテスト
- `src/lib/__tests__/collection-riot-datadragon.test.ts`: 純関数(`buildPatchNoteUrl`/`buildPatchItem`/`buildChampionPageUrl`/`buildChampionItem`/`selectRotatedChampionIds`)のユニットテスト、および`RiotDataDragonAdapter.fetchItems`を`global.fetch`スタブでオフライン検証（成功系・locale反映・HTTPエラー/不正JSON/reject/champion側のみ失敗の4種の異常系）。
- `src/lib/__tests__/collection-adapters-registry.test.ts`: `getAdapter("riot","live")`が実装を返す・`getAdapter("reddit"/"5ch","live")`が「未実装」でthrow・`getAllAdapters("live")`がriotのみ含む・`getAllAdapters("mock")`が従来どおり全3ソースを返す回帰確認。

## 関連ドキュメント
- [[ext-e15-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
