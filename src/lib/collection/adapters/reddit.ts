/**
 * Reddit（海外の反応）から取得する live アダプタ（拡張E46でArctic Shiftへ全面切替）。
 *
 * 経緯: 公式OAuth（Application-only）は認証情報未設定時に常に空・かつ投稿本文のみでコメント無し＝弱い。
 * 無認証の公式JSONは403、RSSはレート制限が厳しく無人運用に不向き（検証済み）。PullPushはデータが
 * 約14か月古く不採用。**Arctic Shift**（`arctic-shift.photon-reddit.com`・無認証・無料）は最新データが
 * あるが、スコアはAPI側でソート/絞込できず（`created_utc`順のみ）、作成直後はスコアが未反映で
 * 2日程度でバックフィルされる特性がある。そのため「2〜4日前の投稿」を取得しクライアント側でスコア降順に
 * 選抜し、各スレの上位コメントを取得して「OP＋上位コメント」のスレッドダンプに整形する
 * （翻訳は次スプリントE47。本スプリントは英語のまま実データ化する）。
 *
 * 信頼境界（外部API）: `fetchJsonSafe`（タイムアウト付き）。HTTPエラー・不正JSON・ネットワーク断は
 * いずれも例外を投げず握り潰して空配列を返す（1ソースの失敗が収集パイプライン全体を止めない方針。
 * riot/5ch live アダプタと同方針）。キー不要のため常に試行する。
 * Redditの返す本文（title/selftext/コメントbody）は信頼できないユーザー生成テキストとして扱い、
 * 整形済みのスレッドダンプ文字列を content に入れるのみでHTMLとして解釈させる経路には入れない
 * （安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保）。逐語は不変（選定・整形のみ）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import { fetchJsonSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";

const ARCTIC_SHIFT_BASE = "https://arctic-shift.photon-reddit.com/api";
/** 5chアダプタ同様、説明的な既定UA（env `REDDIT_USER_AGENT` で上書き可）。 */
const DEFAULT_USER_AGENT = "lol-matome-sokuhou-collector/1.0 (bot; +contact via operator CONTACT_EMAIL)";

/** 投稿選別の下限スコア（既定50。env `REDDIT_MIN_SCORE` で上書き可）。 */
const DEFAULT_MIN_SCORE = 50;
/** 収集対象にする投稿数の上限（既定5。env `REDDIT_MAX_THREADS` で上書き可）。 */
const DEFAULT_MAX_THREADS = 5;
/** 1投稿あたり取り込むコメント数の上限（既定20。env `REDDIT_MAX_COMMENTS` で上書き可）。 */
const DEFAULT_MAX_COMMENTS = 20;
/** 取得窓の下限（何日前までを対象にするか。既定2。env `REDDIT_MIN_AGE_DAYS` で上書き可）。 */
const DEFAULT_MIN_AGE_DAYS = 2;
/** 取得窓の上限（何日前から遡るか。既定4。env `REDDIT_MAX_AGE_DAYS` で上書き可）。 */
const DEFAULT_MAX_AGE_DAYS = 4;
/** 連続fetch間のディレイ(ms)（既定1000。env `REDDIT_REQUEST_DELAY_MS` で上書き可）。 */
const DEFAULT_REQUEST_DELAY_MS = 1000;
/** 投稿本文(selftext)抜粋の最大長（有界化）。 */
const SELFTEXT_EXCERPT_MAX_LENGTH = 500;

/** 非負整数のenv値をパースする（不正・未設定はfallback）。 */
function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type RedditPostData = {
  id: string;
  permalink?: string;
  title: string;
  selftext?: string;
  created_utc: number;
  score?: number;
  stickied?: boolean;
  over_18?: boolean;
  /** 投稿画像プレビュー（Redditが自動生成する画像バリエーション）。あれば最優先で使う。 */
  preview?: { images?: { source?: { url?: string } }[] };
  /** サムネイルURL、または"self"/"default"/"nsfw"/"spoiler"等の非画像プレースホルダー文字列。 */
  thumbnail?: string;
  /** コメント数（リファクタリングS2: PostMetricsHistory.commentCount に使う）。 */
  num_comments?: number;
  /** 投稿者ユーザー名（リファクタリングS2: Post.author に使う）。 */
  author?: string;
  /** flair（リファクタリングS2: Post.flair に使う）。 */
  link_flair_text?: string | null;
  /** リンク先URL（自己投稿の場合はpermalinkと同じ。リファクタリングS2: Post.mediaに使う）。 */
  url?: string;
};

export type RedditCommentData = {
  id: string;
  body?: string;
  score?: number;
  author?: string;
};

type ArcticShiftPostsResponse = { data?: RedditPostData[] };
type ArcticShiftCommentsResponse = { data?: RedditCommentData[] };

