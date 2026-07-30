/**
 * 記事内埋め込みブロック（拡張E3: X/YouTube/配信クリップ）の provider 定義とURL検証。
 *
 * ⚠ youtube/clip/twitter とも、外部の任意スクリプト（widgets.js等）は読み込まない
 * （著作権・CSP・SSRF回避のため）。実iframe化する場合も、各provider公式のサンドボックス化
 * embedエンドポイント（youtube-nocookie.com/clips.twitch.tv/platform.twitter.com）のみを、
 * この URL 検証・ID/slug抽出関数を必ず経由して組み立てる。生URLをそのままiframe srcに使わない。
 * dangerouslySetInnerHTML は使わない。
 */

export type EmbedProvider = "twitter" | "youtube" | "clip";

export const EMBED_PROVIDER_LABELS: Record<EmbedProvider, string> = {
  twitter: "X（Twitter）投稿の埋め込み",
  youtube: "YouTube 動画の埋め込み",
  clip: "配信クリップの埋め込み",
};

/** provider ごとの正規ドメインのホワイトリスト（サブドメイン違い・偽装ドメインは拒否）。 */
const EMBED_ALLOWED_HOSTS: Record<EmbedProvider, string[]> = {
  twitter: ["twitter.com", "x.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  clip: ["clips.twitch.tv", "twitch.tv", "www.twitch.tv"],
};

/** 文字列が既知の埋め込み provider か（型ガード）。provider 集合は EMBED_ALLOWED_HOSTS を単一の source of truth にする。 */
export function isEmbedProvider(value: unknown): value is EmbedProvider {
  return typeof value === "string" && value in EMBED_ALLOWED_HOSTS;
}

/**
 * ホスト名が許可ドメインそのもの、またはその正規サブドメインかを判定する（純関数）。
 * 例: allowed="twitch.tv" のとき host="clips.twitch.tv" は許可、host="eviltwitch.tv" は拒否。
 */
function isHostAllowed(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * URLのホストから対応する EmbedProvider を判定する純関数（`EMBED_ALLOWED_HOSTS` が単一の source of
 * truth。ホスト判定を各所に散らさずここに集約する）。どの provider にも該当しない／URL不正なら null。
 * 例: youtube.com→"youtube"、clips.twitch.tv→"clip"、x.com→"twitter"。
 */
export function embedProviderForUrl(url: string): EmbedProvider | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const provider of Object.keys(EMBED_ALLOWED_HOSTS) as EmbedProvider[]) {
    if (EMBED_ALLOWED_HOSTS[provider].some((allowed) => isHostAllowed(host, allowed))) {
      return provider;
    }
  }
  return null;
}

/**
 * 埋め込みURLが provider 既定のホワイトリストドメイン（https限定）かどうかを検証する純関数。
 * URLとして解釈できない値・http(平文)・ホワイトリスト外ドメインはすべて false（=表示しない）。
 */
export function isAllowedEmbedUrl(provider: EmbedProvider, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const allowedHosts = EMBED_ALLOWED_HOSTS[provider] ?? [];
  return allowedHosts.some((allowed) => isHostAllowed(host, allowed));
}

/**
 * ツイートのステータスURL（`x.com`/`twitter.com` の `/<username>/status/<id>` 形式）かどうかを
 * 判定する純関数（成長G7 F-G7-4）。ホスト・スキーム検証は既存の `embedProviderForUrl`/
 * `isAllowedEmbedUrl`（"twitter" provider）を再利用し、加えてパスがステータスURL形式であることも
 * 要求する（無関係な x.com/twitter.com ページ（プロフィール・設定等）を誤って埋め込まないため）。
 */
export function isValidTweetStatusUrl(url: string): boolean {
  if (embedProviderForUrl(url) !== "twitter" || !isAllowedEmbedUrl("twitter", url)) return false;
  try {
    const pathname = new URL(url).pathname;
    return /^\/[^/]+\/status\/\d+/.test(pathname);
  } catch {
    return false;
  }
}

/**
 * 実iframe埋め込み（拡張E22）: URLからID/slugを抽出しiframe用srcを組み立てる純関数群。
 * いずれも embedProviderForUrl + isAllowedEmbedUrl の許可判定を必ず経由したうえで、
 * 抽出したID/slugを英数・ハイフン・アンダースコアの厳格な形式検証にかける。
 * 検証に落ちた場合（許可外ホスト・URL不正・ID形式違反）はすべて null を返す（＝埋め込まない）。
 */

/** YouTube動画IDの形式（英数・ハイフン・アンダースコアの11文字。YouTube公式仕様に準拠）。 */
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Twitchクリップslugの形式（英数・ハイフン・アンダースコア、1文字以上）。 */
const TWITCH_CLIP_SLUG_RE = /^[A-Za-z0-9_-]+$/;

