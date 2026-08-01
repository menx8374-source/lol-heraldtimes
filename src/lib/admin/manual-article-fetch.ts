/**
 * 運営CMS v2（admincms-S2 F5/F6）: 指定URLからの手動記事化における単発の外部取得。
 * 既存の収集アダプタ（reddit.ts=Arctic Shift／x.ts=GetXAPI）が持つ純関数・共通取得関数を
 * そのまま再利用し、ここでは「HTTPステータス別に区別した日本語エラーメッセージ」を作る薄い層に限定する。
 *
 * `fetchJsonSafe`（アダプタ共通ヘルパ）はステータスコードを握りつぶして null にするため、
 * 404（削除済み）／401・403（認証エラー）／429（レート制限）を区別したメッセージを返せない。
 * そのため、この用途専用に状態を保持したまま返す fetch ラッパーをここに用意する。
 *
 * 取得は指定1件＋その会話（Xは返信/引用、Redditはコメント）に限定し、無制限クロールはしない
 * （既存アダプタと同じ信頼境界の方針: 外部エラーは例外を投げず失敗結果として返す）。
 */
import {
  buildPostsByIdsUrl,
  buildCommentsSearchUrl,
  buildRedditThreadDump,
  buildPostUrl,
  selectTopComments,
  extractRedditImageUrl,
  type RedditPostData,
  type RedditCommentData,
} from "@/lib/collection/adapters/reddit";
import { fetchTopReplies, buildTweetTitle, type GetXApiTweet, type XReplyItem } from "@/lib/collection/adapters/x";

const FETCH_TIMEOUT_MS = 10_000;
/** 1投稿あたり取り込むコメント数の上限（reddit.tsのREDDIT_MAX_COMMENTS既定値を踏襲）。 */
const REDDIT_MAX_COMMENTS = 20;
const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT ?? "lol-matome-sokuhou-collector/1.0 (bot; +contact via operator CONTACT_EMAIL)";
const GETXAPI_BASE = "https://api.getxapi.com";

export type ManualFetchResult<T> = { ok: true; data: T } | { ok: false; message: string };

type StatusFetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "auth" }
  | { kind: "rate_limit" }
  | { kind: "http"; status: number }
  | { kind: "network" };

/** タイムアウト付きでJSONを取得し、HTTPステータスの種別を区別して返す（例外は投げない）。 */
async function fetchJsonWithStatus<T>(url: string, init: RequestInit): Promise<StatusFetchResult<T>> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 401 || res.status === 403) return { kind: "auth" };
    if (res.status === 429) return { kind: "rate_limit" };
    if (!res.ok) return { kind: "http", status: res.status };
    const data = (await res.json()) as T;
    return { kind: "ok", data };
  } catch {
    return { kind: "network" };
  }
}

function describeFailure(kind: Exclude<StatusFetchResult<unknown>["kind"], "ok">, sourceLabel: string): string {
  switch (kind) {
    case "not_found":
      return `指定の${sourceLabel}が見つかりません（削除済みの可能性があります）`;
    case "auth":
      return `${sourceLabel}の取得で認証エラーが発生しました（APIキーを確認してください）`;
    case "rate_limit":
      return "レート制限により取得できませんでした。しばらく待って再試行してください";
    case "http":
      return `${sourceLabel}の取得に失敗しました（サーバーエラー）`;
    case "network":
      return `${sourceLabel}の取得中に通信エラーが発生しました`;
  }
}

export type ManualRedditContent = {
  title: string;
  content: string;
  imageUrl: string | null;
  score: number;
  commentCount: number;
  author: string | null;
  flair: string | null;
};

/**
 * 指定したReddit投稿1件（OP＋上位コメント）を取得する（Arctic Shift、リファクタリングS4/S6の
 * `buildPostsByIdsUrl`/`buildCommentsSearchUrl`等の既存純関数をそのまま再利用）。
 * コメント取得自体が失敗した場合は補助データの欠落として扱い、OP単体（コメント0件）で続行する
 * （投稿本体が取得できた時点で「記事化できる」とみなす。本体を止めない方針）。
 */
