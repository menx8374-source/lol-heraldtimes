# 拡張E22 ブリーフ — Reddit/5ch反応記事へのクリップ埋め込み（実再生対応）

運用要望起点の機能追加。対象プラットフォーム: Web（Next.js 16 / React 19 / Vitest）。

## 背景（なぜ）
- 本サイトの主眼は「Reddit/5chで話題の中心になっているクリップを、その反応記事の中に埋め込む」こと。
- 現状: 埋め込み(embed)ブロックは (A) クリップ検索ソース(clip)専用でしか生成されず、Reddit/5chの反応記事には埋め込みが入らない。さらに表示は拡張E3以来「実iframeを読み込まないプレースホルダーカード」で、記事内で再生できない。
- (A) YouTube/Twitch検索ソースは不要（ユーザー決定）。`YOUTUBE_API_KEY`等を空にして自動スキップさせるだけで無効化されるため、**本スプリントでは (A)・clipソース・eスポーツカテゴリには手を触れない**（eスポーツは当面空のまま温存＝ユーザー決定）。
- 公式YouTube/Twitchプレーヤーでの埋め込みは各社が想定する正規の共有方法であり、逐語転載の文章より法的リスクは低い。

## 含まれる機能

### F-E22-1: 反応記事の本文からクリップURLを検出し埋め込みブロックを生成
- 対象: 反応系ソース（`reddit`＝海外の反応 / `5ch`＝5chの反応）の記事生成（`src/lib/generation/compose.ts` の反応系ボディ組み立て、または生成の共有ステップ）。
- 記事化候補の本文テキストから、埋め込み許可URL（YouTube / Twitchクリップ）を検出する。判定は既存の `embedProviderForUrl` + `isAllowedEmbedUrl`（`src/lib/embed.ts`）を必ず経由する（新たにホスト判定を書かない）。
- 検出したクリップURLを **embedブロック**として反応記事のbodyに追加する（本文の逐語転載テキストはそのまま保持し、埋め込みは加算）。
- 重複排除し、**1記事あたり最大3件**まで（過剰な埋め込みを防ぐ）。0件なら何も足さない（従来どおりの反応記事）。
- 検出対象provider: `youtube` と `clip`（Twitch）。`twitter`(X)は本スプリントの実iframe対象外のため、検出しても実再生はせず現状のプレースホルダーのまま（無理に対象化しない）。
- riot（パッチ検知）記事には適用不要。

### F-E22-2: 埋め込みを実際に再生可能なiframeにする（YouTube / Twitch）
- 対象: `src/components/article-body-view.tsx` の `EmbedBlockView`、および `src/lib/embed.ts`。
- `embed.ts` に「URLから動画/クリップIDを抽出し、埋め込み用srcを構築する純関数」を追加する。**IDは英数・ハイフン・アンダースコア等の厳格な形式検証**を行い、不正なら null（＝埋め込まない）。
  - YouTube: `youtube.com/watch?v=ID`・`youtu.be/ID`・`youtube.com/shorts/ID` → `https://www.youtube-nocookie.com/embed/{ID}`（プライバシー強化ドメイン）。
  - Twitch clip: `clips.twitch.tv/{SLUG}`・`twitch.tv/*/clip/{SLUG}` → `https://clips.twitch.tv/embed?clip={SLUG}&parent={HOST}`。
- `EmbedBlockView`: provider が `youtube`/`clip` のときは検証済みIDから作った src で **実iframe**を描画（`loading="lazy"`, `allowfullscreen`, `referrerpolicy="strict-origin-when-cross-origin"`, 最小限の `allow`）。src構築に失敗（ID抽出不可）した場合は従来のプレースホルダーカードにフォールバック。`twitter` は従来どおりカード表示。
- `dangerouslySetInnerHTML` は使わない。iframe の src は必ず検証済みID経由で組み立てる（生URLをそのまま src にしない）。
- Twitch の `parent` は閲覧ドメインに一致必須。`getSiteUrl()`（`src/lib/site.ts`）のホスト名を使う（ローカル/ステージングは `localhost`、本番は `lolheraldtimes.com`）。

### F-E22-3: `frame-src` CSP の許可（防御）
- 対象: `next.config.ts` の `headers()`。
- レスポンスに `Content-Security-Policy: frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv` を付与する（**frame-srcのみ**指定。default-src等は指定せず既存挙動を壊さない）。
- 目的: 逐語転載した投稿に不正なURLが紛れても、許可ドメイン以外はiframe化されないようにする多層防御。

## 受け入れ基準（検証可能な形で）
1. `npx vitest run` 全Green（新規テスト含む）。
2. 反応系候補の本文に `https://youtu.be/dQw4w9WgXcQ` 等のクリップURLが含まれるとき、生成記事の body に該当URLの embed ブロックが1件以上入る。クリップURLを含まない反応記事には embed が増えない。
3. `embed.ts` の新ID抽出関数が、正規URL（`youtu.be/ID`・`clips.twitch.tv/SLUG`等）から正しいsrcを返し、不正URL・許可外ホスト・ID形式違反では null を返す。
4. 記事詳細ページで、YouTube/Twitchクリップを含む記事に**実際に再生可能なiframe**が表示され、`frame-src` CSPヘッダに youtube-nocookie / twitch が含まれる。許可外ドメインのembedはiframe化されずカード表示にフォールバックする。
5. `npx tsc --noEmit`・`npm run build`・`npm run lint` が通る。
6. 既存の反応記事（逐語転載テキスト）・画像・clipソース記事・カテゴリ・サムネイル表示に回帰が無い。twitter埋め込みは従来どおりカード表示のまま。

## 評価基準（evaluator向け）
- テストスイートGreen（1件でも失敗ならFAIL）。
- アプリ起動し、クリップURLを含むモック反応記事の詳細でiframeが表示され再生UIが出る（実再生の可否はネットワーク依存のため、iframe要素の生成とsrcがyoutube-nocookie/twitchであることを確認できれば可）。コンソールエラー0。
- `frame-src` CSPヘッダが付与されている（`curl -I` 等で確認可）。
- 受け入れ基準1〜6を満たす。
- 検証用にクリップURLを含むモックデータが必要なら `npm run db:seed` 後、または一時的な候補データで確認してよい。
