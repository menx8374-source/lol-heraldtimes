---
tags: [sprint-selfeval]
sprint: patch-s5
---

# パッチ記事刷新S5 自己評価レポート

## 実装した内容
- `src/lib/collection/adapters/riot-datadragon.ts`
  - `isPatchPreviewModeEnabled()`: env `PATCH_PREVIEW_MODE==="on"` のみtrue（既定off）。
  - `nextDdragonVersion(version)`: DDragon versionのminorを+1・revisionを"1"に固定（例 "16.14.1"→"16.15.1"）。パース不能はそのまま返す（例外なし）。
  - `buildPatchItem(...)`に`isPreview`引数を追加（既定undefined=従来と完全同一）。trueのときタイトルに「【速報】」接頭辞＋`RawCollectionItem.patchPreview=true`を設定（F-S5-2）。
  - `RiotDataDragonAdapter.fetchItems()`: `isPatchPreviewModeEnabled()`がtrueのときだけ、次パッチ（`nextDdragonVersion`）の`fetchPatchNotesData`を追加で試行し、200(本文取得成功)ならpreviewアイテムを1件追加。404/失敗は`fetchPatchNotesData`が既にnullを返す設計のため例外を投げず現状（確定パッチ1件のみ）にフォールバック（F-S5-1）。既存の確定パッチ処理コードは1行も変更していない。
- `src/lib/collection/types.ts` / `collect-source.ts`: `RawCollectionItem.patchPreview` / `CollectionItem.patchPreview`を追加し、`toCollectionItems`でそのまま転記（S7cで踏んだ「転記漏れ」の教訓を踏まえ、既存のcategory/html転記と同じ形で追加）。
- `src/lib/collection/persist-posts.ts`: `item.patchPreview`を既存のJSON列`Post.media`に`patchPreview: true`キーとして追加保持（DBスキーマ変更なし。html保持と同じパターンに一般化）。本番反映後、confirmedアイテム（patchPreview無し）で再persistされるとmedia列自体が新しい値で上書きされ、フラグが自然に外れる（F-S5-3の前提）。
- `src/lib/generation/post-pipeline.ts`: `extractPostImageUrl`/`extractPostHtml`をexport化、新規`extractPostPatchPreview(media)`を追加。`generateArticlesFromHotPosts`の候補組み立てで`isPatchPreview: extractPostPatchPreview(post.media)`をcandidateに設定。
- `src/lib/generation/generate-article.ts`: `GenerationCandidate.isPatchPreview?: boolean`を追加（未設定/false=従来と完全同一）。
- `src/lib/article-body.ts`: `PATCH_PREVIEW_BADGE_TEXT`（速報バッジ文言、公式ノート逐語＋注意書きのみ・捏造なし）と`isPatchPreviewArticleBody(blocks)`（本文先頭ブロックの内容だけでpreview/live判定、DBスキーマ変更なし）を追加。`shouldShowHeroThumbnail`をバッジ考慮に更新（バッジ＋バナー画像のpreview記事でもヒーロー画像との二重表示を防止）。
- `src/lib/generation/compose.ts`: riot分岐の既存ロジックを`composeRiotArticleBody`に分離し、`composeArticleBody`側で`candidate.isPatchPreview`がtrueのときだけ本文先頭に速報バッジ段落を追加（`prependPatchPreviewBadge`）。`isPatchPreviewArticleBody`は`article-body.ts`から再エクスポート（既存呼び出し元の互換のため）。
- `src/lib/generation/patch-preview-confirm.ts`（新規）: `confirmPatchPreviewArticles()`。`PATCH_PREVIEW_MODE`無効なら即座にno-op（DBアクセスなし）。有効時、sourceType="riot"かつArticleが紐付くPostのうち「Post.media.patchPreviewフラグが外れている（本番反映済み）」かつ「現在のArticle本文が速報バッジ付き」のものだけを対象に、`generateArticleForCandidate`で確定版本文を再生成し、`Article.update`（in-place・slug/id/postId/publishedAt不変）＋`ArticleUpdateHistory.create`（reason="patch_preview_confirmed"）で更新する（既存の`article-updater.ts`と同じ発想の記事更新機構を流用、重複記事を作らない）。1件の失敗は握り潰して継続、全体としても例外を投げない。
- `scripts/confirm-patch-preview.ts`（新規）＋`package.json`に`confirm-patch-preview`スクリプト追加: `npm run update-articles`と同じ運用パターン（cron等から個別に定期実行する想定、1回実行のみ）。
- `.env.example` / `README.md`: `PATCH_PREVIEW_MODE`（既定off）のキー名・説明、`npm run confirm-patch-preview`の説明を追記。

## 技術選定
- 新規npm依存なし（既存の正規表現ベース収集・fetchベースの検知ロジックのみ）。DBスキーマ変更なし（`prisma/schema.prisma`は無変更、既存のPost.media JSON列とArticle本文JSON列の中身だけで状態を表現）。
- 確定機構は既存の`article-updater.ts`（updateHotArticles）を直接改修せず、別モジュール`patch-preview-confirm.ts`として新規追加。理由: `updateHotArticles`はriotを`exemptSourceTypes`として意図的に対象外にしている（"話題性の伸び"という別概念のトリガのため）ため、既存関数を無理に拡張するより発想を流用した専用関数にする方が既存のS6機能への影響がゼロで安全。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（111ファイル/1487テスト、S5で26件追加）・`npx tsc --noEmit`エラー0・`npm run build`成功・`npm run lint`エラー0（既存の無関係な警告6件のみ、新規errorなし）。
- [x] `PATCH_PREVIEW_MODE=on`で未適用パッチが速報バッジ付きで先行記事化され（`generation-post-pipeline-patch-preview.test.ts`）、本番反映後に同一記事が確定版へ自動更新される（重複なし、`generation-patch-preview-confirm.test.ts`で`Article`のid/slug/postId/publishedAt不変・`prisma.article.findMany({where:{postId}})`が1件のみであることを確認）。`off`/未設定では次パッチへのfetchが一切発生せず確定パッチ1件のみ（`collection-riot-datadragon.test.ts`の新規テストで`fetchMock`が次パッチURLを一切呼ばないことを確認、回帰ゼロ）。
- [x] AI不使用（検知・記事化・確定更新はいずれも既存の決定的経路とルールのみ、LLM呼び出しはタイトル生成に使わず候補titleをそのまま採用）。逐語維持・捏造なし（速報バッジは公式ノート本文の逐語＋固定の注意書きのみ、数値・変更内容の創作は一切していない）。DBスキーマ変更なし（`prisma/schema.prisma`は無変更）。新規依存なし。秘密なし（`PATCH_PREVIEW_MODE`はキー名のみ`.env.example`に明記）。