/** 投稿検索エンドポイントのURLを組み立てる（取得窓はISO日時文字列で渡す）。 */
export function buildPostsSearchUrl(subreddit: string, afterIso: string, beforeIso: string): string {
  const params = new URLSearchParams({
    subreddit,
    after: afterIso,
    before: beforeIso,
    limit: "100",
    sort: "desc",
  });
  return `${ARCTIC_SHIFT_BASE}/posts/search?${params.toString()}`;
}

/** コメント検索エンドポイントのURLを組み立てる。 */
export function buildCommentsSearchUrl(postId: string): string {
  const params = new URLSearchParams({ link_id: postId, limit: "100", sort: "desc" });
  return `${ARCTIC_SHIFT_BASE}/comments/search?${params.toString()}`;
}

/**
 * 投稿ID指定の現在値取得エンドポイントURLを組み立てる（リファクタリングS4 F-S4-1、確認済みエンドポイント）。
 */
export function buildPostsByIdsUrl(externalId: string): string {
  const params = new URLSearchParams({ ids: externalId });
  return `${ARCTIC_SHIFT_BASE}/posts/ids?${params.toString()}`;
}

/** 投稿permalinkから一意・安定な絶対URLを構築する（permalink無ければ `.../comments/<id>` にフォールバック）。 */
export function buildPostUrl(post: Pick<RedditPostData, "id" | "permalink">): string {
  if (post.permalink && post.permalink.trim().length > 0) {
    return `https://www.reddit.com${post.permalink}`;
  }
  return `https://www.reddit.com/comments/${post.id}`;
}

export type FetchWindow = { afterIso: string; beforeIso: string };

/**
 * 取得窓（after/before）を計算する純関数（拡張E46 F-E46-1）。
 * Arctic Shiftはスコアが作成直後は未反映で2日程度でバックフィルされる特性があるため、
 * 「`maxAgeDays`日前〜`minAgeDays`日前」の投稿だけを対象にする。`now` はテスト注入可能。
 */
export function computeFetchWindow(now: Date, minAgeDays: number, maxAgeDays: number): FetchWindow {
  const msPerDay = 24 * 60 * 60 * 1000;
  const after = new Date(now.getTime() - maxAgeDays * msPerDay);
  const before = new Date(now.getTime() - minAgeDays * msPerDay);
  return { afterIso: after.toISOString(), beforeIso: before.toISOString() };
}

/**
 * 投稿配列からタイトルがLoL関連キーワードに一致する投稿のみを残す（sticky/NSFW/スコア絞込は行わない）。
 */
export function matchKeywordPosts(posts: RedditPostData[], keywords: string[]): RedditPostData[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  return posts.filter((p) => {
    const lowerTitle = p.title.toLowerCase();
    return lowerKeywords.some((k) => lowerTitle.includes(k));
  });
}

/**
 * 投稿を選抜する純関数（拡張E46 F-E46-1）。`stickied`・`over_18` を除外し、タイトルがキーワードに
 * 一致し、`score >= minScore` の投稿のみを残す。score降順にソートし上位 `limit` 件を返す。
 */
export function selectRelevantPosts(
  posts: RedditPostData[],
  keywords: string[],
  minScore: number,
  limit: number,
): RedditPostData[] {
  const candidates = posts.filter((p) => !p.stickied && !p.over_18);
  const keywordMatched = matchKeywordPosts(candidates, keywords);
  const qualified = keywordMatched.filter((p) => (p.score ?? 0) >= minScore);
  const sorted = [...qualified].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return sorted.slice(0, Math.max(0, limit));
}

/** コメント本文が実質空（削除・除去・空白のみ）かどうか。 */
function isEmptyOrRemovedBody(body: string | undefined): boolean {
  if (!body) return true;
  const trimmed = body.trim();
  return trimmed.length === 0 || trimmed === "[deleted]" || trimmed === "[removed]";
}

/**
 * コメントを整形する純関数（拡張E46 F-E46-1）。`[deleted]`/`[removed]`/空本文/`AutoModerator` を除外し、
 * score降順で上位 `limit` 件を返す（逐語は不変・選定のみ）。
 */
export function selectTopComments(comments: RedditCommentData[], limit: number): RedditCommentData[] {
  const filtered = comments.filter(
    (c) => !isEmptyOrRemovedBody(c.body) && c.author?.toLowerCase() !== "automoderator",
  );
  const sorted = [...filtered].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return sorted.slice(0, Math.max(0, limit));
}

