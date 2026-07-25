/**
 * 記事内埋め込みブロック（拡張E3: X/YouTube/配信クリップ）の provider 定義とURL検証。
 *
 * ⚠ 実際の外部 iframe／スクリプトは読み込まない（著作権・CSP・SSRF回避のため）。
 * 表示は provider が分かるプレースホルダーカード＋元URLへのリンクのみで、
 * dangerouslySetInnerHTML は使わない。将来 provider ごとの実埋め込み（oEmbed 等）に
 * 差し替える際も、この URL 検証だけは必ず経由させる。
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
