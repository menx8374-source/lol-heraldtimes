# Reddit-source — Reddit反応記事の先頭にソース引用ブロック（スレタイトル＋by u/ユーザー in r/サブレディット＋リンク）

ユーザー要望: Redditの記事について、参考サイト（overwatch2-news…ow-20260728-113356）のように、**記事の先頭にソースの引用ブロック**を出す。**AI不使用**。対象: Web（表示）。

## 背景（参考ページの形）
参考記事は、タイトル直下・本文コメント群の前に、**引用ブロック**で:
- 元スレッドのタイトル（例「Is Kiriko going to be meta until the end of existence?」）
- `by u/{ユーザー名} in r/{サブレディット}`（例「by u/Jetnjet in Overwatch」）
- （元スレへのリンク）

を出している（サムネ・アイコンは無し・シンプルなテキスト引用）。当サイトの「海外の反応（reddit）」記事に、同様のソース提示ブロックを**記事本文の先頭**に付ける。

## 現状
- reddit反応記事は `compose.ts`（`composeArticleBody` の reddit 経路）で、導入文→反応コメント→締め→出典（末尾）という構成。**先頭にソース提示は無い**（元スレのタイトル/作者/サブレディットが冒頭に出ない）。
- 記事化候補（`GenerationCandidateInput`）は reddit の場合 `title`（元スレの原題）・`author`・`sourceUrl`（`https://www.reddit.com/r/{subreddit}/comments/{id}/...`）を持つ。サブレディットは `sourceUrl` から抽出できる。

## 含まれる機能

### F-RS-1: ソース引用ブロックの型（article-body.ts）
- `ArticleBodyBlock` に**後方互換**で新ブロックを追加（例）:
  ```ts
  type ArticleBodyRedditSourceBlock = {
    type: "redditSource";
    title: string;        // 元スレの原題（逐語）
    author?: string;      // 例 "Jetnjet"（u/ は表示時に付ける）
    subreddit?: string;   // 例 "leagueoflegends"（r/ は表示時に付ける）
    url: string;          // 元スレURL（検証済み・httpsのreddit）
  };
  ```
- `parseRedditSourceBlock` 検証（url は https の reddit.com のみ許可・逐語は改変しない）。既存ブロックは不変。

### F-RS-2: reddit記事の先頭に挿入（compose.ts）
- `composeArticleBody` の **reddit 経路でのみ**、本文ブロックの**先頭**に `redditSource` ブロックを1つ挿入する:
  - `title` = candidate.title（元スレ原題・逐語）。
  - `author` = candidate.author（あれば・`u/` は表示時付与）。
  - `subreddit` = candidate.sourceUrl から抽出（`/r/{subreddit}/` の部分・純ルール）。抽出できなければ省略。
  - `url` = candidate.sourceUrl（reddit スレURL）。
- **reddit（海外の反応）以外（5ch・riot・riot-news・x）には付けない**。既存の導入文・反応コメント・締め・末尾出典は維持（先頭にブロックが1つ増えるだけ）。

### F-RS-3: 表示（article-body-view.tsx）
- `redditSource` ブロックを、参考サイト風の**引用カード/blockquote**で描画:
  - 元スレタイトル（強調）。
  - `by u/{author} in r/{subreddit}`（author/subreddit があるときのみ・無ければ省略）。
  - 元スレへのリンク（`target="_blank" rel="noopener noreferrer nofollow"`・「Redditで見る」等）。
  - サムネ・アイコンは無し（参考どおりシンプル）。既存の引用/カード意匠に馴染む見た目。
- **dangerouslySetInnerHTML不使用**・逐語（タイトルはそのまま）。URLは reddit https のみ（検証済み）。

## 制約・非目標
- **AIは使わない**（挿入・抽出は純ルール）。**逐語維持・捏造禁止**（原題・作者・サブレディットはデータそのまま）。
- **reddit記事のみ**。5ch/riot/riot-news/x・他の記事・既存表示は不変（回帰なし）。
- 埋め込み（iframe/oEmbed）ではなく**テキストの引用ブロック**（参考ページもテキスト引用・サムネなし）。
- **DBスキーマ変更なし・新規npm依存なし**。search.ts/seo.ts等が ArticleBodyBlock を走査していれば新型を無視/テキスト抽出に対応（未処理で落ちない）。

## テスト（必須・実ネット非依存）
1. compose: reddit記事の本文**先頭**に `redditSource` ブロックが入り、title=原題・author・subreddit(sourceUrlから抽出)・url が正しい。5ch/riot/x では入らない。
2. subreddit抽出: `https://www.reddit.com/r/leagueoflegends/comments/xxx/...` → "leagueoflegends"。抽出不可なら省略。
3. 表示: `redditSource` が タイトル＋`by u/author in r/subreddit`＋リンクで描画される（author/subreddit無しでも崩れない）。dangerouslySetInnerHTML不使用。
4. parseRedditSourceBlock: reddit https URL のみ許可・逐語不変。
5. 既存の compose/article-body-view/search/seo テストが回帰しない。

## 受け入れ基準
1. `npx vitest run` 全Green・`tsc`・`build`・`lint` 通過。
2. reddit（海外の反応）記事の先頭に「元スレタイトル＋by u/ユーザー in r/サブレディット＋リンク」のソース引用ブロックが出る。他ソースには出ない。逐語維持・安全（reddit httpsのみ・InnerHTML不使用）。
3. AI不使用・DBスキーマ変更なし・新規依存なし・既存表示不変。

## 評価基準（evaluator向け）
- テスト全Green・build/tsc/lint通過・コンソールエラー0。
- reddit記事先頭にソース引用ブロックが正しく出る（原題・u/author・r/subreddit・リンク）。他ソース不変。
- 受け入れ基準1〜3を満たす。