export async function fetchRedditThreadById(externalId: string): Promise<ManualFetchResult<ManualRedditContent>> {
  type ArcticShiftPostsResponse = { data?: RedditPostData[] };
  type ArcticShiftCommentsResponse = { data?: RedditCommentData[] };

  const postResult = await fetchJsonWithStatus<ArcticShiftPostsResponse>(buildPostsByIdsUrl(externalId), {
    headers: { "User-Agent": REDDIT_USER_AGENT },
  });
  if (postResult.kind !== "ok") return { ok: false, message: describeFailure(postResult.kind, "Redditスレッド") };

  const post = postResult.data.data?.[0];
  if (!post) return { ok: false, message: "指定のRedditスレッドが見つかりません（削除済みの可能性があります）" };

  const commentsResult = await fetchJsonWithStatus<ArcticShiftCommentsResponse>(buildCommentsSearchUrl(post.id), {
    headers: { "User-Agent": REDDIT_USER_AGENT },
  });
  const comments = commentsResult.kind === "ok" ? (commentsResult.data.data ?? []) : [];
  const topComments = selectTopComments(comments, REDDIT_MAX_COMMENTS, { discussionSlots: 2 });

  return {
    ok: true,
    data: {
      title: post.title,
      content: buildRedditThreadDump(post, topComments),
      imageUrl: extractRedditImageUrl(post),
      score: post.score ?? 0,
      commentCount: post.num_comments ?? 0,
      author: post.author ?? null,
      flair: post.link_flair_text ?? null,
    },
  };
}

/** buildPostUrl を manual-article.ts からも使えるよう再エクスポートする（permalink優先の絶対URL組み立て）。 */
export { buildPostUrl };

export type ManualXContent = {
  title: string;
  content: string;
  author: string;
  xReplies: XReplyItem[];
};

/** `X_API_KEY` が設定されているか（未設定ならX経路は実行前に弾く）。 */
export function isXApiKeyConfigured(): boolean {
  return !!process.env.X_API_KEY;
}

/**
 * 指定したtweet1件を取得する（GetXAPI。advanced_search以外に単一tweet取得用の
 * `GET /twitter/tweets?tweet_ids=` を想定。公式Twitter API v2の`GET /2/tweets?ids=`と同様の
 * REST慣習に倣った設計。レスポンス形は`advanced_search`と同じ`{tweets:[...]}`と仮定する）。
 * `X_API_KEY` 未設定時は呼び出し側（isXApiKeyConfigured）で事前に弾く前提だが、二重の安全側として
 * ここでも未設定なら即座に失敗を返す。
 */
export async function fetchTweetById(tweetId: string): Promise<ManualFetchResult<ManualXContent>> {
  const apiKey = process.env.X_API_KEY;
  if (!apiKey) return { ok: false, message: "X の API キーが未設定のため利用できません" };

  const params = new URLSearchParams({ tweet_ids: tweetId });
  const url = `${GETXAPI_BASE}/twitter/tweets?${params.toString()}`;
  const result = await fetchJsonWithStatus<{ tweets?: GetXApiTweet[] }>(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (result.kind !== "ok") return { ok: false, message: describeFailure(result.kind, "Xの投稿") };

  const tweet = result.data.tweets?.[0];
  if (!tweet || !tweet.text || !tweet.author?.userName) {
    return { ok: false, message: "指定のXの投稿が見つかりません（削除済みの可能性があります）" };
  }

  // 返信/引用の取得（既存 fetchTopReplies、失敗・0件は空配列。無制限クロールにはならない件数上限つき）。
  const xReplies = await fetchTopReplies(tweetId, apiKey);

  return {
    ok: true,
    data: {
      title: buildTweetTitle(tweet.text),
      content: tweet.text,
      author: tweet.author.userName,
      xReplies,
    },
  };
}
