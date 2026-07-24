---
tags: [sprint-selfeval]
sprint: 3
---

# Sprint 3 自己評価レポート

## 実装した内容
- Prisma スキーマに `CollectedItem`（収集アイテム。`normalizedUrl` に unique 制約）・`SourceFetchLog`（実行ログ）を追加し、マイグレーション `20260724202921_add_collected_items` を適用。
- `src/lib/collection/`: 収集・重複排除の純ロジックとDB連携を分離して実装。
  - `types.ts` — `SourceAdapter` 抽象・共通フォーマット型。
  - `normalize.ts` — URL正規化（ホスト小文字化・トラッキングパラメータ除去・末尾スラッシュ除去・ハッシュ除去）。
  - `similarity.ts` — 文字bi-gram Jaccard係数による同一話題判定（LLM非依存・決定論的）。
  - `filter.ts` — LoL関連フィルタ（サブレディット許可リスト・タイトルキーワード）。
  - `rate-limit.ts` — 実行間隔判定・件数上限切り詰め。
  - `config.ts` — ソースごとの上限・間隔・キーワード設定（env上書き可）。
  - `collect-source.ts` — 1ソース分の収集ロジック（DB非依存、アダプタfetch失敗を捕捉しfailure結果化）。
  - `dedupe.ts` — 同一URL重複統合・既存記事URL除外・類似話題クラスタリング・候補キュー組み立て（すべて純関数）。
  - `pipeline.ts` — 全ソース収集の実行・永続化・実行ログ記録（DB連携。1ソース失敗が他を止めない設計）。
  - `queue.ts` — 候補キュー再構築のDB連携（status: pending/queued/duplicate/articled）。
  - `adapters/mock.ts`, `adapters/index.ts` — fixture読込のMockアダプタとmock↔live切替レジストリ（live は未実装で明示的にエラー）。
  - `fixtures/{reddit,5ch,riot}.json` — サンプル収集データ（出典欠落・無関係アイテム・同一話題の別URLペアを意図的に含む）。
- `scripts/collect.ts`（`npm run collect`）— 収集→候補キュー再構築→結果サマリ表示の単独実行スクリプト。
- Vitest 単体テストを44件追加（既存23件と合わせて計67件）。

## 技術選定
- 類似度判定はLLMを使わず文字bi-gram Jaccard係数を採用（architecture.md方針「判定系ロジックはLLM非依存の純関数」に準拠）。日本語分かち書き不要で決定論的・テスト容易。トレードオフとして言語をまたいだ類似判定（例: 英語Redditと日本語Riot公式の同一トピック）はできない点をarchitecture.mdに明記した。
- `CollectedItem.normalizedUrl` にDBレベルのunique制約を張り、同一URL再取込みをupsertで自然に1件化（アプリ側の追加ロジック不要）。

## 受け入れ基準チェック（自己申告）
- [x] 収集実行でreddit/5ch/riotそれぞれから共通フォーマット（ソース種別・元URL・原題・本文/抜粋・取得日時）の収集アイテムが保存される — `npm run collect` 実行で確認（reddit fetched=6/saved=4, 5ch fetched=4/saved=2, riot fetched=2/saved=2）。
- [x] 出典（元URL）を持たないアイテムは保存されない — fixture各ソースに空/nullのsourceUrlアイテムを含め、`toCollectionItems`で除外されることをテストで確認。実行結果のsaved件数もそれを反映。
- [x] ソースごとの取得件数上限・実行間隔が設定として存在し、上限超過の連続取得をしない — `config.ts`にソースごとの`maxItemsPerRun`/`minIntervalMsBetweenRuns`。`npm run collect`を連続実行すると2回目は全ソース`skipped-rate-limited`になることを実機確認済み。
- [x] LoL関連限定フィルタが働き無関係アイテムが混入しない — fixtureに別ゲーム/無関係スレッドを含め、`isRelevantItem`で除外されることをテスト・実行結果双方で確認。
- [x] 1ソースの取得失敗時も他ソース収集が完走し、失敗が記録される — 一時スクリプトでriotアダプタを意図的に例外送出させ、reddit/5chはsuccess・riotはfailureとしてSourceFetchLogに記録されることを実DBで確認済み（自己評価用の一時実行で、恒久ファイルは残していない）。ユニットテストでも同様のシナリオをカバー。
- [x] 同一URL（正規化後）を2回取り込んでも記事化候補は1件 — `dedupeByNormalizedUrl`のテスト・DBの`normalizedUrl` unique制約（upsert）で担保。
- [x] タイトル・本文が高類似度の別URL同士を同一話題として検出し片方のみ候補に — reddit fixture内の2件（Discussion Thread / Megathread、別URL・高類似）が実行結果で1件（duplicate=1）に収束することを確認、`clusterBySimilarTopic`テストでも検証。
- [x] 既に記事化済みのソースが再度候補にならない — riot fixtureのパッチノートURLがSprint 1シード記事の出典URLと一致し、`alreadyArticled=1`として候補から除外されることを実行結果で確認。ユニットテストでも検証。
- [x] 重複を含む入力セットで候補キューに一意な話題だけが残る — `buildCandidateQueue`の統合テスト（同一URL重複＋類似話題重複＋記事化済み＋無関係、を1セットで検証）と`npm run collect`実行結果（8件収集→queued=6のみ残存）の両方で確認。