/** OP本文（title＋selftext冒頭抜粋）を組み立てる（有界化。改行はスペースに畳んで1レス化）。 */
function buildOpBodyLine(post: RedditPostData): string {
  const selftext = post.selftext?.trim();
  if (!selftext) return post.title;
  const excerpt =
    selftext.length > SELFTEXT_EXCERPT_MAX_LENGTH ? `${selftext.slice(0, SELFTEXT_EXCERPT_MAX_LENGTH)}…` : selftext;
  return `${post.title}\n${excerpt}`;
}

/**
 * OP＋上位コメントを `parseThreadReses` が解釈するスレッドダンプ（`"N: 本文\n\n…"`）に組み立てる純関数
 * （拡張E46 F-E46-1）。レス1=OP、レス2..=上位コメント本文（逐語・改行保持）。
 * redditは5chの`>>N`アンカーが無いためフラット一覧でよい。
 */
export function buildRedditThreadDump(post: RedditPostData, comments: RedditCommentData[]): string {
  const parts = [`1: ${buildOpBodyLine(post)}`];
  comments.forEach((c, idx) => {
    parts.push(`${idx + 2}: ${(c.body ?? "").trim()}`);
  });
  return parts.join("\n\n");
}

/** Redditが返す非画像のプレースホルダー thumbnail 値（"self"投稿・画像なし・NSFW/スポイラー隠し等）。 */
const NON_IMAGE_THUMBNAIL_VALUES = new Set(["self", "default", "nsfw", "spoiler", "image", ""]);

/**
 * 投稿の画像URLを抽出する（拡張E19 F-E19-3を踏襲）。`preview.images[0].source.url`（HTMLエンティティ
 * `&amp;` をデコード）を最優先し、無ければ `thumbnail` が `http(s)` の実画像URLのときそれを使う。
 * どちらも無ければ null（記事は既定サムネイル画像にフォールバックする）。
 */
export function extractRedditImageUrl(post: RedditPostData): string | null {
  const previewUrl = post.preview?.images?.[0]?.source?.url;
  if (previewUrl && previewUrl.trim().length > 0) {
    return previewUrl.replace(/&amp;/g, "&");
  }
  const thumbnail = post.thumbnail;
  if (thumbnail && /^https?:\/\//.test(thumbnail) && !NON_IMAGE_THUMBNAIL_VALUES.has(thumbnail.toLowerCase())) {
    return thumbnail;
  }
  return null;
}

/**
 * 投稿のメディア情報（画像URL・リンク先URL）をまとめる（リファクタリングS2 F-S2-1）。
 * どちらも無ければ undefined（Post.media は未設定のままにする）。
 */
export function buildRedditMedia(
  imageUrl: string | null,
  url: string | undefined,
): { imageUrl: string | null; url?: string } | undefined {
  if (!imageUrl && !url) return undefined;
  return { imageUrl, url };
}

/** 投稿＋選抜済みコメントから RawCollectionItem を組み立てる純関数。 */
export function buildRedditItem(post: RedditPostData, comments: RedditCommentData[]): RawCollectionItem {
  const imageUrl = extractRedditImageUrl(post);
  return {
    sourceUrl: buildPostUrl(post),
    title: post.title,
    content: buildRedditThreadDump(post, comments),
    fetchedAt: new Date(post.created_utc * 1000),
    imageUrl,
    // リファクタリングS2（F-S2-1）: Post永続化用メタ。
    externalId: post.id,
    score: post.score ?? 0,
    commentCount: post.num_comments ?? 0,
    author: post.author ?? null,
    flair: post.link_flair_text ?? null,
    media: buildRedditMedia(imageUrl, post.url),
  };
}

