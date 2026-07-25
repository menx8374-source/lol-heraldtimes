---
tags: [sprint-selfeval]
sprint: reformat-matome
---

# 記事フォーマット改修（まとめ速報レス形式） 自己評価レポート

## 実装した内容
- `src/lib/article-body.ts`: `ArticleBodyBlock` に `reaction` 型を追加（番号・匿名化ハンドル名・複数行・行ごとの強調(red/orange)・アンカー番号配列）。`parseArticleBody` が新旧両方の型を検証。共通ヘルパー `blockText()` を新設し、検索・文字数計算・安全フィルタ抽出の重複実装を集約（既存の技術的負債メモの一部を本改修のついでに解消）。
- `src/lib/generation/thread-format.ts`（新規）: スレッドダンプ形式のcontentテキスト（`"1: 本文\n2行目\n\n2: >>1\n..."`）を、レス番号・本文行の配列にパースする純関数群。フォーマット不一致時は全体を1件のレスにフォールバック。アンカー(`>>N`)抽出、重要行の赤強調ヒューリスティック（キーワード一致・1レス0〜1行）、アンカー行のオレンジ強調も実装。
- `src/lib/generation/compose.ts`: 5ch/reddit由来は「話題」→「寄せられたレス」→「まとめ」構成で、収集スレッドのレス群を逐語のまま `reaction` ブロックとして並べる。名前はソース種別ごとに固定（5ch=国内プレイヤーさん、reddit=海外プレイヤーさん）。riot由来は従来の「速報＋要点整理」構成を変更なしで維持。未使用になった旧 `reaction-summary` タスク種別は `llm-client.ts` から削除。
- `src/lib/generation/generate-article.ts`: `sourceType !== "riot"`（reaction形式）の記事は**逐語一致率チェック・引用主従比率チェックをスキップ**。最低文字数チェックは形式によらず維持。
- `src/lib/collection/fixtures/5ch.json` / `reddit.json`: 日本語の複数レス・アンカー入りスレッドダンプに置き換え。NGワード＋個人中傷を含む「保留されるべきスレッド」を5ch fixtureに1件追加（F9デモ用）。
- `src/components/article-body-view.tsx`: `reaction` ブロックを「番号: 名前（緑）」＋本文複数行＋赤/オレンジ強調で描画する `ReactionResView` を追加。既存のheading/paragraph/quote描画は変更なし。
- `prisma/seed.ts`: 5ch/海外の反応カテゴリの記事5本の本文をreactionブロック形式に更新（アンカー・強調含む）。Riot公式カテゴリの記事は従来の速報形式のまま。
- `src/app/articles/[slug]/page.tsx`: 記事本文にreactionブロックを含む場合、注記文言を「本記事は掲示板・SNSの反応を引用・転載してまとめたものです。AIにより自動編集されており、内容は変動し得ます。」に変更（従来のAI自動生成注記はriot形式の記事に維持）。出典・非公認ディスクレーマー（フッター）・法務ページは変更なし。
- `src/lib/search.ts` / `src/lib/seo.ts` / `src/lib/generation/quote-ratio.ts`: `blockText()` 経由に統一し、reactionブロックを含む本文でも検索・メタディスクリプション・引用比率計算が壊れないようにした。

## 技術選定（該当する場合のみ）
- 新規ライブラリの追加なし。既存のブロック配列モデル（DB: Prisma Json列）を拡張する形で実装し、architecture.md のベースライン（Next.js/Prisma/SQLite/Vitest/決定論モックLLM）は変更していない。
- スレッド本文の構造化は、収集データモデル（`CollectedItem.content: String`）を変更せず、「レス番号: 本文」という軽量なテキスト規約＋純関数パーサーで表現する方式を選択（スキーマ変更・アダプタ抽象の再設計を避け、スコープを本改修に限定するため）。

## 受け入れ基準チェック（自己申告）
- [x] 各レスが「番号: 名前」（名前は緑）で表示される — `ArticleBodyView` の `ReactionResView` で実装、実機確認済み（`text-green-700` 適用を確認）。
- [x] レス本文は複数行そのまま（逐語）表示される — `parseThreadReses` が行単位でそのまま保持、`generate-article.ts` が逐語一致率チェックをreaction形式でスキップ。
- [x] 重要・面白い行を赤/オレンジで強調（1レス0〜1行程度） — `computeLineEmphasis` で決定論的に実装、実機で `text-red-600`/`text-orange-600` を確認。
- [x] `>>N` アンカー表示（オレンジ） — `extractAnchors` で既出番号のみ抽出し `anchors` に格納、行自体も `>>N` を含めばオレンジ表示。実機で `&gt;&gt;1` の描画とオレンジクラスを確認。
- [x] 匿名化ハンドル（国内プレイヤーさん／海外プレイヤーさん） — 実名・個人特定情報なし。
- [x] F7の逐語一致率・引用主従比率チェックをreaction形式で無効化 — `generate-article.ts` で `sourceType !== "riot"` のとき両チェックをスキップ。riot形式では従来どおり適用（テストで確認）。
- [x] F9安全フィルタ（NGワード・個人中傷・出典欠落・重複）は維持 — `moderateArticleContent` は変更なし。reactionブロックの本文も `blockText`/`bodyBlocksToText` 経由で判定対象に含めた（テスト・実パイプライン実行の両方でNGワードを含むレスを含む記事が `held(理由:personal_attack)` になることを確認）。
- [x] 5ch/Reddit → まとめ速報レス形式、Riot公式 → 従来の速報＋要点整理形式（構成分岐維持） — テスト・実機とも確認。
- [x] 出典リンク・AI/まとめ注記・Riot非公認ディスクレーマー維持 — reaction形式記事は「引用・転載」である旨の注記に変更（F15の出典表示・フッターの非公認表記は変更なし）。

