---
tags: [sprint-selfeval]
sprint: E53
---

# 拡張E53 自己評価レポート

## 実装した内容
- F-E53-2: `src/lib/generation/champion-splash.ts`（http非依存）にチャンピオン日本語名→championId対応表 `JP_NAME_TO_CHAMPION_ID`（旧 `champion-thumbnail.ts` の `FALLBACK_JP_NAME_TO_ID` と同一内容）と純関数 `championNameToId(name)` を追加。`champion-thumbnail.ts` はこの表を re-export する形に変更し重複を排除（既存の `fetchChampionNameToIdMap`/`detectChampionSplashUrl` 等の挙動・exportパスは不変）。
- F-E53-1: `src/lib/generation/compose.ts`
  - `PATCH_ARTICLE_MODE` に `"detailed"` を追加し既定にした（`patchArticleMode()`）。`fact`/`summary` は従来どおり明示指定時のみ。
  - `composeDetailedPatchBody(candidate, changes)` を新設: ①バナー画像(imageUrl、credit付) ②見出し「パッチ<番号> の変更点」＋一般的事実の導入段落 ③`extractPatchChangesDeterministic`（拡張E40、既存の逐語抽出をそのまま再利用・改変なし）の結果をチャンピオンごとに[見出し→(id解決できれば)スプラッシュ画像→逐語の変更点段落]で列挙 ④出典linkButton、の順で組み立て。
  - `composeArticleBody`のriot分岐に`detailed`ケースを追加: 本文が`PATCH_NOTES_MIN_LENGTH`(300字)以上かつ`extractPatchChangesDeterministic`が変更点を取れた場合のみdetailed本文、それ以外(本文無し/抽出失敗)は`composePatchFactFlashBody`（事実速報）にフォールバック。
- README.mdの`PATCH_ARTICLE_MODE`環境変数説明を`detailed`既定に更新。

## 技術選定（該当する場合のみ）
- 新規ライブラリ・新規技術選定なし（既存のcompose.ts/champion-splash.ts/champion-thumbnail.tsの構成をそのまま踏襲・拡張）。AIは変更点生成に一切使わない（決定的抽出＋公式画像URL組み立てのみ、既存方針を維持）。

## 受け入れ基準チェック（自己申告）
- [x] 基準1: `npx vitest run` 全Green（新規6テスト＋championNameToId 4テストを含む1127件）。
- [x] 基準2: `npx tsc --noEmit`・`npm run build`・`npm run lint`（0 error, 既存の警告6件のみ・本スプリント無関係）すべて通過。
- [x] 基準3: 既定(`PATCH_ARTICLE_MODE`未設定)でパッチ記事は「バナー画像＋チャンピオンごとの画像＋変更前後(A ⇒ B)を詳しく＋公式リンク」の詳細記事になる（テストで確認）。変更点が取れない/本文が無いときは事実速報にフォールバックすることも確認。捏造なし（逐語部分文字列のみ）・新規依存なし・AI不使用。

## アプリの起動方法
- `npm run dev`（開発サーバー、http://localhost:3000）※本スプリントはロジック(`compose.ts`等)のみでUI変更はなし。画面確認する場合は既存のパッチ記事詳細ページ（`/articles/[slug]`）でdetailed本文のimage/heading/paragraph/linkButtonブロックが表示されることを想定（`ArticleBodyBlock`型は既存の`image`/`heading`/`paragraph`/`linkButton`のみ使用しており新規ブロック型は追加していないため、既存の描画コンポーネントがそのまま対応する）。
- テスト: `npx vitest run`
- 型チェック: `npx tsc --noEmit`
- ビルド: `npm run build`
- lint: `npm run lint`
- 自己確認でサーバーは起動していない（build/vitest/tsc/lintのみで検証、停止すべきプロセスなし）。

## 既知の問題・懸念点
- detailed本文は実パッチノート本文（ページ全体のテキストダンプ）から抽出した逐語の変更点を多く含むため、`generate-article.ts`の「逐語一致率(`computeVerbatimMatchRatio`) ≤ 0.5」チェックが本番の実データで通るかは未検証（本スプリントは`compose.ts`単体のcomposeArticleBody戻り値をfixtureで検証しており、`generate-article.ts`の実パッチノート全文に対する統合検証はスコープ外・オフライン環境のため未実施）。既存の`summary`モードのdeterministicフォールバック(`composeDeterministicPatchChangesBody`)と本質的に同じ構成（見出し＋逐語段落の比率）に、より原文性の高い導入文・チャンピオン画像alt/credit文を追加した分だけ非逐語成分は増えているため、悪化はしない見込みだが、実データでの本番挙動は次回パッチ公開時に運用側で確認を推奨。
- チャンピオン画像は最大12体分(`MAX_PATCH_CHAMPIONS`、既存の拡張E40の有界化を流用)まで表示されるため、変更対象チャンピオンが多いパッチでは画像数がやや多くなる可能性がある（表示崩れは既存のimageブロック描画に準拠するため想定内）。
- 一時的な基盤障害によるリトライは発生しなかった。

## 追加したテスト
- `src/lib/__tests__/champion-splash.test.ts`: `championNameToId`（主要チャンピオン名→id、championId自身での解決、未知名はnull、`buildChampionSplashUrl`との組み合わせ）
- `src/lib/__tests__/generation-compose-detailed-patch.test.ts`（新規ファイル。既存の巨大テストファイルへの影響を避けるため分離）:
  - PATCH_ARTICLE_MODE既定=detailedで、バナー画像→見出し→チャンピオンごと[見出し+スプラッシュ画像+逐語変更点]→linkButtonの順に組まれることの確認
  - imageUrl未指定時の省略確認
  - 変更点抽出不可・本文なし(mock相当)時に事実速報へフォールバックすることの確認
  - 未設定時と明示的に`detailed`を指定した場合で結果が一致することの確認（既定値の確定）
  - `championNameToId`が`null`を返すチャンピオン（`vi.doMock`で一部モック）は画像を省略しテキストのみになることの確認

## 関連ドキュメント
- [[ext-e53-brief]]（本スプリントの仕様抜粋）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