/** ツイートIDの形式（数値のみ・Snowflake ID相当の最大20桁、X-embed F-XE-1）。 */
const TWEET_STATUS_ID_RE = /^[0-9]{1,20}$/;

/**
 * 指定providerとしての許可判定（embedProviderForUrl + isAllowedEmbedUrl）を通過した URL を返す。
 * いずれかに落ちれば null。抽出関数の共通前処理をここに集約し、各抽出関数での再パース重複を避ける。
 */
function parseAllowedEmbedUrl(provider: EmbedProvider, url: string): URL | null {
  if (embedProviderForUrl(url) !== provider || !isAllowedEmbedUrl(provider, url)) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * YouTubeのURL（`youtube.com/watch?v=ID`・`youtu.be/ID`・`youtube.com/shorts/ID`）から
 * 動画IDを抽出する。provider判定・許可URL検証に落ちる、またはID形式が不正な場合は null。
 */
export function extractYoutubeVideoId(url: string): string | null {
  const parsed = parseAllowedEmbedUrl("youtube", url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = parsed.pathname.slice(1).split("/")[0] || null;
  } else if (parsed.pathname === "/watch") {
    id = parsed.searchParams.get("v");
  } else if (parsed.pathname.startsWith("/shorts/")) {
    id = parsed.pathname.slice("/shorts/".length).split("/")[0] || null;
  }
  if (!id || !YOUTUBE_VIDEO_ID_RE.test(id)) return null;
  return id;
}

/**
 * TwitchクリップのURL（`clips.twitch.tv/SLUG`・`twitch.tv/*\/clip/SLUG`）からslugを抽出する。
 * provider判定・許可URL検証に落ちる、またはslug形式が不正な場合は null。
 */
export function extractTwitchClipSlug(url: string): string | null {
  const parsed = parseAllowedEmbedUrl("clip", url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  let slug: string | null = null;
  if (host === "clips.twitch.tv") {
    slug = parsed.pathname.slice(1).split("/")[0] || null;
  } else {
    const match = parsed.pathname.match(/\/clip\/([^/]+)/);
    slug = match ? match[1] : null;
  }
  if (!slug || !TWITCH_CLIP_SLUG_RE.test(slug)) return null;
  return slug;
}

/**
 * ツイートのステータスURL（`x.com`/`twitter.com` の `/<username>/status/<id>` 形式）から
 * 数値のツイートIDを抽出する（X-embed F-XE-1）。`isValidTweetStatusUrl` と同じ検証（provider判定・
 * 許可URL検証・パス形式）を経由したうえで、抽出したIDを `TWEET_STATUS_ID_RE`（数値のみ）で
 * 再検証する。生URLをそのままiframe srcに使わないため、埋め込みに使う値は必ずこの関数を経由する。
 * 検証に落ちた場合（許可外ホスト・URL不正・ステータスURL形式でない・ID形式違反）は null。
 */
export function extractTweetStatusId(url: string): string | null {
  const parsed = parseAllowedEmbedUrl("twitter", url);
  if (!parsed) return null;
  const match = parsed.pathname.match(/^\/[^/]+\/status\/(\d+)/);
  const id = match ? match[1] : null;
  if (!id || !TWEET_STATUS_ID_RE.test(id)) return null;
  return id;
}

/**
 * 埋め込みブロックの provider/url から実iframe用の src を組み立てる純関数（拡張E22、
 * twitterはX-embedスプリントでTwitter公式のサンドボックス化iframe対象に追加）。
 * YouTube は `youtube-nocookie.com/embed/{ID}`（プライバシー強化ドメイン）、
 * Twitchクリップは `clips.twitch.tv/embed?clip={SLUG}&parent={siteHost}`、
 * twitterは `platform.twitter.com/embed/Tweet.html?id={数値ID}`（Twitter公式のサンドボックス化
 * iframe。widgets.js等の外部スクリプトは読み込まない）を返す。
 * `siteHost` は埋め込みを表示するページの閲覧ドメイン（`getSiteUrl()` 由来）で、Twitchの
 * parent検証に必須。ID/slug抽出に失敗した場合は null（→呼び出し側はカードにフォールバック）。
 */
export function embedIframeSrc(provider: EmbedProvider, url: string, siteHost: string): string | null {
  if (provider === "youtube") {
    const id = extractYoutubeVideoId(url);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (provider === "clip") {
    const slug = extractTwitchClipSlug(url);
    if (!slug) return null;
    return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${encodeURIComponent(siteHost)}`;
  }
  if (provider === "twitter") {
    const id = extractTweetStatusId(url);
    return id ? `https://platform.twitter.com/embed/Tweet.html?id=${id}` : null;
  }
  return null;
}
