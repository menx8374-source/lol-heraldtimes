---
tags: [sprint-evaluation]
sprint: X-reply-S3
result: PASS
---

# Sprint X-reply-S3 評価レポート

## 総合判定: PASS

## 検証モード: Playwright（Web実機・Chromium）
- Playwright MCPツールが当セッションのツール一覧に露出していなかったため、共有キャッシュ済みChromiumを`playwright`（スクラッチ領域に`--no-save`でインストール。プロジェクトの`package.json`/`node_modules`は不変）から直接駆動して実機検証した。実ブラウザでのDOM/コンソール/スクリーンショット確認であり、Bash縮退ではない。
- 検証用データはdev DBに一時seed（`sourceType="x"`のPost 2件＋`media.xReplies`3件）→`generateArticlesFromHotPosts`（GENERATION_MODE=mock）で記事生成→検証後にPost/Articleを削除済み。dev.dbはseed前の状態に復帰。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 3デザイン×記事表示・回帰記事・トップ/他ソース記事すべて200・描画崩れ無し（横スクロール発生なし `scrollWidth<=clientWidth`） |
| コンソールエラー0件 | PASS | 新構成のX記事（標準/ニュース/Hextech dark/Hextech light の4パターン）で `console.error`・`pageerror` ともに0件。CSPは `frame-src ... https://platform.twitter.com` を含み違反なし |
| 受け入れ基準充足率100% | PASS | 受け入れ基準1〜3をすべて確認（下記） |
| テストGreen（全テスト成功） | PASS | `npx vitest run` → **122ファイル / 1705テスト 全passed**（33.16s） |

### 受け入れ基準
1. **ビルド系**: `npx vitest run` 1705件全Green ／ `npx tsc --noEmit` エラー0 ／ `npm run build` 成功（Next.js 16.2.11・全ルート生成） ／ `npm run lint` **0 errors**（warning 6件はすべて本変更と無関係の既存ファイル: site-header.tsx の`<img>`・既存テストの未使用引数）。→ PASS
2. **表示**: xReplies 3件（日本語リプ2＋`isQuote:true`の引用1）を入れて生成した記事の本文JSONが
   `heading("Xでの反応") → paragraph(導入) → embed(twitter) → heading("反応まとめ") → reaction×3 → paragraph(結び)` の順で構成された。
   実機DOMでも `iframe[src="https://platform.twitter.com/embed/Tweet.html?id=20"]`（Y=777）→「反応まとめ」見出し（Y=1098）→ `[data-reaction-group]` 1枠（Y=1138）の順で、レスは
   `1: @lol_jp_fan ・ 👍12,345 💬678 [返信]` / `2: @sup_main_jp ・ 👍890 💬45 [返信]` / `3: @na_analyst ・ 👍4,567 💬89 [引用]` と本文が可読表示。3デザインすべて同一構成・崩れなし（Hextechは`theme=light`でも背景`rgb(10,20,40)`＋明色テキストで可読）。
   **回帰**: xReplies無しのX記事は `heading→paragraph→embed→paragraph` のまま、`反応まとめ`見出し0件・reaction枠0件。既存の5ch/reddit(海外の反応)/トップも従来どおり描画。→ PASS
3. **逐語・安全性**: `formatCount`はカンマ整形のみ（👍/💬の数値はfixture値と完全一致＝捏造なし）。埋め込みは`embedIframeSrc`→`extractTweetStatusId`（数値ID正規表現・許可ホスト検証）経由のみで生URLをsrcにしない。`dangerouslySetInnerHTML`は`article-body-view.tsx`に不在（テストでも検査）。`prisma/schema.prisma`・`package.json`ともに差分なし（`git status`で未変更を確認）。→ PASS

### コード確認（指示項目）
- (a) `buildXReactionBlocks`: `@handle ・ 👍N 💬N [引用|返信]`、日本語(`lang==="ja"`/`containsJapaneseText`)は翻訳スキップ・英語は`translateReactionLines`・失敗時原文フォールバック、`buildReactionDisplayLines`経由で`removeNgSentences`適用＆空レス除外、`anchors`未付与、除外後に1始まりで連番振り直し — すべて実装・テストで確認。
- (b) `composeXBody`: `xReplies.length>0 && sourceUrl` のときのみ新構成、それ以外は既存の`isValidTweetStatusUrl`分岐をそのまま通る（旧パス無改変＝回帰ゼロ）。
- (c) `dangerouslySetInnerHTML`不使用・embedは既存`embedIframeSrc`（検証済み数値ID）経由。
- (d) スキーマ・依存関係の変更なし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 日本語リプライ本文に改行が含まれる場合、`buildXReactionBlocks`は`[reply.text]`を1行として渡すため改行が失われ1行に連結される（翻訳経路は`\n`で分割している）。文字自体は逐語のままで表示も崩れないが、原文の改行を活かすなら`reply.text.split(/\r?\n/)`を渡す余地がある。
- `xReplies≥1`の分岐では`sourceUrl`の形式検証（`isValidTweetStatusUrl`）を経ずにembedブロックを積むため、万一x.com以外のURLが来た場合は`EmbedBlockView`が`null`を返し埋め込み枠自体が消える（従来分岐にあった引用＋出典テキストのフォールバックは効かない）。実運用ではxアダプタが常にx.com/twitter.comのURLを入れるうえ、記事末尾の「出典」セクションで出典は担保されるため実害は確認されず。
- 既存のseed由来X記事（`post-gen-cms4nuo7...`）では、fixtureのツイートIDが実在しないためTwitter側CDNが`404 cdn.syndication.twimg.com/tweet-result?id=...`を返し、ブラウザコンソールに`Failed to load resource: 404`が出る。**本スプリント以前からのseedデータ由来**（実在IDを使った検証記事ではエラー0）でコード不備ではないが、seedのツイートIDを実在のものにすると開発時のノイズが減る。

## 未検証項目（実機確認が必要）
- GetXAPI実データ（`X_API_KEY`設定・live）での`xReplies`取得〜表示の通し確認（本スプリントはfixture/モックLLMのみ。実HTTPは仕様上叩かない）。
- 英語リプライのLLM実翻訳（モックLLM／スタブでの分岐確認まで。live翻訳の品質は未検証）。

## プレビュー画像
- `docs/sprints/x-reply-s3-preview-classic-light.png`（標準デザイン）
- `docs/sprints/x-reply-s3-preview-news-light.png`（ニュース記事風）
- `docs/sprints/x-reply-s3-preview-hextech-light.png`（Hextech・theme=lightでも可読）

## 関連ドキュメント
- [[x-reply-s3-selfeval]]（ジェネレーターの自己評価レポート）
- [[x-reply-s3-brief]]（本スプリントの仕様抜粋）
