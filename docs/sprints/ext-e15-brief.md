# 拡張スプリント E15: Riot 収集の本接続（Data Dragon・キー不要）

対象プラットフォーム: web（既存アーキテクチャに従う）／フェーズ2「実データ収集の本接続」の第1弾。

## 背景・スコープ
`SourceAdapter`（`src/lib/collection/`）は現状 fixture の mock のみで、`getAdapter(mode="live")` は throw する。
まず**キー不要で最もリスクの低い Riot の Data Dragon**（公式の静的データCDN）から live 実装を追加する。

**Data Dragon が提供するのは「公式の静的データ」（バージョン一覧・チャンピオン/アイテム等）であり、
パッチノート本文やeスポーツ記事のプローズは含まれない。** よって本スプリントのRiot live収集が生むのは
「新パッチ（バージョン）検知の事実速報」と「チャンピオンの公式データに基づく事実紹介」の2種。これはRiot由来の
**事実フォーマット記事**（`compose.ts` の非reaction形式）として自然に流れる。パッチノート本文・eスポーツ詳細は
本スプリント対象外（将来キー付きRiot API/別ソースで拡張）。

## 含まれる機能

### F-E15-1: Riot Data Dragon の live アダプタ
- `RiotDataDragonAdapter implements SourceAdapter`（`sourceType: "riot"`）を新設し、Data Dragon から取得して
  `RawCollectionItem[]`（`{ sourceUrl, title, content, fetchedAt }`）を返す。**外部CDNは全てキー不要**。
- 取得元（すべて公開・キー不要）:
  - バージョン一覧: `https://ddragon.leagueoflegends.com/api/versions.json`（先頭=最新パッチ）
  - チャンピオン一覧(日本語): `https://ddragon.leagueoflegends.com/cdn/<version>/data/ja_JP/champion.json`
- 生成するアイテム:
  1. **新パッチ検知**: 最新versionから「【パッチ】<X.Y> のゲームデータが公開」等の事実タイトル＋事実content（新バージョンのデータが反映された旨・主要な数値ではなくバージョン事実のみ）。`sourceUrl` は公式パッチノートページURL（versionから構築。例 `https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-<x-y>-notes/`）で**パッチごとに一意**（同一パッチの再収集は normalizedUrl 一意制約で自然に重複排除される）。
  2. **チャンピオン事実紹介**: `champion.json` の各チャンピオン（`name`/`title`/`blurb`/`tags`）から「<name>（<title>）」等の事実タイトル＋公式blurbベースのcontent。`sourceUrl` は**チャンピオンごとに一意**（例 公式チャンピオンページ or ddragonのチャンピオンJSON URL）。毎回同じ順で返すと初回以降dedupで新規0になるため、**実行日ベース等で対象チャンピオンをローテーション**して返し（`new Date()` を使ってよい＝アプリ実行時コード）、時間をかけて全チャンピオンを網羅しつつ重複を出さない。
- 件数上限は既存どおり呼び出し側（pipeline）が `config.ts` の `COLLECTION_RIOT_MAX_ITEMS` で適用するので、アダプタは候補を返すだけでよい（過剰に大量返さず、常識的な範囲に）。
- **信頼境界（外部API）**: fetch はタイムアウト付き、JSON パース失敗・HTTPエラー・ネットワーク断は**握り潰して空配列を返す**（例外を投げてパイプライン全体を止めない＝既存「1ソースの失敗は他ソースを止めない」方針）。ログは残す。
- locale は既定 `ja_JP`、任意で env（例 `RIOT_DDRAGON_LOCALE`）で上書き可能に。

### F-E15-2: live アダプタの段階的レジストリ
- `getAdapter(sourceType, "live")`: **実装済みソースは live 実装を返し、未実装ソース（reddit/5ch）は従来どおり分かりやすい「未実装」エラー**にする（今後のスプリントで追加）。
- `getAllAdapters("live")`: **live 実装があるソースのみを含める**（未実装ソースは throw で全体を止めず、スキップして `log` に一言残す）。これで `COLLECTION_MODE=live` を今すぐ Riot だけで運用開始でき、reddit/5ch は各スプリントで追加していける。
- mock モードの挙動（全ソース fixture）は一切変えない。

## 実装原則（CLAUDE.md）
- テスト必須(TDD-lite): **`global.fetch` を vitest でモック**し、記録した Data Dragon JSON（versions/champion）を使ってオフラインで検証する（テストで実ネットワークに出ない）。検証観点: (a) versions/champion のパース→`RawCollectionItem`整形、(b) パッチ/チャンピオンの `sourceUrl` が一意で安定（dedupが効く形）、(c) チャンピオンのローテーションで実行日により対象が変わる（`now`を注入可能にしてテスト）、(d) fetch失敗/HTTPエラー/不正JSON→空配列（throwしない）、(e) locale反映。純粋な整形ロジックは純関数に切り出す。
- **新規依存は追加しない**（Node標準の `fetch` を使う。HTTPクライアントライブラリを足さない）。シークレットのハードコード禁止（Data Dragonはキー不要）。
- 既存の収集パイプライン（`pipeline.ts`・`dedupe`・`queue`・`filter`・rate-limit）の契約を壊さない。mockの全テストGreenを維持。
- `.env.example` に「`COLLECTION_MODE=live` で実装済みソース(riot)がlive収集になる」「Data Dragonはキー不要」「任意 `RIOT_DDRAGON_LOCALE`」を追記。README にも最小限追記。
- サーバー/スクリプトのライフサイクル: 自己確認で起動したものは自己評価レポート作成前に停止。

## 受け入れ基準（検証可能・原文）
- [ ] `RiotDataDragonAdapter` が Data Dragon（versions/champion, ja_JP）から取得し、新パッチ検知アイテム＋チャンピオン事実アイテムを `RawCollectionItem[]` で返す。
- [ ] 各アイテムの `sourceUrl` が一意・安定で、同一パッチ/同一チャンピオンは normalizedUrl 一意制約で重複排除される（同じ記事が二重に増えない）。
- [ ] チャンピオンは実行日等でローテーションし、複数回実行で新しいチャンピオンが順次収集される（初回以降0件で止まらない）。
- [ ] fetch のタイムアウト/HTTPエラー/不正JSON/ネットワーク断で例外を投げず空配列を返し、パイプライン全体を止めない。
- [ ] `COLLECTION_MODE=live` で **riot だけ live**、reddit/5ch は「未実装」でスキップ（`getAllAdapters("live")` が riot のみ含む）。mockモードは全ソース従来どおり。
- [ ] `npm test` 全てGreen（fetchモックのオフラインテスト。実ネットワークに出ない）。tsc/build/eslint通過。
- [ ] 新規npm依存なし・秘密のハードコードなし。

## 評価基準（evaluator向け）
- 致命的バグ0件／コンソール・実行エラー0件／上記受け入れ基準の充足率100%／テストGreen。1つでも下回れば全体FAIL。
- **可能なら実ネットワークで1回だけ本物の Data Dragon を叩いて確認**（公開・キー不要で安全）: `COLLECTION_MODE=live npm run collect` を実行し、riot の実データが収集され記事化候補に載る／reddit・5ch はスキップされることを確認。ネットワーク不可の環境ならその旨をレポートの「検証モード」に明記し、fetchモックのテストGreen＋mockモードの回帰確認に縮退してよい（実ネット不可はFAID根拠にしない）。
- 既存の収集パイプライン（mock）・記事表示・各機能に回帰が無いこと。
