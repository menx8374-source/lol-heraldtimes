/**
 * 運営CMS v2（admincms-S2 F5/F6）: 指定URLからの手動記事化で使う、URL判定・正規化の純関数。
 * DB・外部APIには一切依存しない（テスト容易性・決定論のため）。
 *
 * ホストのホワイトリスト（brief記載どおり）:
 * - reddit: reddit.com / www.reddit.com / old.reddit.com
 * - x: x.com / twitter.com / www.x.com / mobile.twitter.com
 * それ以外のホスト・非http(s)スキーム（javascript: 等）・非URL文字列は拒否する。
 */

export type ManualArticleUrlOk = {
  source: "reddit" | "x";
  /** ソース内で安定・一意な外部ID（reddit=投稿id、x=tweet id）。 */
  externalId: string;
  /** 正規化後URL（クエリ・末尾スラッシュ・大文字小文字の違いを吸収した表記）。 */
  normalizedUrl: string;
};

export type ManualArticleUrlError = { error: "unsupported" | "invalid" };

export type ManualArticleUrlResult = ManualArticleUrlOk | ManualArticleUrlError;

const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com"]);
const X_HOSTS = new Set(["x.com", "twitter.com", "www.x.com", "mobile.twitter.com"]);

/** Reddit投稿URLのパスから `/comments/<id>/` の投稿IDを抽出する（大文字小文字・末尾スラッシュ・クエリは無関係）。 */
function extractRedditThreadId(pathname: string): string | null {
  const match = pathname.match(/\/comments\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

/** X投稿URLのパスから `/status/<id>` のtweet IDを抽出する。 */
function extractTweetId(pathname: string): string | null {
  const match = pathname.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 入力文字列を解析し、対応ソース種別・外部ID・正規化URLを返す。
 * 非URL文字列・空文字は `{ error: "invalid" }`、非対応ホストは `{ error: "unsupported" }`。
 */
export function parseManualArticleUrl(input: string): ManualArticleUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { error: "invalid" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "invalid" };
  }

  // javascript: 等の非http(s)スキームは拒否する。
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "invalid" };

  const host = url.hostname.toLowerCase();

  if (REDDIT_HOSTS.has(host)) {
    const externalId = extractRedditThreadId(url.pathname);
    if (!externalId) return { error: "unsupported" };
    return { source: "reddit", externalId, normalizedUrl: `https://www.reddit.com/comments/${externalId}` };
  }

  if (X_HOSTS.has(host)) {
    const externalId = extractTweetId(url.pathname);
    if (!externalId) return { error: "unsupported" };
    return { source: "x", externalId, normalizedUrl: `https://x.com/i/status/${externalId}` };
  }

  return { error: "unsupported" };
}
