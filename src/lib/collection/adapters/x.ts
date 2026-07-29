/**
 * X（旧Twitter）から収集する live アダプタ（成長G7 F-G7-2）。
 *
 * サードパーティ GetXAPI（`https://api.getxapi.com`、$0.05/1,000tweets・$0.10無料クレジット）の
 * `GET /twitter/tweet/advanced_search` を使う。認証は `Authorization: Bearer <API_KEY>`。
 * `q`（`min_faves:`/`lang:`/`since:`/`-filter:retweets` 等のoperatorを含む検索クエリ）・
 * `product`（既定 `Latest`）・`cursor`（ページネーション、本アダプタは最初の1ページのみ使用）を
 * クエリパラメータに渡す。レスポンス `{ tweets: [...] }` の各 tweet を `RawCollectionItem` に変換する。
 *
 * 話題性・記事化判定にAIは使わない（`min_faves` operatorで発見段階を絞り、記事化はHotnessEvaluator
 * の数値ルールに委ねる）。フェイルオーバー(TwitterAPI.io)・カレンダートリガ・`fetchContent` は非目標。
 *
 * 信頼境界（外部API）: `fetchJsonSafe`（タイムアウト10秒）。HTTPエラー・不正JSON・ネットワーク断・
 * タイムアウトはいずれも例外を投げず空配列を返す（1ソースの失敗が収集パイプライン全体を止めない、
 * 既存アダプタと同方針）。isReply=trueのtweet（リプライ由来の薄い投稿）は変換側でも除外する
 * （`-filter:replies`はクエリ側にも設定）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchJsonSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";
import { splitIntoSentences } from "@/lib/generation/text-utils";

const GETXAPI_BASE = "https://api.getxapi.com";

/** GetXAPI呼び出しのタイムアウト（brief指定の10秒。既存の既定8秒より長めに個別指定する）。 */
const X_FETCH_TIMEOUT_MS = 10_000;

/** クエリを複数指定する際の区切り文字（query自体にカンマ・改行が含まれ得るため専用の区切りにする）。 */
const QUERY_SEPARATOR = "|||";

/** 国内向け既定クエリ（コスト最小＝当たりだけ。min_faves:100で課金制御）。 */
const DOMESTIC_QUERY =
  '(LoL OR LJL OR "リーグ・オブ・レジェンド" OR リグオブ) min_faves:100 lang:ja -filter:retweets -filter:replies';
/** 海外パッチ反応向け既定クエリ（min_faves:1000でより厳選）。 */
const OVERSEAS_QUERY = '("League of Legends" OR #LeagueOfLegends OR LoL) min_faves:1000 lang:en -filter:retweets';

const DEFAULT_SEARCH_QUERIES = [DOMESTIC_QUERY, OVERSEAS_QUERY];

/** tweetタイトルの最大長（本文の一部をそのまま短縮するのみ・捏造しない）。 */
const TITLE_MAX_LENGTH = 40;

function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * env文字列（`|||`区切り）をクエリ配列にパースする。未設定・空・全て空文字列なら `defaultQueries`。
 * `defaultQueries` 省略時は本アダプタの既定2クエリ（国内/海外）。PBE-S3の `pbe-x-source.ts` も
 * この関数を共有し、PBE用の既定クエリを渡して再利用する（重複実装しない）。
 */
export function parseSearchQueries(
  raw: string | undefined,
  defaultQueries: string[] = DEFAULT_SEARCH_QUERIES,
): string[] {
  if (!raw || raw.trim().length === 0) return defaultQueries;
  const parsed = raw
    .split(QUERY_SEPARATOR)
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
  return parsed.length > 0 ? parsed : defaultQueries;
}

/** 日付をGetXAPIのsince:/until:operatorが期待する `YYYY-MM-DD` 形式にする（UTC基準）。 */
function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * クエリに `since:` operatorが無ければ、重複取得防止のため付与する（brief「重複取得防止に
 * since:を付けられる形にする」）。既にsince:を含むクエリ（ユーザーが明示指定）はそのまま使う。
 * 取得漏れ・重複はPost永続化側の`@@unique([sourceType, externalId])`が最終防御になるため、
 * 日次窓（日付のみ）の簡易実装で十分（無理な精緻化はしない）。
 */
export function appendSinceIfMissing(query: string, sinceDate: string): string {
  if (/\bsince:/i.test(query)) return query;
  return `${query} since:${sinceDate}`;
}

/**
 * GetXAPI advanced_search のURLを組み立てる純関数（brief「q/product/cursor」仕様どおり）。
 * `cursor` は将来のページネーション用（本アダプタは1ページのみ使用するため呼び出し側では省略）。
 */
export function buildAdvancedSearchUrl(query: string, product: "Latest" | "Top" = "Latest", cursor?: string): string {
  const params = new URLSearchParams({ q: query, product });
  if (cursor) params.set("cursor", cursor);
  return `${GETXAPI_BASE}/twitter/tweet/advanced_search?${params.toString()}`;
}

export type GetXApiTweetAuthor = {
  userName: string;
  id?: string;
  name?: string;
  followers?: number;
  isVerified?: boolean;
  isBlueVerified?: boolean;
};

export type GetXApiTweet = {
  id: string;
  text: string;
  url: string;
  createdAt: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  isReply?: boolean;
  inReplyToId?: string | null;
  conversationId?: string;
  media?: unknown[];
  author?: GetXApiTweetAuthor;
};

export type GetXApiSearchResponse = {
  query?: string;
  tweet_count?: number;
  has_more?: boolean;
  next_cursor?: string;
  tweets?: GetXApiTweet[];
};