## アプリの起動方法
- `npm run dev`（http://localhost:3000）。
- 単体検証: `npx vitest run`／`npx tsc --noEmit`／`npm run build`／`npm run lint`（いずれも本レポート作成前に実行し上記の結果を確認済み）。
- 確定更新の単独実行: `npm run confirm-patch-preview`（`PATCH_PREVIEW_MODE=on`のときのみ動作、offでは即no-op。本レポート作成前に実際に1回実行し、no-op出力（`checked=0 confirmed=0 skipped=0`）を確認済み。dev.dbへの書き込みは発生していない）。
- 本スプリントではサーバー起動は行っていない（DBアクセスを伴う自己確認は`npx vitest run`の結合テスト＋上記スクリプトの単発実行のみで完結）。

## 既知の問題・懸念点
- `persist-posts.ts`のpatchPreviewフラグ解除は「再persist時にmedia列が明示的な新しい値で上書きされること」に依存する。Prismaは`update`データの値が`undefined`のフィールドを更新から除外する仕様のため、もし確定パッチの再persist時に`html`も`imageUrl`も両方取得できない極端なケースでは、旧`patchPreview:true`が万一残る可能性が理論上はある。ただし実運用では`buildPatchItem`の設計上「本文が閾値以上(hasPatchNotes=true)」の場合は必ず`html`も同時に設定される（同一fetchの結果のため）ため、実際にこのケースが発生することはない（`collection-persist-posts.test.ts`のテストで実運用相当のケース=html付きの状態遷移を確認済み）。
- `confirmPatchPreviewArticles`は`npm run confirm-patch-preview`という別スクリプトとして実装し、`runFullPipeline`（`npm run pipeline`）には組み込んでいない（`update-articles`と同じ既存の運用パターンに合わせた設計判断）。本番運用では`update-articles`同様、別途cron等での定期実行が必要（本スプリントのスコープ外の運用設定）。
- 未適用パッチのpreview記事は`composeDetailedPatchBody`等が生成する冒頭サマリ段落ではなく速報バッジ段落が「本文中最初のparagraphブロック」になるため、S4のLoL意匠（`article-body-view.tsx`）の紺地金文字サマリカードは速報バッジに適用される（実際の要約文ではなく速報バッジが目立つカードになる）。捏造・機能的な問題ではなく、むしろ速報である旨が強調される副次効果として許容できると判断し、追加のUI変更は行っていない。

## 追加したテスト
- `src/lib/__tests__/collection-riot-datadragon.test.ts`（既存ファイルに追加、13件）: `isPatchPreviewModeEnabled`/`nextDdragonVersion`の純関数、`buildPatchItem`の`isPreview`引数（回帰ゼロ・接頭辞・patchPreviewフラグ）、`RiotDataDragonAdapter.fetchItems`のoff/on×200/404の4パターン（オフ時は次パッチへのfetchが一切発生しないことをfetchMockで確認）。
- `src/lib/__tests__/generation-compose-patch-preview.test.ts`（新規、3件）: `composeArticleBody`の`isPatchPreview`有無による差分（バッジ追加・本体は捏造なく同一・`isPatchPreviewArticleBody`の判定）。
- `src/lib/__tests__/generation-post-pipeline-patch-preview.test.ts`（新規、3件）: `extractPostPatchPreview`純関数、`generateArticlesFromHotPosts`経由でPost.media.patchPreviewフラグが記事本文の速報バッジ付与まで伝わること（DB結合）。
- `src/lib/__tests__/generation-patch-preview-confirm.test.ts`（新規、5件）: `confirmPatchPreviewArticles`のoff時no-op（DB非アクセス）・本番反映後の確定更新（in-place・重複なし・ArticleUpdateHistory追記）・Post側まだpreviewのまま(スキップ)・既に確定済み(スキップ)・riot以外は対象外（DB結合）。
- `src/lib/__tests__/collection-persist-posts.test.ts`（既存ファイルに追加、3件）: `item.patchPreview`のPost.media保存（html保持と同じパターン）・未指定時の回帰なし・本番反映後の状態遷移（html付きの現実的なケースでフラグが外れることを確認）。
- `src/lib/__tests__/article-page-hero.test.tsx`（既存ファイルに追加、1件）: 速報バッジ＋バナー画像のpreview記事本文でも`shouldShowHeroThumbnail`がヒーロー画像の二重表示を防ぐこと。
- 既存の riot-datadragon/compose/post-pipeline/article-updater/article-body 等のテストは全て回帰なく成功（`vitest run` 111ファイル/1487テスト全Green）。

## 関連ドキュメント
- [[patch-s5-brief]]（本スプリントの仕様抜粋）
- [[patch-accuracy-research]]（設計根拠 §2.5）
- [[lol-matome-sokuhou-spec]]（製品仕様書）