export type RedditAdapterOptions = {
  /** テスト・注入用。既定は env `REDDIT_USER_AGENT`。 */
  userAgent?: string;
  /** 取得対象サブレディット。既定は config の allowedSubreddits。 */
  subreddits?: string[];
  /** LoL関連判定キーワード。既定は config の reddit relevance keywords。 */
  keywords?: string[];
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
  minAgeDays?: number;
  maxAgeDays?: number;
  minScore?: number;
  maxThreads?: number;
  maxComments?: number;
  /** 連続fetch間のディレイ(ms)。既定は env `REDDIT_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reddit（Arctic Shift REST・キー不要）から「最近の人気スレOP＋上位コメント」を収集する live アダプタ
 * （拡張E46）。取得失敗（HTTPエラー・不正JSON・ネット断）はすべて例外を投げず空配列にする。
 * 投稿一覧→各スレのコメント取得の順に直列で行い、連続fetch間にディレイを挟む（同時多重接続を避ける。
 * 5chアダプタと同方針）。
 */
export class RedditAdapter implements SourceAdapter {
  readonly sourceType = "reddit" as const;
  private readonly userAgent: string;
  private readonly subreddits: string[];
  private readonly keywords: string[];
  private readonly now: () => Date;
  private readonly minAgeDays: number;
  private readonly maxAgeDays: number;
  private readonly minScore: number;
  private readonly maxThreads: number;
  private readonly maxComments: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** 実行全体で最初のfetchかどうか（最初のfetch前はディレイ不要のため）。 */
  private firstFetchDone = false;

  constructor(options: RedditAdapterOptions = {}) {
    const defaults = getDefaultSourceConfigs().reddit;
    this.userAgent = options.userAgent ?? process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.subreddits = options.subreddits ?? defaults.relevance.allowedSubreddits ?? [];
    this.keywords = options.keywords ?? defaults.relevance.keywords;
    this.now = options.now ?? (() => new Date());
    this.minAgeDays = options.minAgeDays ?? envIntLocal("REDDIT_MIN_AGE_DAYS", DEFAULT_MIN_AGE_DAYS);
    this.maxAgeDays = options.maxAgeDays ?? envIntLocal("REDDIT_MAX_AGE_DAYS", DEFAULT_MAX_AGE_DAYS);
    this.minScore = options.minScore ?? envIntLocal("REDDIT_MIN_SCORE", DEFAULT_MIN_SCORE);
    this.maxThreads = options.maxThreads ?? envIntLocal("REDDIT_MAX_THREADS", DEFAULT_MAX_THREADS);
    this.maxComments = options.maxComments ?? envIntLocal("REDDIT_MAX_COMMENTS", DEFAULT_MAX_COMMENTS);
    this.delayMs = options.delayMs ?? envIntLocal("REDDIT_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 取得(fetch)の直前に呼ぶ。実行全体で最初の1回だけディレイを省く（他はdelayMs待ってから進める）。 */
  private async waitBeforeFetch(): Promise<void> {
    if (this.firstFetchDone) {
      await this.sleep(this.delayMs);
    } else {
      this.firstFetchDone = true;
    }
  }

  private async fetchPosts(subreddit: string): Promise<RedditPostData[]> {
    const { afterIso, beforeIso } = computeFetchWindow(this.now(), this.minAgeDays, this.maxAgeDays);
    await this.waitBeforeFetch();
    const json = await fetchJsonSafe<ArcticShiftPostsResponse>(
      buildPostsSearchUrl(subreddit, afterIso, beforeIso),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `r/${subreddit} posts` },
    );
    return json?.data ?? [];
  }

  private async fetchComments(post: RedditPostData): Promise<RedditCommentData[]> {
    await this.waitBeforeFetch();
    const json = await fetchJsonSafe<ArcticShiftCommentsResponse>(
      buildCommentsSearchUrl(post.id),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `comments id=${post.id}` },
    );
    return json?.data ?? [];
  }

  private async fetchSubredditItems(subreddit: string): Promise<RawCollectionItem[]> {
    const posts = await this.fetchPosts(subreddit);
    const candidates = posts.filter((p) => !p.stickied && !p.over_18);
    const relevantCount = matchKeywordPosts(candidates, this.keywords).filter(
      (p) => (p.score ?? 0) >= this.minScore,
    ).length;
    const selected = selectRelevantPosts(posts, this.keywords, this.minScore, this.maxThreads);

    const items: RawCollectionItem[] = [];
    for (const post of selected) {
      const comments = await this.fetchComments(post);
      const topComments = selectTopComments(comments, this.maxComments);
      items.push(buildRedditItem(post, topComments));
    }
    console.log(
      `[reddit] sub=${subreddit} fetched=${posts.length} relevant=${relevantCount} selected=${selected.length} collected=${items.length}`,
    );
    return items;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (this.subreddits.length === 0) {
      console.log("[reddit] 対象サブレディットが無いため収集をスキップします");
      return [];
    }
    // 5chアダプタ同様、サブレディットは完全並列ではなく直列で取得する（同時多重接続を避ける）。
    const perSubredditResults: RawCollectionItem[][] = [];
    for (const subreddit of this.subreddits) {
      perSubredditResults.push(await this.fetchSubredditItems(subreddit));
    }
    return dedupeBySourceUrl(perSubredditResults.flat());
  }

  /**
   * リファクタリングS4（F-S4-1）: 指定した投稿の現在のスコア/コメント数を取得する
   * （`GET /api/posts/ids?ids=<externalId>` の確認済みエンドポイント）。取得失敗/空は null。
   */
  async fetchMetrics(externalId: string): Promise<{ score: number; commentCount: number } | null> {
    const json = await fetchJsonSafe<ArcticShiftPostsResponse>(
      buildPostsByIdsUrl(externalId),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `metrics id=${externalId}` },
    );
    const postData = json?.data?.[0];
    if (!postData) return null;
    return { score: postData.score ?? 0, commentCount: postData.num_comments ?? 0 };
  }
}