/** tweet本文から先頭一文を切り出し、記事タイトルの下地にする純関数（捏造せずtextの一部をそのまま短縮）。 */
export function buildTweetTitle(text: string): string {
  const trimmed = text.trim();
  const sentences = splitIntoSentences(trimmed);
  const first = sentences[0] ?? trimmed;
  return first.length <= TITLE_MAX_LENGTH ? first : `${first.slice(0, TITLE_MAX_LENGTH)}…`;
}

/**
 * GetXAPIのtweet1件をRawCollectionItemに変換する純関数（brief F-G7-2のフィールド対応）。
 * id/url/text/authorが欠落している、またはisReply=true（リプライ由来の薄い投稿）の場合はnull
 * （呼び出し側でスキップする）。
 */
export function buildXItem(tweet: GetXApiTweet): RawCollectionItem | null {
  if (!tweet.id || !tweet.url || !tweet.text || !tweet.author?.userName) return null;
  if (tweet.isReply) return null;

  const createdAt = new Date(tweet.createdAt);
  const fetchedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  return {
    sourceUrl: tweet.url,
    title: buildTweetTitle(tweet.text),
    content: tweet.text,
    fetchedAt,
    externalId: tweet.id,
    score: tweet.likeCount ?? 0,
    commentCount: tweet.replyCount ?? 0,
    author: tweet.author.userName,
    media: Array.isArray(tweet.media) && tweet.media.length > 0 ? tweet.media : undefined,
    category: "Xの反応",
  };
}

export type FetchTweetsOptions = {
  product?: "Latest" | "Top";
  timeoutMs?: number;
};

/**
 * GetXAPI advanced_search を1クエリ分呼び出し、tweet配列を返す共通実装。認証（Bearer）・タイムアウト・
 * 失敗時の空配列フォールバックをここに一元化し、`XAdapter`（成長G7）とPBE-S3 `pbe-x-source.ts`
 * （Spideraxe/Phroxzon等のPBE関連ツイート取得）の両方から共有する（重複実装しない）。
 */
export async function fetchTweetsForQuery(
  query: string,
  apiKey: string,
  options: FetchTweetsOptions = {},
): Promise<GetXApiTweet[]> {
  const { product = "Latest", timeoutMs = X_FETCH_TIMEOUT_MS } = options;
  const url = buildAdvancedSearchUrl(query, product);
  const json = await fetchJsonSafe<GetXApiSearchResponse>(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    { logLabel: "x", context: `query="${query.slice(0, 60)}"`, timeoutMs },
  );
  return json?.tweets ?? [];
}

export type XAdapterOptions = {
  /** テスト・注入用。既定は env `X_API_KEY`。 */
  apiKey?: string;
  /** 検索クエリ配列。既定は env `X_SEARCH_QUERIES`（`|||`区切り）、未設定時は既定クエリ2件。 */
  queries?: string[];
  product?: "Latest" | "Top";
  /** 現在時刻の注入点（テスト用、since:窓の計算に使う）。既定は実時刻。 */
  now?: () => Date;
  /** since:窓の遡り時間（時間）。既定は env `X_SINCE_HOURS`（既定24＝前日分まで）。 */
  sinceHours?: number;
  /** 連続fetch間のディレイ(ms)。既定は env `X_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * X（旧Twitter、GetXAPI）から収集する live アダプタ（成長G7）。複数の検索クエリ（既定: 国内/海外の
 * 2クエリ）を直列で呼び、結果をマージ・重複排除して返す。`X_API_KEY` はこのクラス自体でも未設定なら
 * 空配列を返す（呼び出し側 adapters/index.ts の mock フォールバックと二重に安全側へ倒す）。
 */
export class XAdapter implements SourceAdapter {
  readonly sourceType = "x" as const;
  private readonly apiKey: string | undefined;
  private readonly queries: string[];
  private readonly product: "Latest" | "Top";
  private readonly now: () => Date;
  private readonly sinceHours: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: XAdapterOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.X_API_KEY;
    this.queries = options.queries ?? parseSearchQueries(process.env.X_SEARCH_QUERIES);
    this.product = options.product ?? "Latest";
    this.now = options.now ?? (() => new Date());
    this.sinceHours = options.sinceHours ?? envIntLocal("X_SINCE_HOURS", 24);
    this.delayMs = options.delayMs ?? envIntLocal("X_REQUEST_DELAY_MS", 1000);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async fetchQuery(query: string): Promise<RawCollectionItem[]> {
    const tweets = await fetchTweetsForQuery(query, this.apiKey!, {
      product: this.product,
      timeoutMs: X_FETCH_TIMEOUT_MS,
    });
    const items: RawCollectionItem[] = [];
    for (const tweet of tweets) {
      const item = buildXItem(tweet);
      if (item) items.push(item);
    }
    return items;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (!this.apiKey) {
      console.log("[x] X_API_KEY未設定のため収集をスキップします");
      return [];
    }

    const sinceDate = formatDateOnly(new Date(this.now().getTime() - this.sinceHours * 60 * 60 * 1000));
    const results: RawCollectionItem[][] = [];
    for (let i = 0; i < this.queries.length; i++) {
      if (i > 0) await this.sleep(this.delayMs);
      const query = appendSinceIfMissing(this.queries[i], sinceDate);
      results.push(await this.fetchQuery(query));
    }
    const merged = dedupeBySourceUrl(results.flat());
    console.log(`[x] queries=${this.queries.length} collected=${merged.length}`);
    return merged;
  }
}
