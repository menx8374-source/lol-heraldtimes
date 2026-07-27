/**
 * Riot公式ニュース（`https://www.leagueoflegends.com/ja-jp/news/`）から収集する live アダプタ
 * （リファクタリングS7b F-S7b-2）。
 *
 * 一覧ページから記事リンクを抽出し、**URLルール（純関数・AI分類なし）**で下記のいずれかに分類する:
 * - `leagueoflegends.com/ja-jp/news/<type>/<slug>` 形式:
 *   - パス `esports` → カテゴリ「eスポーツ」
 *   - slugにチャンピオン/スキン系キーワード（champion/skin/reveal/cinematic）→「Riot公式」
 *   - パス `dev` →「パッチ/メタ」（Dev Blog）
 *   - パス `game-updates`（パッチノートのslugは除く。既存 riot-datadragon アダプタが担当し重複回避）→「パッチ/メタ」
 *   - `community` その他 → 対象外（スキップ）
 * - `lolesports.com/ja-jp/news/<slug>` 形式（実データ確認: 大会結果等のeスポーツ記事は別ドメインで配信され、
 *   `esports` のような種別セグメントを持たない）→ 常に「eスポーツ」。
 *
 * 対象記事は個別ページを取得し `og:title`（タイトル、事実）・`og:image`（サムネイル）・本文テキスト
 * （`stripHtmlToText` 相当）を抽出して `RawCollectionItem` を組み立てる。`lolesports.com` はページに
 * `og:title` を持たないことを実データで確認したため、その場合は `<h1>` 見出しをタイトルの
 * フォールバックに使う（それも取れなければグレースフルにその1件をスキップする）。
 *
 * 信頼境界（外部API）: `fetchTextSafe`（タイムアウト付き）。HTTPエラー・ネットワーク断は例外を投げず
 * null/空配列を返す（1ソースの失敗が収集パイプライン全体を止めない方針。riot/reddit/5ch live アダプタと
 * 同方針）。1記事分の取得失敗（タイトル取得不可等）もその記事だけスキップし、他記事の収集は継続する。
 * 最新 `maxItems`（既定4、env `RIOT_NEWS_MAX_ITEMS`）件まで・externalId(記事slug)で重複排除・
 * リクエスト間ディレイ・直列取得。
 */
import type { CategoryLabel } from "@/lib/categories";
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { fetchTextSafe } from "@/lib/collection/adapters/http";
import { decodeHtmlEntities, extractOgImageUrl, stripHtmlToText } from "@/lib/collection/adapters/riot-datadragon";

const LEAGUE_ORIGIN = "https://www.leagueoflegends.com";
/** 大会・eスポーツニュースの配信元（実データ確認: leagueoflegends.comとは別ドメイン）。 */
const ESPORTS_ORIGIN = "https://lolesports.com";
const NEWS_LIST_URL = `${LEAGUE_ORIGIN}/ja-jp/news/`;

/** 公式サイトが空/既定UAのbotアクセスを弾くことがあるため、ブラウザ相当のUAを付ける（riot-datadragonと同方針）。 */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 最新何件まで取得するか（既定4、env `RIOT_NEWS_MAX_ITEMS`）。 */
const DEFAULT_MAX_ITEMS = 4;
/** 連続fetch間のディレイ(ms)（既定1000、env `RIOT_NEWS_REQUEST_DELAY_MS`）。 */
const DEFAULT_REQUEST_DELAY_MS = 1000;
/** ニュース本文抜粋の最大長（トークン節約の有界化。パッチノート本文ほど長くする必要はない）。 */
const NEWS_BODY_MAX_LENGTH = 20000;

function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** チャンピオン/スキン系記事とみなすslugキーワード（大小文字無視）。 */
const CHAMPION_SKIN_KEYWORDS = ["champion", "skin", "reveal", "cinematic"];

/**
 * 分類・取得に使う正規化済みニュースリンク。`type` は `leagueoflegends.com` の
 * `/ja-jp/news/<type>/<slug>` 由来のパスセグメント。`lolesports.com`（種別セグメントを持たない
 * `/ja-jp/news/<slug>` 形式）由来のリンクは `type: null` になる。
 */
export type NewsLink = { url: string; type: string | null; slug: string };

