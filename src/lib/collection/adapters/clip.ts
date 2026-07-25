/**
 * YouTube/Twitch クリップ収集 live アダプタ（拡張E17 F-E17-1）。1つの `ClipAdapter`
 * （`sourceType:"clip"`）が YouTube と Twitch の両方から LoL 関連の動画/クリップを取得しまとめて返す。
 *
 * - YouTube: YouTube Data API v3 の検索エンドポイント。env `YOUTUBE_API_KEY`（秘密）。
 * - Twitch: app access token（client_credentials）→ helix clips エンドポイント。
 *   env `TWITCH_CLIENT_ID`・`TWITCH_CLIENT_SECRET`（秘密）。
 *
 * 各社のキーは独立に任意: 片方のみ設定ならその社のみ収集し、両方未設定なら空配列＋
 * スキップログを1度ずつ残す（他ソースの収集を止めない。reddit/riot live アダプタと同方針）。
 * 各fetchの失敗（キー未設定/HTTPエラー/不正JSON/ネットワーク断）は握り潰し例外を投げない。
 * シークレット（APIキー・client_secret・アクセストークン）はログに出さない。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchJsonSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
/** YouTube検索クエリ（LoL関連の動画に限定するための固定クエリ）。 */
const YOUTUBE_SEARCH_QUERY = "League of Legends";
/** 1回の収集で取得するYouTube動画件数（最終的な件数上限は呼び出し側pipelineのconfigが適用）。 */
const YOUTUBE_MAX_RESULTS = 15;

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_CLIPS_URL = "https://api.twitch.tv/helix/clips";
/** Twitchの「League of Legends」ゲームカテゴリID（公開情報。秘密ではない）。 */
const TWITCH_LOL_GAME_ID = "21779";
/** 1回の収集で取得するTwitchクリップ件数。 */
const TWITCH_CLIPS_FIRST = 15;

export function buildYouTubeSearchUrl(apiKey: string): string {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    order: "date",
    maxResults: String(YOUTUBE_MAX_RESULTS),
    q: YOUTUBE_SEARCH_QUERY,
    key: apiKey,
  });
  return `${YOUTUBE_SEARCH_URL}?${params.toString()}`;
}

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string };
};
export type YouTubeSearchResponse = { items?: YouTubeSearchItem[] };

/** 動画IDから一意・安定なYouTube動画URLを構築する。 */
export function buildYouTubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** 説明文冒頭＋チャンネル名の紹介文を組み立てる（逐語コピー回避のため冒頭のみに絞る）。 */
function buildYouTubeContent(description: string, channelTitle?: string): string {
  const excerpt = description.trim().slice(0, 200);
  const channelPart = channelTitle ? `（投稿者: ${channelTitle}）` : "";
  return excerpt.length > 0 ? `${excerpt}${channelPart}` : `LoL関連のYouTube動画${channelPart}`;
}

/** YouTube検索結果1件を RawCollectionItem に整形する。videoId/titleが欠けている場合はnull。 */
export function buildYouTubeItem(item: YouTubeSearchItem): RawCollectionItem | null {
  const videoId = item.id?.videoId;
  const title = item.snippet?.title;
  if (!videoId || !title) return null;
  return {
    sourceUrl: buildYouTubeVideoUrl(videoId),
    title,
    content: buildYouTubeContent(item.snippet?.description ?? "", item.snippet?.channelTitle),
    fetchedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
  };
}

/** YouTube検索レスポンスから RawCollectionItem[] を取り出す（不正な要素は無視する）。 */
export function extractYouTubeItems(res: YouTubeSearchResponse): RawCollectionItem[] {
  const items = res.items ?? [];
  const result: RawCollectionItem[] = [];
  for (const item of items) {
    const built = buildYouTubeItem(item);
    if (built) result.push(built);
  }
  return result;
}

type TwitchTokenResponse = { access_token?: string };

/** Twitch app access token（client_credentials）を取得する。失敗時はnullを返す（例外を投げない）。 */
async function fetchTwitchAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const json = await fetchJsonSafe<TwitchTokenResponse>(
    `${TWITCH_TOKEN_URL}?${params.toString()}`,
    { method: "POST" },
    { logLabel: "clip-twitch", context: "アクセストークン取得" },
  );
  return json?.access_token ?? null;
}

