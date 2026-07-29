/**
 * PBE関連ツイート取得層（PBE-S3 F-PBE3-1〜F-PBE3-3）。
 *
 * データマイナー **Spideraxe氏（@Spideraxe30）** と Riot開発Lead **Phroxzon氏（@RiotPhroxzon）** の
 * PBE関連ツイートを出典付きで取得する（`docs/pbe-research.md` §1.2・§2）。
 * PBEのスキル数値は多くがインフォグラフィック画像で投稿されるため機械的なOCR/再構成は誤情報リスクが
 * 高い。本モジュールは**ツイート本文（逐語）＋画像URL＋出典を保持するだけ**で、数値の抽出・解釈は
 * 一切行わない（後続 PBE-S5 で埋め込み/引用表示する）。
 *
 * 成長G7の `x.ts`（GetXAPIクライアント・`fetchTweetsForQuery`によるBearer認証＋タイムアウト付き
 * fetch・`parseSearchQueries`によるクエリパース・isReply除外の思想）を再利用し、重複実装しない。
 * `X_API_KEY` 設定時のみ live（GetXAPI advanced_search）、未設定時は mock（fixture）を返す
 * （無課金・本体を止めない。他の収集アダプタと同じフォールバック方針）。
 *
 * 信頼境界（外部API）: `fetchTweetsForQuery`（内部で`fetchJsonSafe`・タイムアウト10秒）を経由するため、
 * HTTPエラー・不正JSON・ネットワーク断・タイムアウトはいずれも例外を投げず空配列を返す。
 *
 * **記事化・埋め込み表示・opt-in env・人手キュレーションは PBE-S5**。本モジュールは取得層＋出典データ
 * ＋mock＋テストのみで、compose/pipeline/表示への配線は行わない（既存の本番挙動に影響ゼロ）。
 */
import { fetchTweetsForQuery, parseSearchQueries, type GetXApiTweet } from "@/lib/collection/adapters/x";
import pbeXFixture from "@/lib/collection/fixtures/pbe-x.json";

/** PBE関連ツイートの既定検索クエリ（Spideraxe/Phroxzon限定・PBE/patch関連・リツイート除外）。 */
const DEFAULT_PBE_QUERY = '(from:Spideraxe30 OR from:RiotPhroxzon) (PBE OR patch OR パッチ) -filter:retweets';

/** 連続fetch間の既定ディレイ(ms)。GetXAPIへの短時間バーストを避ける（G7 X_REQUEST_DELAY_MSと同思想）。 */
const PBE_X_REQUEST_DELAY_MS = 1000;

/** env `PBE_X_QUERIES`（`|||`区切り、x.tsと同じ区切り文字）をパースする。未設定・空なら既定クエリ1件。 */
export function parsePbeQueries(raw: string | undefined): string[] {
  return parseSearchQueries(raw, [DEFAULT_PBE_QUERY]);
}

/**
 * 方向性タグ（純ルールのキーワード判定のみ・数値の抽出/解釈は一切しない）。
 * 強化/弱体化の両方のキーワードが出現する、またはどちらも出現しない場合は「曖昧」として未設定にする
 * （既存原則「曖昧はadjust」と同じ安全側判断。数値を確定させない）。
 */
export type PbeDirection = "buff" | "nerf";

const NERF_KEYWORDS = ["弱体", "ナーフ", "nerf"];
const BUFF_KEYWORDS = ["強化", "バフ", "buff"];

/** ツイート本文からキーワードのみで方向性を軽くタグ付けする（純ルール・AI不使用・数値は見ない）。 */
export function detectPbeDirection(text: string): PbeDirection | undefined {
  const lower = text.toLowerCase();
  const hasNerf = NERF_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
  const hasBuff = BUFF_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
  if (hasNerf && !hasBuff) return "nerf";
  if (hasBuff && !hasNerf) return "buff";
  return undefined;
}

/**
 * 出典付きPBE関連ツイート（逐語text・画像URL保持のみ。数値は一切抽出しない）。
 * `author`はツイート主表示名（無ければハンドル名）、`authorHandle`は@ハンドル（英数字のみ）。
 */
export type PbeSourceTweet = {
  author: string;
  authorHandle: string;
  /** ツイート本文の逐語（要約・改変・OCR・数値抽出はしない）。 */
  text: string;
  url: string;
  createdAt: Date;
  /** スキル数値インフォグラフィック等のツイート画像URL（PBE-S5での埋め込み用）。無ければ空配列。 */
  mediaUrls: string[];
  /** 軽い方向性タグ（純ルール）。判定できない/曖昧な場合は未設定。 */
  direction?: PbeDirection;
};