/** URLパスの正規化（クエリ/ハッシュ除去、末尾スラッシュ除去）。 */
function normalizeUrlPath(path: string): string {
  let p = path.split("#")[0].split("?")[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * href属性値（相対パス／`leagueoflegends.com`絶対URL／`lolesports.com`絶対URL）をニュースリンクとして
 * 解析する純関数。対象外ホスト・ニュース記事として型が揃わないもの（一覧トップ・種別トップ等）はnull。
 */
export function parseNewsLink(raw: string): NewsLink | null {
  const value = raw.trim();
  const absoluteMatch = value.match(/^https?:\/\/([^/]+)(\/.*)$/i);

  let origin: string;
  let path: string;
  if (absoluteMatch) {
    const host = absoluteMatch[1].toLowerCase();
    path = normalizeUrlPath(absoluteMatch[2]);
    if (host === "www.leagueoflegends.com" || host === "leagueoflegends.com") {
      origin = LEAGUE_ORIGIN;
    } else if (host === "lolesports.com" || host === "www.lolesports.com") {
      origin = ESPORTS_ORIGIN;
    } else {
      return null; // 対象外ホスト
    }
  } else if (value.startsWith("/")) {
    origin = LEAGUE_ORIGIN;
    path = normalizeUrlPath(value);
  } else {
    return null;
  }

  const segments = path.split("/").filter(Boolean);
  const newsIdx = segments.indexOf("news");
  if (newsIdx === -1) return null;

  if (origin === ESPORTS_ORIGIN) {
    // lolesports.com: "/ja-jp/news/<slug>" 形式（種別セグメントが無い。一覧トップ等は除外）。
    if (segments.length < newsIdx + 2) return null;
    return { url: `${origin}${path}`, type: null, slug: segments.slice(newsIdx + 1).join("/") };
  }
  // leagueoflegends.com: "/ja-jp/news/<type>/<slug>" 形式（type/slugが揃わない一覧トップ・種別トップは除外）。
  if (segments.length < newsIdx + 3) return null;
  return {
    url: `${origin}${path}`,
    type: segments[newsIdx + 1],
    slug: segments.slice(newsIdx + 2).join("/"),
  };
}

/** slugが「パッチノート」記事とみなせるか（`patch`と`notes`の両方を含む）。既存Data Dragonアダプタと重複回避。 */
function isPatchNotesSlug(slug: string): boolean {
  return slug.includes("patch") && slug.includes("notes");
}

/**
 * 解析済みニュースリンクをURLルールでカテゴリ分類する純関数（AI分類なし、リファクタリングS7b F-S7b-2）。
 * 分類できない（community・未知の種別・パッチノート重複回避）場合は null を返し、呼び出し側は
 * そのリンクをスキップする。
 */
export function classifyNewsLink(link: NewsLink): CategoryLabel | null {
  if (link.type === null) return "eスポーツ"; // lolesports.com由来は常にeスポーツ扱い（実データ確認）
  const lowerSlug = link.slug.toLowerCase();

  if (link.type === "esports") return "eスポーツ";
  if (link.type === "game-updates" && isPatchNotesSlug(lowerSlug)) return null;
  if (CHAMPION_SKIN_KEYWORDS.some((kw) => lowerSlug.includes(kw))) return "Riot公式";
  if (link.type === "dev") return "パッチ/メタ";
  if (link.type === "game-updates") return "パッチ/メタ";
  return null;
}

/** href文字列を直接分類する薄いラッパー（テスト・単発検証用の利便関数）。解析できなければnull。 */
export function classifyNewsUrl(raw: string): CategoryLabel | null {
  const link = parseNewsLink(raw);
  return link ? classifyNewsLink(link) : null;
}

/**
 * ニュース一覧ページのHTMLから記事リンク（解析済み `NewsLink`）を抽出する純関数。
 * 一覧トップ・種別トップ・対象外ホストは除外し、出現順でURL重複を除いて返す。
 */
export function extractNewsLinks(html: string): NewsLink[] {
  const hrefRe = /href=["']([^"']+)["']/gi;
  const seen = new Set<string>();
  const result: NewsLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null) {
    const link = parseNewsLink(match[1]);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    result.push(link);
  }
  return result;
}

/**
 * HTMLの `<meta property="og:title" content="...">` から記事タイトルを抽出する純関数
 * （`extractOgImageUrl` と同構造。`&amp;`等のエンティティは `decodeHtmlEntities` で復号）。
 * タグが無い/contentが空の場合は null。
 */
export function extractOgTitle(html: string): string | null {
  const match = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i);
  if (!match) return null;
  const contentMatch = match[0].match(/content=["']([^"']+)["']/i);
  if (!contentMatch) return null;
  const title = decodeHtmlEntities(contentMatch[1]).trim();
  return title.length > 0 ? title : null;
}

