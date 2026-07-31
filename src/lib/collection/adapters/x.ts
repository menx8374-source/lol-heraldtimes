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
/**
 * 議論特化クエリ（X-reply-S1 F-XR1-3）。いいねだけでなくリプライ多数＝賛否が割れた投稿を
 * 発見段階で拾う。`min_replies:` はGetXAPIの確証あるoperator。
 */
const DISCUSSION_QUERY = '(LoL OR LJL OR "リーグ・オブ・レジェンド") min_replies:30 min_faves:30 lang:ja -filter:retweets';

const DEFAULT_SEARCH_QUERIES = [DOMESTIC_QUERY, OVERSEAS_QUERY, DISCUSSION_QUERY];

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
  lang?: string;
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
    // X-reply-S1 F-XR1-2: 議論量（isControversialの入力）にリプライ＋引用を反映する。
    // quoteCountはGetXApiTweet型に実在するフィールド（GetXAPIレスポンス仕様）のため合算する。
    commentCount: (tweet.replyCount ?? 0) + (tweet.quoteCount ?? 0),
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

/**
 * 親Xポストのリプライ/引用ツイート1件分（X-reply-S2 F-XR2-1）。`Post.media.xReplies`
 * （既存JSON列、スキーマ変更なし）に保存し、`GenerationCandidate.xReplies` へ配線する
 * （表示自体はS3、逐語のままAPI値を保持し捏造・OCR等は行わない）。
 */
export type XReplyItem = {
  id: string;
  text: string;
  author: string;
  likeCount: number;
  replyCount: number;
  quoteCount: number;
  url: string;
  lang?: string;
  /** conversation_id由来(リプライ)=false / quoted_tweet_id由来(引用)=true。 */
  isQuote: boolean;
  /**
   * 返信元ツイートID（resel-S1 F-RS1-3）。`GetXApiTweet.inReplyToId` を逐語保持（null/未設定は
   * undefinedに正規化）。会話チェーン解決（アンカー文脈）はS2で使う想定。現時点では選定・表示に
   * 使わない（`buildXReactionBlocks`の表示挙動は不変・回帰なし）。
   */
  inReplyToId?: string;
};

/** `X_REPLIES_MODE`（既定on）。offのときpost-pipeline.tsは一切fetchしない（$0・回帰ゼロ）。 */
export function isXRepliesModeOn(): boolean {
  return process.env.X_REPLIES_MODE !== "off";
}

/** `X_QUOTES_MODE`（既定on）。offのとき `fetchTopReplies` は引用(quoted_tweet_id:)を取得しない。 */
export function isXQuotesModeOn(): boolean {
  return process.env.X_QUOTES_MODE !== "off";
}

/**
 * リプライ/引用の合算取得件数上限（`X_REPLIES_MAX`、既定8）。`fetchTopReplies` を `max` 省略で呼ぶ
 * 既存の呼び出し（post-pipeline.ts）はこの既定のまま＝回帰なし。
 */
function defaultRepliesMax(): number {
  return envIntLocal("X_REPLIES_MAX", 8);
}

/**
 * 選定用プールの取得件数上限（resel-S1 F-RS1-3、既定15。env `X_REPLIES_POOL_MAX` で上書き可）。
 * S2の「score優先＋アンカー文脈」統一選定（目安~12＋文脈余白）に足りるよう、`X_REPLIES_MAX`
 * （下位互換のため既定8のまま変更しない）より広いプールを明示的に要求したい呼び出し側が
 * `fetchTopReplies(id, key, { max: defaultRepliesPoolMax() })` のように opt-in で使う想定。
 * `fetchTopReplies` の既定（`max` 省略時）は変えない（`X_REPLIES_MAX` のまま＝表示件数は回帰ゼロ）。
 * 追加コストは同一ページ内の取得件数増加のみで、APIコール回数（クエリ数）は変わらない。
 */
export function defaultRepliesPoolMax(): number {
  return envIntLocal("X_REPLIES_POOL_MAX", 15);
}

/** `conversation_id:` operatorでそのスレの返信を取得するクエリを組み立てる純関数。 */
export function buildRepliesQuery(parentTweetId: string): string {
  return `conversation_id:${parentTweetId} -filter:retweets`;
}

/** `quoted_tweet_id:` operatorで親を引用したツイートを取得するクエリを組み立てる純関数。 */
export function buildQuotesQuery(parentTweetId: string): string {
  return `quoted_tweet_id:${parentTweetId}`;
}