## アプリの起動方法
```bash
npm install
npx prisma migrate dev   # 未適用の場合のみ（本スプリントのマイグレーションを含め適用）
npm test                 # Vitest 67件（本スプリント44件含む）
npm run collect           # 収集パイプライン実行（reddit/5ch/riot→重複排除→候補キュー再構築、結果をコンソール表示）
npx prisma studio         # 任意: CollectedItem/SourceFetchLog テーブルをブラウザで閲覧
```
- 現在の`prisma/dev.db`は「1回目の収集実行直後」の状態にリセット済み（queued=6, duplicate=1, alreadyArticled=1, 収集アイテム総数=8, SourceFetchLogは各ソース1件のsuccess）。この状態から直後に`npm run collect`を再実行すると、既定の実行間隔（reddit/5ch=10分, riot=30分）内のため全ソースが`skipped-rate-limited`になる（これは正常な仕様どおりの挙動であり、レート制限の実機確認そのもの）。すぐに再度「成功」パスを見たい場合は`.env`に`COLLECTION_REDDIT_MIN_INTERVAL_MS=0`等を設定するか、`npx prisma studio`で`SourceFetchLog`を削除してから再実行する。

## 既知の問題・懸念点
- 類似度判定（文字bi-gram Jaccard）は言語非依存だが、言語をまたいだ同一トピック検出はできない（例: 英語Redditのjungleナーフ記事と日本語5chの同話題は別候補として残る）。実用上、同一言語内の重複検出という受け入れ基準は満たすが、将来LLMベースの意味的重複判定に置き換える余地がある旨をarchitecture.mdに明記した。
- live収集アダプタ（本番Reddit/5ch/Riot API接続）は未実装（`adapters/index.ts`で呼び出すと明示的にエラー）。本接続は認証情報待ち・別スプリントでの対応方針どおり、モック実装で代替。
- `/security-review`・`/code-review`はこのローカル専用パイプライン構成では自動起動できない既知の制約（`reference/learnings.md`記載どおり）。オーケストレーター側の手動レビューに委ねる。
- npm audit・依存追加なし（今回新規パッケージの追加は無し）のため脆弱性スキャンは対象外。

## 追加したテスト
- `collection-normalize.test.ts`（7件）— URL正規化の表記ゆれ吸収。
- `collection-similarity.test.ts`（7件）— bi-gram Jaccard係数・同一話題判定。
- `collection-filter.test.ts`（8件）— サブレディット許可・キーワード一致・LoL関連判定。
- `collection-rate-limit.test.ts`（6件）— 実行間隔判定・件数上限切り詰め。
- `collection-dedupe.test.ts`（6件）— 同一URL統合・記事化済み除外・類似クラスタリング・候補キュー組み立て（重複を含む入力セットでの一意化を含む）。
- `collection-collect-source.test.ts`（7件、内1件は複数assertion含むPromise.all検証）— 出典URL必須・関連フィルタ・件数上限・レート制限・失敗捕捉・他ソース継続。
- 実行結果: `npm test` で全12ファイル・67テストがGreen（既存23件＋本スプリント44件）。

## 関連ドキュメント
- [[sprint-3-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