/** GetXAPIの`media`配列（型不定）から画像/動画のURLだけを安全に取り出す（不正要素は無視・例外なし）。 */
function extractMediaUrls(media: unknown[] | undefined): string[] {
  if (!Array.isArray(media)) return [];
  const urls: string[] = [];
  for (const m of media) {
    if (m && typeof m === "object" && typeof (m as Record<string, unknown>).url === "string") {
      urls.push((m as Record<string, unknown>).url as string);
    }
  }
  return urls;
}

/**
 * GetXAPIのtweet1件を`PbeSourceTweet`に変換する純関数。id/url/text/authorのいずれかが欠落、または
 * isReply=true（リプライ由来の薄い投稿）はnull（呼び出し側でスキップ）。**textはそのまま保持し、
 * 要約・数値抽出・OCR・改変はしない**（捏造禁止）。
 */
export function buildPbeSourceTweet(tweet: GetXApiTweet): PbeSourceTweet | null {
  if (!tweet.id || !tweet.url || !tweet.text || !tweet.author?.userName) return null;
  if (tweet.isReply) return null;

  const createdAt = new Date(tweet.createdAt);
  const safeCreatedAt = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  return {
    author: tweet.author.name ?? tweet.author.userName,
    authorHandle: tweet.author.userName,
    text: tweet.text,
    url: tweet.url,
    createdAt: safeCreatedAt,
    mediaUrls: extractMediaUrls(tweet.media),
    direction: detectPbeDirection(tweet.text),
  };
}

/** `url`をキーに重複を除いた「順序保持」の配列を返す（http.tsの`dedupeBySourceUrl`と同思想）。 */
function dedupeByUrl(tweets: PbeSourceTweet[]): PbeSourceTweet[] {
  const seen = new Set<string>();
  const result: PbeSourceTweet[] = [];
  for (const tweet of tweets) {
    if (seen.has(tweet.url)) continue;
    seen.add(tweet.url);
    result.push(tweet);
  }
  return result;
}

type PbeXFixtureRow = {
  author: string;
  authorHandle: string;
  text: string;
  url: string;
  createdAt: string;
  mediaUrls?: string[];
};

/** fixture（mock）行を`PbeSourceTweet`へ変換する。directionはライブ経路と同じ純ルールで判定する。 */
function toPbeSourceTweets(rows: PbeXFixtureRow[]): PbeSourceTweet[] {
  return rows.map((row) => ({
    author: row.author,
    authorHandle: row.authorHandle,
    text: row.text,
    url: row.url,
    createdAt: new Date(row.createdAt),
    mediaUrls: row.mediaUrls ?? [],
    direction: detectPbeDirection(row.text),
  }));
}

export type PbeXSourceOptions = {
  /** テスト・注入用。既定は env `X_API_KEY`。未設定ならmock（fixture）を返す。 */
  apiKey?: string;
  /** 検索クエリ配列。既定は env `PBE_X_QUERIES`（`|||`区切り）、未設定時は既定クエリ1件。 */
  queries?: string[];
  product?: "Latest" | "Top";
  /** 連続fetch間のディレイ(ms)。既定 1000。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * PBE関連ツイート（Spideraxe/Phroxzon）を取得する（PBE-S3）。`X_API_KEY`（`options.apiKey`優先）が
 * 未設定ならmock（fixture）を返し、外部への課金・通信を一切発生させない。設定時のみGetXAPIへ
 * live接続する。取得失敗・非2xx・タイムアウトはいずれも空配列（本体を止めない）。
 */
export async function fetchPbeSourceTweets(options: PbeXSourceOptions = {}): Promise<PbeSourceTweet[]> {
  const apiKey = options.apiKey ?? process.env.X_API_KEY;
  if (!apiKey) {
    console.log("[pbe-x-source] X_API_KEY未設定のためmock(fixture)を返します");
    return toPbeSourceTweets(pbeXFixture as PbeXFixtureRow[]);
  }

  const queries = options.queries ?? parsePbeQueries(process.env.PBE_X_QUERIES);
  const product = options.product ?? "Latest";
  const delayMs = options.delayMs ?? PBE_X_REQUEST_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const results: PbeSourceTweet[][] = [];
  for (let i = 0; i < queries.length; i++) {
    if (i > 0) await sleep(delayMs);
    const tweets = await fetchTweetsForQuery(queries[i], apiKey, { product });
    const converted: PbeSourceTweet[] = [];
    for (const tweet of tweets) {
      const item = buildPbeSourceTweet(tweet);
      if (item) converted.push(item);
    }
    results.push(converted);
  }
  const merged = dedupeByUrl(results.flat());
  console.log(`[pbe-x-source] queries=${queries.length} collected=${merged.length}`);
  return merged;
}
