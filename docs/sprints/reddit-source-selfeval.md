---
tags: [sprint-selfeval]
sprint: reddit-source
---

# Sprint Reddit-source 自己評価レポート

## 実装した内容
- `src/lib/article-body.ts`: 新ブロック型 `ArticleBodyRedditSourceBlock`（`type:"redditSource"; title; author?; subreddit?; url`）を後方互換で追加。
  - `isRedditSourceUrl(url)`（https の reddit.com/`*.reddit.com` のみ許可）を追加しexport。
  - `parseRedditSourceBlock` を追加し `parseArticleBody` のdispatchに接続（title/url必須・author/subreddit任意・逐語）。
  - `blockText` に `redditSource` の分岐を追加（title/author/subredditを改行連結、search.ts/seo.tsが新型で落ちないよう対応）。
- `src/lib/generation/compose.ts`: `composeReactionBody` の reddit経路でのみ、`buildRedditSourceBlocks`（`extractRedditSubreddit`で`/r/{subreddit}/`をURLから純ルール抽出）を呼び、本文先頭に `redditSource` ブロックを1件挿入。`candidate.sourceUrl` が無い/reddit https以外なら何も挿入しない（5ch/riot/riot-news/xは元々この関数を通らないため対象外）。
- `src/components/article-body-view.tsx`: `RedditSourceBlockView` を追加し、`redditSource` を blockquote（タイトル強調＋`by u/{author} in r/{subreddit}`(あるときのみ)＋「Redditで見る」リンク `target="_blank" rel="noopener noreferrer nofollow"`）で描画。サムネ/アイコン無し、`dangerouslySetInnerHTML`不使用（プレーンテキストのJSX）。

## 技術選定（該当する場合のみ）
- 新規依存追加なし。既存の `parseLinkButtonBlock`/`isSafeLinkButtonUrl` と同様の「https限定の純関数検証」パターンを踏襲し、redditドメイン限定版（`isRedditSourceUrl`）を実装。DBスキーマ変更なし（既存Article.bodyのJSON配列にブロックが1件増えるだけ）。

## 受け入れ基準チェック（自己申告）
- [x] `npx vitest run` 全Green（1649 tests passed）・`tsc --noEmit` エラー0・`npm run build` 成功・`npm run lint` エラー0（既存の無関係な警告6件のみ、今回の変更由来ではない）。
- [x] reddit記事の先頭に「元スレタイトル＋by u/ユーザー in r/サブレディット＋リンク」のソース引用ブロックが出る（compose/view両方でテスト済み）。他ソース（5ch/riot/riot-news/x）には出ないことをテストで確認。
- [x] AI不使用（純ルールのみ）・DBスキーマ変更なし・新規npm依存なし・既存表示不変（既存テスト1649件が全てGreenのまま）。

## アプリの起動方法
- `npm run dev`（Next.js dev、デフォルト http://localhost:3000）。今回の確認は `npx vitest run` / `npx tsc --noEmit` / `npm run build` / `npm run lint` の静的検証のみで行い、開発サーバーは起動していない（起動不要で検証完了）。

## 既知の問題・懸念点
- `candidate.sourceUrl` が無い、または reddit.com 以外のドメインの場合は redditSource ブロックを一切付けない仕様にした（brief に明記の無い分岐だが、「捏造禁止・安全側フォールバック」の既存方針に合わせた）。実運用では reddit adapter が常に `https://www.reddit.com/r/{subreddit}/comments/...` を `Post.url` として渡すため、通常運用では常にブロックが付く想定。
- subreddit抽出は `/\/r\/([A-Za-z0-9_]+)\//` の単純な正規表現。reddit の実URLは常にこの形式のためbriefのテストケース含め問題なし。

## 追加したテスト
- `src/lib/__tests__/article-body.test.ts`: `parseRedditSourceBlock`（title/author/subreddit/url正常系、author/subreddit省略、reddit以外ドメイン拒否、http拒否、title空拒否）、`blockText`のredditSource分岐（author/subredditあり・なし）。
- `src/lib/__tests__/generation-compose.test.ts`: reddit×sourceUrlありで本文先頭にredditSourceブロック挿入（title/author/subreddit/url検証）、sourceUrl無し時は付かない、5ch由来はreddit形式sourceUrlでも付かない、riot由来は付かない、reddit以外ドメインのsourceUrlは付かない（なりすまし防止）、subreddit抽出成功/失敗の2パターン。
- `src/components/__tests__/article-body-view.test.tsx`: redditSourceブロックの表示（title＋by u/author in r/subreddit＋リンク属性）、author/subreddit省略時に崩れないこと、`<img>`タグが含まれない（サムネ無し）ことを確認。

## 関連ドキュメント
- [[reddit-source-brief]]（本スプリントの仕様抜粋）