export function buildTwitchClipsUrl(): string {
  const params = new URLSearchParams({ game_id: TWITCH_LOL_GAME_ID, first: String(TWITCH_CLIPS_FIRST) });
  return `${TWITCH_CLIPS_URL}?${params.toString()}`;
}

type TwitchClip = { id?: string; url?: string; title?: string; broadcaster_name?: string; created_at?: string };
export type TwitchClipsResponse = { data?: TwitchClip[] };

/** クリップの配信者名を含む紹介文を組み立てる。 */
function buildTwitchContent(broadcasterName?: string): string {
  return broadcasterName
    ? `${broadcasterName}によるLeague of Legendsの配信クリップ。`
    : "League of Legendsの配信クリップ。";
}

/** Twitchクリップ1件を RawCollectionItem に整形する。url/titleが欠けている場合はnull。 */
export function buildTwitchItem(clip: TwitchClip): RawCollectionItem | null {
  if (!clip.url || !clip.title) return null;
  return {
    sourceUrl: clip.url,
    title: clip.title,
    content: buildTwitchContent(clip.broadcaster_name),
    fetchedAt: clip.created_at ? new Date(clip.created_at) : new Date(),
  };
}

/** Twitch helix clips レスポンスから RawCollectionItem[] を取り出す（不正な要素は無視する）。 */
export function extractTwitchItems(res: TwitchClipsResponse): RawCollectionItem[] {
  const clips = res.data ?? [];
  const result: RawCollectionItem[] = [];
  for (const clip of clips) {
    const built = buildTwitchItem(clip);
    if (built) result.push(built);
  }
  return result;
}

export type ClipAdapterOptions = {
  /** テスト・注入用。既定は env `YOUTUBE_API_KEY`。 */
  youtubeApiKey?: string;
  /** テスト・注入用。既定は env `TWITCH_CLIENT_ID`。 */
  twitchClientId?: string;
  /** テスト・注入用。既定は env `TWITCH_CLIENT_SECRET`。 */
  twitchClientSecret?: string;
};

/**
 * YouTube＋Twitchから LoL 関連クリップを収集する live アダプタ。各社のキーは独立に任意で、
 * 未設定の社だけをスキップする（両方未設定なら空配列＋ログを2件残す）。
 */
export class ClipAdapter implements SourceAdapter {
  readonly sourceType = "clip" as const;
  private readonly youtubeApiKey?: string;
  private readonly twitchClientId?: string;
  private readonly twitchClientSecret?: string;

  constructor(options: ClipAdapterOptions = {}) {
    this.youtubeApiKey = options.youtubeApiKey ?? process.env.YOUTUBE_API_KEY;
    this.twitchClientId = options.twitchClientId ?? process.env.TWITCH_CLIENT_ID;
    this.twitchClientSecret = options.twitchClientSecret ?? process.env.TWITCH_CLIENT_SECRET;
  }

  private async fetchYouTubeItems(): Promise<RawCollectionItem[]> {
    if (!this.youtubeApiKey) {
      console.log("[clip] YOUTUBE_API_KEY が未設定のためYouTube収集をスキップします");
      return [];
    }
    const json = await fetchJsonSafe<YouTubeSearchResponse>(
      buildYouTubeSearchUrl(this.youtubeApiKey),
      {},
      { logLabel: "clip-youtube", context: "検索" },
    );
    return json ? extractYouTubeItems(json) : [];
  }

  private async fetchTwitchItems(): Promise<RawCollectionItem[]> {
    if (!this.twitchClientId || !this.twitchClientSecret) {
      console.log("[clip] TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET が未設定のためTwitch収集をスキップします");
      return [];
    }
    const token = await fetchTwitchAccessToken(this.twitchClientId, this.twitchClientSecret);
    if (!token) return [];
    const json = await fetchJsonSafe<TwitchClipsResponse>(
      buildTwitchClipsUrl(),
      { headers: { "Client-Id": this.twitchClientId, Authorization: `Bearer ${token}` } },
      { logLabel: "clip-twitch", context: "クリップ取得" },
    );
    return json ? extractTwitchItems(json) : [];
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    const [youtubeItems, twitchItems] = await Promise.all([
      this.fetchYouTubeItems(),
      this.fetchTwitchItems(),
    ]);

    return dedupeBySourceUrl([...youtubeItems, ...twitchItems]);
  }
}