/**
 * GetXAPIのtweet1件をXReplyItemに変換する純関数。id/text/url/author欠落、または
 * 親ツイート自身（id===parentTweetId、親が自身の会話に含まれ得るため）はnull（呼び出し側でスキップ）。
 */
export function toXReplyItem(tweet: GetXApiTweet, parentTweetId: string, isQuote: boolean): XReplyItem | null {
  if (!tweet.id || !tweet.text || !tweet.url || !tweet.author?.userName) return null;
  if (tweet.id === parentTweetId) return null;
  return {
    id: tweet.id,
    text: tweet.text,
    author: tweet.author.userName,
    likeCount: tweet.likeCount ?? 0,
    replyCount: tweet.replyCount ?? 0,
    quoteCount: tweet.quoteCount ?? 0,
    url: tweet.url,
    ...(tweet.lang ? { lang: tweet.lang } : {}),
    isQuote,
    ...(tweet.inReplyToId ? { inReplyToId: tweet.inReplyToId } : {}),
  };
}

export type FetchTopRepliesOptions = {
  /** 既定: `isXQuotesModeOn()`（env `X_QUOTES_MODE`、既定on）。 */
  quotesMode?: boolean;
  /**
   * 合算の取得件数上限。既定: `X_REPLIES_MAX`（既定8、下位互換）。より広い選定用プールが必要な
   * 呼び出し側（resel-S2想定）は `defaultRepliesPoolMax()`（既定15）を明示的に渡す。
   */
  max?: number;
  product?: "Latest" | "Top";
  timeoutMs?: number;
};

/**
 * 親Xポスト（tweetId）のリプライ（＋X_QUOTES_MODE on時は引用も）を取得する
 * （X-reply-S2 F-XR2-1）。呼び出し側（post-pipeline.ts）が「hot確定してAI記事化する親Xポスト」
 * だけに限定して呼ぶことでコストを抑える（本関数自体はガードを持たない純粋な取得関数）。
 * 失敗・タイムアウト・キー無し・0件はいずれも空配列（`fetchTweetsForQuery`が内部で
 * 例外を投げず空配列にフォールバックする既存方針をそのまま踏襲）。
 */
export async function fetchTopReplies(
  parentTweetId: string,
  apiKey: string | undefined,
  opts: FetchTopRepliesOptions = {},
): Promise<XReplyItem[]> {
  if (!apiKey || !parentTweetId) return [];

  const {
    quotesMode = isXQuotesModeOn(),
    max = defaultRepliesMax(),
    product = "Top",
    timeoutMs = X_FETCH_TIMEOUT_MS,
  } = opts;

  try {
    const items: XReplyItem[] = [];

    const replyTweets = await fetchTweetsForQuery(buildRepliesQuery(parentTweetId), apiKey, { product, timeoutMs });
    for (const tweet of replyTweets) {
      const item = toXReplyItem(tweet, parentTweetId, false);
      if (item) items.push(item);
    }

    if (quotesMode) {
      const quoteTweets = await fetchTweetsForQuery(buildQuotesQuery(parentTweetId), apiKey, { product, timeoutMs });
      for (const tweet of quoteTweets) {
        const item = toXReplyItem(tweet, parentTweetId, true);
        if (item) items.push(item);
      }
    }

    // 同一tweetがリプライ集合と引用集合の両方に現れた場合の重複を排除する（先に入れた側＝
    // リプライを優先。id重複で二重表示になるのを防ぐ）。
    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    deduped.sort((a, b) => {
      const diff = b.likeCount - a.likeCount;
      if (diff !== 0) return diff;
      return b.replyCount - a.replyCount;
    });

    return deduped.slice(0, max);
  } catch (err) {
    console.error(`[x] リプライ/引用の取得に失敗しました (parentTweetId=${parentTweetId})`, err instanceof Error ? err.message : err);
    return [];
  }
}

export type XAdapterOptions = {
  /** テスト・注入用。既定は env `X_API_KEY`。 */
  apiKey?: string;
  /** 検索クエリ配列。既定は env `X_SEARCH_QUERIES`（`|||`区切り）、未設定時は既定クエリ3件（国内/海外/議論特化）。 */
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
 * X（旧Twitter、GetXAPI）から収集する live アダプタ（成長G7）。複数の検索クエリ（既定: 国内/海外/
 * 議論特化の3クエリ、X-reply-S1 F-XR1-3）を直列で呼び、結果をマージ・重複排除して返す。`X_API_KEY`
 * はこのクラス自体でも未設定なら空配列を返す（呼び出し側 adapters/index.ts の mock フォールバックと
 * 二重に安全側へ倒す）。
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
