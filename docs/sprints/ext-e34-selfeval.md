---
tags: [sprint-selfeval]
sprint: ext-e34
---

# 拡張E34 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/riot-datadragon.ts`
  - `PATCH_NOTES_MIN_LENGTH`(300)・`PATCH_NOTES_MAX_LENGTH`(15000)を追加（両閾値をcompose.ts側の判定と共有）。
  - `stripHtmlToText`（script/style除去→タグ除去→主要HTMLエンティティ復号、正規表現ベース・新規npm依存なし）を追加。
  - `fetchPatchNotesText(version)`: `fetchTextSafe`（タイムアウト付き）で公式パッチノートページを取得しテキスト化。取得失敗/本文がPATCH_NOTES_MIN_LENGTH未満はnull（例外を投げない）。PATCH_NOTES_MAX_LENGTHで切り詰め。
  - `buildPatchItem(version, now, patchNotesText?)`: 第3引数追加（省略可・後方互換）。有効な本文が渡されればcontentに本文そのもの・titleを「【パッチ】X.Y の主な変更点まとめ」に。無ければ従来どおりの汎用事実速報（フォールバック）。
  - `fetchItems`: 最新バージョン取得後に`fetchPatchNotesText`を呼び、結果を`buildPatchItem`に渡すよう変更。
- `src/lib/generation/compose.ts`
  - `PATCH_NOTES_MIN_LENGTH`をriot-datadragon.tsからimportし、riot由来のcontentがこの閾値以上（＝実パッチノート本文とみなせる）のときのみLLM要約(`composePatchSummaryBody`)を試みるよう分岐追加。
  - `composePatchSummaryBody`: 捏造禁止・出力形式(JSON: buffed/nerfed/other)を明記したsystemプロンプトでLLMに要約させ、`extractJsonObject`（既存のコードフェンス対応ヘルパを再利用）→検証・正規化→「主な強化チャンピオン」「主な弱体チャンピオン」「アイテム・その他の変更」見出し＋段落ブロックを組み立てる。
  - LLM応答が空/非文字列/JSON解析失敗/全カテゴリ空/例外はすべて`null`を返し、呼び出し側が既存の`composeFactBody`（速報＋要点整理）にフォールバックする（例外を投げない）。
  - 出典URLは既存どおり`generate-article.ts`の`sources`配列（`candidate.sourceUrl`）で付与（compose.ts側の変更不要、回帰なし）。

## 技術選定
- 新規npm依存なし（正規表現ベースのHTML→テキスト抽出。ブリーフの指示どおり）。
- LLM呼び出しはE24で導入済みのHaiku接続をそのまま再利用（新規のGenerationTask種別は追加せず、compose.ts内で直接system/userメッセージを組み立てる方式。MockLLMClientは未知のタスク形状に対して有効な要約を作れず自然にフォールバックする設計とし、「mock時は必ず従来記事」という要件を追加の分岐無しで満たした）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全778件Green（新規22件含む。実API/実ネット非依存、fetch/LLMは全てモック・スタブ）。
- [x] 基準2: `npx tsc --noEmit`・`npm run build`・`npm run lint`（0 errors、既存警告4件のみ・私の変更由来ではない）全て通過。
- [x] 基準3: テストで確認（`generation-compose.test.ts`・`generation-generate-article.test.ts`）。パッチノート本文取得成功＋要約可能なLLM（スタブ）のとき「主な強化/弱体チャンピオン」「アイテム・その他の変更」見出しのまとめ記事が生成される。取得不可・LLM不可（mock/不正JSON/空応答/例外/全カテゴリ空）はすべて従来の「速報/要点整理/まとめ」記事にフォールバックし例外を投げない。
- [x] 基準4: 捏造禁止をsystemプロンプトに明記（「本文に記載の無い数値・調整・チャンピオン名を作ってはいけません」）。要約段落はLLM応答の要約文字列をそのまま使い、compose.ts側で新たな数値・事実を組み立てることはしていない。新規npm依存なし。LLM呼び出しは新パッチ検知時（fetchItems1回）につき要約1回のみ（低コスト）。

## アプリの起動方法
- 開発サーバー: `npm run dev`（http://localhost:3000）。今回のスプリントはロジック層（収集アダプタ・記事生成合成）のみの変更で、UI/画面確認は不要と判断し、自己確認は上記のテスト/ビルド/型チェック/lintのみで行った（サーバーは起動していない＝停止操作も不要）。
- テスト: `npx vitest run`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- Lint: `npm run lint`

## 既知の問題・懸念点
- **JSレンダリングリスク（ブリーフに明記の既知リスク）**: 公式パッチノートページ（leagueoflegends.com）がクライアントサイドレンダリングで本文をHTMLに含まない場合、`fetchPatchNotesText`は本文が`PATCH_NOTES_MIN_LENGTH`未満と判定してnullを返し、従来の汎用パッチ記事にフォールバックする（クラッシュはしない）。実際のページのレンダリング方式は本スプリントでは実ネットワーク検証していない（テスト方針上、実ネットを叩かない制約のため）ため、live環境で「まとめ記事」が実際に出るかは本番投入後の観察が必要（本スプリントの受け入れ基準は「取れたら要約、取れなければフォールバック」までであり、この点はブリーフの非目標・既知リスクとして明記済み）。
- LLM要約は「本文が長い/多岐に渡る」パッチで文字数超過・要約粒度のばらつきが起こりうるが、300字下限・逐語一致率・引用比率チェック（generate-article.ts既存ロジック）はそのまま適用されるため、著しく短い/コピペに近い要約は生成失敗として記録され記事は公開されない（他候補の生成は継続、既存の安全策どおり）。
- 実際のAnthropic API（本接続）は今回叩いていない（課金回避のため、テストはスタブ/モックのみ）。ANTHROPIC_API_KEY未設定・GENERATION_MODE=mock（既定）ではこれまでどおりMockLLMClientが使われ、パッチ要約は必ずフォールバックする（想定どおりの挙動）。

## 追加したテスト
- `src/lib/__tests__/collection-riot-datadragon.test.ts`: `fetchPatchNotesText`のタグ除去・エンティティ復号・上限切り詰め・HTTPエラー/ネットワーク断/本文短すぎ→null（4件）。`buildPatchItem`の第3引数対応（本文あり/短すぎ/null・未指定の回帰、3件）。`fetchItems`のパッチノート本文取得成功/失敗時のcontent切り替え（2件、実ネット非依存でfetchをモック）。
- `src/lib/__tests__/generation-compose.test.ts`: riotのcontentが実パッチノート本文のときのスタブLLM要約→まとめ体裁本文（見出し＋段落、300字以上・逐語一致率0.5以下を確認）。mock LLM・不正JSON・空応答・全カテゴリ空・API例外（部分的に例外を投げるスタブ）→すべて従来の速報＋要点整理へフォールバック。汎用content（閾値未満）はLLMが有効な要約を返しても要約を試みない（回帰なし）。コードフェンス付きJSON対応。カテゴリの一部のみ返した場合の見出し省略。（計11件）
- `src/lib/__tests__/generation-generate-article.test.ts`: `generateArticleForCandidate`経由のE2E確認（実パッチノート本文＋要約可能なスタブ→まとめ記事＋出典URL付与／mock LLMでは従来の速報記事にフォールバック、いずれもGenerationErrorにならない）。（計2件）

## 関連ドキュメント
- [[ext-e34-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-spec]]（製品仕様書、該当する場合）