## アプリの起動方法
```
npm run db:seed     # サンプル記事(12件)投入。既存Article/Tagを削除して再投入
npm run pipeline     # 収集(fixture)→重複排除→生成→安全フィルタ→公開を1回実行
npm run build && npm run start   # 本番ビルド・起動（http://localhost:3000）
```
- 環境変数変更なし（`.env.example` の更新不要）。
- ポート: 3000（既定）。

## 既知の問題・懸念点
- **転載モデルの法的・ポリシーリスク**: `docs/project-memory.md` に記載済みのとおり、逐語転載は著作権・各サービスの転載規約・AdSenseの複製コンテンツポリシーに触れうる。今回の改修はユーザーが明示的にリスク承知の上で決定した仕様（プロンプトに明記）に基づく。恒久運用に向けては別途、転載許諾確認・オプトアウト運用の徹底が必要（既存の運用課題として project-memory.md に記載済み、本改修では変更なし）。
- **スレッドダンプのテキスト規約は暫定**: `content` フィールド（既存スキーマ）に「`N: 本文`」というテキスト規約でレスを埋め込む方式。将来 live 収集アダプタを実装する際は、実際の5ch/Reddit APIレスポンスをこの規約に変換するアダプタ側の実装が必要（現時点はfixtureモックのみ、`parseThreadReses` はこの規約に一致しない入力を1レスにフォールバックするため、規約外データでもクラッシュはしない）。
- **強調ヒューリスティックの精度**: 赤強調はキーワード一致ベースの簡易ヒューリスティックであり、文脈を理解した「面白さ」判定ではない（決定論・LLM非依存という制約上の設計）。過検出・過小検出はあり得るが、1レスあたり0〜1行に抑えているため表示上の破綻はない。
- 自己確認中、`npm run build` を先にseed/pipelineより前に実行してしまい、静的prerenderされたトップページが古いDBスナップショットを参照する事象に遭遇した（本改修のバグではなく自己確認手順の順序ミス）。DBをリセットしseed→pipeline→buildの順に取り直して解消・再確認済み。今回の作業で新規に `prisma/dev.db` を再作成したが、gitignore対象のため差分には含まれない。
- リポジトリ直下に `live-admin.png`/`live-article.png`/`live-top.png`（未追跡ファイル）が存在するが、本タスク開始前から存在していたもの（作成日時が作業開始前）で、本改修では生成・変更していない。

## 追加したテスト
- `src/lib/__tests__/generation-thread-format.test.ts`（新規）: `parseThreadReses`（複数レスパース・区切り無し・フォールバック・空文字）、`extractAnchors`（重複排除・出現順）、`computeLineEmphasis`（赤1行のみ・オレンジ・両方無し）。
- `src/lib/__tests__/article-body.test.ts`: reactionブロックのparse成功・number/name/lines/emphasis不正時のエラー、`blockText`（通常ブロック・reactionブロック）。
- `src/lib/__tests__/generation-compose.test.ts`: 5ch/reddit由来がreactionブロック形式（見出し「話題」→「寄せられたレス」→「まとめ」、逐語保持、アンカー、名前）になること、quoteブロックを使わないこと、riot由来は従来どおりであること、フォーマット不一致contentのフォールバックを更新・追加（旧「反応を要約して並べる」構成の期待値は新仕様に合わせて置き換え）。
- `src/lib/__tests__/generation-generate-article.test.ts`: 5ch由来がレス本文と元ソースが完全一致していてもGenerationErrorにならないことを追加（既存の逐語コピー拒否テストはriot由来のまま維持）。
- `src/lib/__tests__/moderation.test.ts`: reactionブロックのレス本文にNGワードが含まれる場合にheldになること、NGワード無しなら公開されることを追加。
- `src/components/__tests__/article-body-view.test.tsx`: reactionブロックの描画（番号/名前/緑クラス、赤/オレンジ強調、複数レスの順序）を追加。

## 前回フィードバックへの対応（再実装の場合のみ）
- 該当なし（新規改修タスクのため）。

## 関連ドキュメント
- [[lol-matome-sokuhou-spec]]（製品仕様書）
- [[lol-matome-sokuhou-architecture]]（技術ベースライン）
- [[project-memory]]（記事フォーマットの方針変更セクション）
