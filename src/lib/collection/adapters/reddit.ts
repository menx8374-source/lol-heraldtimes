/**
 * Reddit（海外の反応）から取得する live アダプタ（拡張E16 F-E16-1）。
 * 認証は Application-only OAuth2（client_credentials）。Redditアカウントのパスワードは不要で、
 * 公開リスティングの読み取り専用スコープのみを使う。
 *
 * 手順: (1) トークン取得（Basic認証: client_id:client_secret、body: grant_type=client_credentials）
 *   → (2) 許可サブレディットの hot リスティング取得（Bearerトークン＋必須User-Agent）
 *   → (3) 各投稿を RawCollectionItem へ整形。
 *
 * 信頼境界（外部API）: fetch はタイムアウト付き。トークン取得失敗・HTTPエラー・不正JSON・
 * ネットワーク断・クレデンシャル未設定はいずれも例外を投げず握り潰して空配列を返す
 * （1ソースの失敗が収集パイプライン全体を止めない方針。riot live アダプタと同方針）。
 * シークレット（client_secret・アクセストークン）はログに出さない。
 * Redditの返す本文は信頼できないユーザー生成テキストとして扱い、content文字列に入れるのみで
 * HTMLとして解釈させる経路には入れない（安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { DEFAULT_ALLOWED_SUBREDDITS } from "@/lib/collection/config";
import { fetchJsonSafe } from "@/lib/collection/adapters/http";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
/** 1リクエストで取得するリスティング件数（最終的な件数上限は呼び出し側pipelineのconfigが適用）。 */
const LISTING_LIMIT = 25;

function listingUrl(subreddit: string): string {
  return `https://oauth.reddit.com/r/${subreddit}/hot?limit=${LISTING_LIMIT}&raw_json=1`;
}

type RedditCredentials = {
  clientId: string;
  clientSecret: string;
  userAgent: string;
};

type RedditTokenResponse = {
  access_token?: string;
};

/** app-only OAuthのアクセストークンを取得する。失敗時はnullを返す（例外を投げない）。 */
async function fetchAccessToken(creds: RedditCredentials): Promise<string | null> {
  const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const json = await fetchJsonSafe<RedditTokenResponse>(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": creds.userAgent,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    },
    { logLabel: "reddit", context: "アクセストークン取得" },
  );
  return json?.access_token ?? null;
}

export type RedditPostData = {
  permalink: string;
  title: string;
  selftext?: string;
  created_utc: number;
};

type RedditListingChild = { data?: RedditPostData };
export type RedditListingResponse = {
  data?: { children?: RedditListingChild[] };
};

/** リスティングJSONから投稿データ配列を取り出す（不正な形の子要素は無視する）。 */
export function extractPosts(listing: RedditListingResponse): RedditPostData[] {
  const children = listing.data?.children ?? [];
  const posts: RedditPostData[] = [];
  for (const child of children) {
    if (child?.data) posts.push(child.data);
  }
  return posts;
}

/** 投稿permalinkから一意・安定な絶対URLを構築する。 */
export function buildPostUrl(permalink: string): string {
  return `https://www.reddit.com${permalink}`;
}

/** Reddit投稿1件を RawCollectionItem に整形する（selftext優先、無ければタイトルで代替）。 */
export function buildRedditItem(post: RedditPostData): RawCollectionItem {
  const content = post.selftext && post.selftext.trim().length > 0 ? post.selftext : post.title;
  return {
    sourceUrl: buildPostUrl(post.permalink),
    title: post.title,
    content,
    fetchedAt: new Date(post.created_utc * 1000),
  };
}

/** 許可サブレディットの hot リスティングを取得する。失敗時はnullを返す（例外を投げない）。 */
async function fetchListing(
  subreddit: string,
  token: string,
  userAgent: string,
): Promise<RedditListingResponse | null> {
  return fetchJsonSafe<RedditListingResponse>(
    listingUrl(subreddit),
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent } },
    { logLabel: "reddit", context: `r/${subreddit}` },
  );
}

export type RedditAdapterOptions = {
  /** テスト・注入用。既定は env `REDDIT_CLIENT_ID`。 */
  clientId?: string;
  /** テスト・注入用。既定は env `REDDIT_CLIENT_SECRET`。 */
  clientSecret?: string;
  /** テスト・注入用。既定は env `REDDIT_USER_AGENT`。 */
  userAgent?: string;
  /** 取得対象サブレディット。既定は `DEFAULT_ALLOWED_SUBREDDITS`。 */
  subreddits?: string[];
};

/**
 * Reddit（Application-only OAuth）から許可サブレディットのhotリスティングを収集する live アダプタ。
 * クレデンシャル未設定時は例外を投げず空配列を返し、スキップした旨をログに一度残す。
 */
export class RedditAdapter implements SourceAdapter {
  readonly sourceType = "reddit" as const;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly userAgent?: string;
  private readonly subreddits: string[];

  constructor(options: RedditAdapterOptions = {}) {
    this.clientId = options.clientId ?? process.env.REDDIT_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.REDDIT_CLIENT_SECRET;
    this.userAgent = options.userAgent ?? process.env.REDDIT_USER_AGENT;
    this.subreddits = options.subreddits ?? DEFAULT_ALLOWED_SUBREDDITS;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (!this.clientId || !this.clientSecret || !this.userAgent) {
      console.log(
        "[reddit] REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USER_AGENT が未設定のためReddit収集をスキップします",
      );
      return [];
    }

    const token = await fetchAccessToken({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      userAgent: this.userAgent,
    });
    if (!token) return [];

    const seenUrls = new Set<string>();
    const items: RawCollectionItem[] = [];
    for (const subreddit of this.subreddits) {
      const listing = await fetchListing(subreddit, token, this.userAgent);
      if (!listing) continue;
      for (const post of extractPosts(listing)) {
        const item = buildRedditItem(post);
        if (!item.sourceUrl || seenUrls.has(item.sourceUrl)) continue;
        seenUrls.add(item.sourceUrl);
        items.push(item);
      }
    }
    return items;
  }
}