/**
 * `<h1>...</h1>` の見出しテキストを抽出する純関数（実データ確認: `lolesports.com` はog:titleを
 * 持たないため、そのフォールバックに使う）。内側のタグは除去しエンティティを復号する。
 * タグが無い/中身が空の場合は null。
 */
export function extractH1Text(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const withoutTags = match[1].replace(/<[^>]+>/g, " ");
  const text = decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export type RiotNewsAdapterOptions = {
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
  /** 最新何件まで取得するか。既定は env `RIOT_NEWS_MAX_ITEMS`（既定4）。 */
  maxItems?: number;
  /** 連続fetch間のディレイ(ms)。既定は env `RIOT_NEWS_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
  /** テスト・注入用UA。既定は説明的なブラウザ相当UA。 */
  userAgent?: string;
};

/**
 * Riot公式ニュース（`leagueoflegends.com/ja-jp/news/`＋`lolesports.com`）から live 収集するアダプタ
 * （リファクタリングS7b）。取得失敗（HTTPエラー・ネット断）はすべて例外を投げず空配列/該当記事スキップに
 * する。一覧取得→URLルール分類→対象記事の個別取得の順に直列で行い、記事取得間にディレイを挟む
 * （reddit/5chアダプタと同方針）。
 */
export class RiotNewsAdapter implements SourceAdapter {
  readonly sourceType = "riot-news" as const;
  private readonly now: () => Date;
  private readonly maxItems: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;

  constructor(options: RiotNewsAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxItems = options.maxItems ?? envIntLocal("RIOT_NEWS_MAX_ITEMS", DEFAULT_MAX_ITEMS);
    this.delayMs = options.delayMs ?? envIntLocal("RIOT_NEWS_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  private requestHeaders(): Record<string, string> {
    return { "User-Agent": this.userAgent, "Accept-Language": "ja,en;q=0.8" };
  }

  /** 1記事分を取得しRawCollectionItemを組み立てる。取得失敗・タイトル取得不可時は null（この1件をスキップ）。 */
  private async fetchArticleItem(
    url: string,
    category: CategoryLabel,
    externalId: string,
  ): Promise<RawCollectionItem | null> {
    const html = await fetchTextSafe(url, { headers: this.requestHeaders() }, { logLabel: "riot-news", context: url });
    if (!html) return null;

    // og:titleを優先し、無ければ<h1>見出しにフォールバックする(lolesports.comはog:titleを持たない実データ確認済み)。
    const title = extractOgTitle(html) ?? extractH1Text(html);
    if (!title) return null;

    const bodyText = stripHtmlToText(html);
    const content = bodyText.length > NEWS_BODY_MAX_LENGTH ? bodyText.slice(0, NEWS_BODY_MAX_LENGTH) : bodyText;
    const imageUrl = extractOgImageUrl(html);

    return {
      sourceUrl: url,
      title,
      content,
      fetchedAt: this.now(),
      imageUrl,
      // リファクタリングS2形式のPost永続化用外部ID(記事slug。ソース内で安定・一意)。
      externalId,
      category,
    };
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    const listHtml = await fetchTextSafe(
      NEWS_LIST_URL,
      { headers: this.requestHeaders() },
      { logLabel: "riot-news", context: NEWS_LIST_URL },
    );
    if (!listHtml) return [];

    const links = extractNewsLinks(listHtml);
    const seenSlugs = new Set<string>();
    const selected: { url: string; category: CategoryLabel; slug: string }[] = [];
    for (const link of links) {
      const category = classifyNewsLink(link);
      if (!category) continue; // community・未知の種別・パッチノート重複は対象外
      if (seenSlugs.has(link.slug)) continue; // 一覧内の重複排除(externalId基準)
      seenSlugs.add(link.slug);
      selected.push({ url: link.url, category, slug: link.slug });
      if (selected.length >= this.maxItems) break;
    }

    const items: RawCollectionItem[] = [];
    for (let i = 0; i < selected.length; i++) {
      if (i > 0) await this.sleep(this.delayMs);
      const item = await this.fetchArticleItem(selected[i].url, selected[i].category, selected[i].slug);
      if (item) items.push(item);
    }
    console.log(
      `[riot-news] listed=${links.length} classified/selected=${selected.length} collected=${items.length}`,
    );
    return items;
  }
}
