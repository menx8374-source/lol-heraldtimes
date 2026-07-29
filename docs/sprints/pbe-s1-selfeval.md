---
tags: [sprint-selfeval]
sprint: PBE-S1
---

# PBE-S1 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/cdragon-pbe.ts`（新規）
  - `fetchCDragonVersions()`: `raw.communitydragon.org/{pbe,latest}/content-metadata.json` から `version` を抽出。取得失敗・不正形はチャンネルごとに `null`。
  - `fetchPbeItems(locale)`/`fetchLatestItems(locale)`: `.../{pbe,latest}/plugins/rcp-be-lol-game-data/global/{default,ja_jp}/v1/items.json` を取得。非2xx・不正JSON・ネットワーク断は空配列。必須フィールドを満たさない要素は個別に除外（`isCDragonItem`）。
  - `buildJaNameMap(jaItems)`: id→日本語名マップの組み立てヘルパ。
  - `buildCDragonItemIconUrl(iconPath)`: `raw.communitydragon.org/pbe/game/<path小文字>` 形式のアイコンURLを組み立て。
  - いずれも既存 `fetchJsonSafe`（タイムアウト付き・信頼境界エラーハンドリング）を再利用。新規npm依存なし。
- `src/lib/generation/pbe-item-diff.ts`（新規、純関数）
  - `diffItems(pbeItems, latestItems, jaNames?)`: id一致で `priceTotal`/`description`内`<stats>`ブロック/`description`残り部分/`from`/`to`/`inStore` を比較し、変更のあったアイテムだけを `PbeItemChange[]` で返す。`before`=latest(現行live)、`after`=pbe(次パッチ候補)。変化なしは対象外（0件で空配列）。
  - `toArticleBodyPatchChangeBlock(change)`: `PbeItemChange` を既存 `ArticleBodyPatchChangeBlock`（`kind:"item"`、`direction`固定`"adjust"`）へ変換する型のみの実装（F-PBE1-3）。実際の記事化・呼び出し配線はP4以降で行う想定であり、本スプリントではcompose/pipeline/表示のどこからも呼び出していない。

## 技術選定
- 追加ライブラリなし。既存 `fetchJsonSafe`（http.ts）・既存 `decodeHtmlEntities`（riot-datadragon.ts）を再利用し、新規ファイルのみで完結させた（architecture.mdのベースライン=既存Next.js/TypeScript/vitest構成を踏襲、変更なし）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（113ファイル / 1508テスト全パス。新規テスト20件含む）。`npx tsc --noEmit` エラー0。`npm run build` 成功。`npm run lint` エラー0（既存の無関係な警告6件のみ、今回のファイルは対象外）。
- [x] CDragon PBEのバージョン差判定（`fetchCDragonVersions`）とアイテム数値diff（`diffItems`、日本語名付き・逐語・変更分のみ）が純関数で動作することをテストで確認。スキル効果量（`effectAmounts`/`coefficients`）は型・実装のいずれにも存在せず一切扱っていない。
- [x] AI不使用（数値/構造/JSONパースのみ）・逐語維持（before/afterは元データの文字列をタグ除去したのみ、数値・文言の捏造なし）・DBスキーマ変更なし・新規npm依存なし・既存挙動に影響ゼロ（`git status --short` で新規ファイルのみが差分であることを確認済み。既存の `compose.ts`/`riot-datadragon.ts`/`pipeline.ts`/`article-body.ts` 等は一切変更していない）。

## アプリの起動方法
本スプリントはバックエンド取得層＋純関数のみで画面変更は無し。検証は以下のコマンドで完結:
- `npx vitest run`（全テスト）
- `npx vitest run src/lib/__tests__/collection-cdragon-pbe.test.ts src/lib/__tests__/generation-pbe-item-diff.test.ts`（本スプリント分のみ）
- `npx tsc --noEmit`
- `npm run build`
- `npm run lint`
アプリ自体の起動が必要な場合は既存どおり `npm run dev`（ポート3000既定）。本スプリントの機能はUIに未接続のため起動確認は不要（自己確認用サーバーは起動していない）。

## 既知の問題・懸念点
- CDragonの `items.json` には研究時に想定していた独立の `stats` フィールドは実在せず、`description` 内の `<stats>...</stats>` タグに埋め込まれている（実測で確認）。そのため `diffItems` では `description` を「`<stats>`部分（ラベル「ステータス」）」と「それ以外（ラベル「説明」）」に分けてタグ除去のうえ逐語比較する設計にした（研究doc §3.4の「アイテムはラベル明瞭」という結論に沿うが、独立フィールドではなくタグ抽出である点を明記）。
- PBEにのみ存在する完全新規アイテム（latest側に対応する要素が無い）は、安全な逐語diffの基準データが無いため対象外にした（捏造回避を優先）。既存アイテムの `from`/`to`/`inStore` の変化（新規アイテム追加・削除に伴う波及）はテストで検証済み。
- `toArticleBodyPatchChangeBlock` の `direction` は本スプリントでは常に `"adjust"` 固定（buff/nerf自動判定はスコープ外、P2以降の検討事項）。
- 本スプリントで新規npm依存の追加は無く、キャッシュ衛生管理の対象作業（新規パッケージインストール）も発生しなかった。

## 追加したテスト
- `src/lib/__tests__/collection-cdragon-pbe.test.ts`: バージョン取得（正常/HTTPエラー/ネットワーク断/不正形）、items取得（正常/ja_jpロケール/不正要素の除外/非2xx・不正JSON・ネットワーク断で空配列）、`buildJaNameMap`/`buildCDragonItemIconUrl`。実HTTPは叩かず`fetch`をモック。実URL（`pbe/content-metadata.json`・`latest/content-metadata.json`・`items.json`のdefault/ja_jp）は curl で実在確認済み（下記参照、テストコード自体はモック固定フィクスチャのみ使用）。
- `src/lib/__tests__/generation-pbe-item-diff.test.ts`: 変更アイテムのみが逐語before→afterで返る／変化なしは空／素材(from)のアイテム名解決／完全新規アイテムの除外／日本語名フォールバック／異常系（空配列・不整合入力）で例外なし／スキル効果量に相当するラベルが出力に一切現れないこと／`toArticleBodyPatchChangeBlock`への変換。

### 実URL確認（curlで実測、実装テストでは叩いていない）
```
$ curl -s https://raw.communitydragon.org/pbe/content-metadata.json
{"version": "16.16.8000032+branch.main.content.beta"}
$ curl -s https://raw.communitydragon.org/latest/content-metadata.json
{"version": "16.15.7996036+branch.releases-16-15.content.release"}
$ curl -s https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/default/v1/items.json
[{"id":1001,"name":"Boots","description":"<mainText><stats>...", ...}] (868件)
$ curl -s https://raw.communitydragon.org/pbe/plugins/rcp-be-lol-game-data/global/ja_jp/v1/items.json
[{"id":1001,"name":"ブーツ", ...}] (日本語名を確認)
```

## 関連ドキュメント
- [[pbe-s1-brief]]（本スプリントの仕様抜粋）
- [[pbe-research]]（設計根拠となる実測リサーチ）
