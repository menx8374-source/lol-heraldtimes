/**
 * LoL関連への限定フィルタ（F5）。サブレディット指定・タイトルキーワードで
 * 無関係アイテム（別ゲーム・無関係スレッド）の混入を防ぐ純関数。
 */
import type { RelevanceFilterConfig, SourceType } from "@/lib/collection/types";

/** reddit の `sourceUrl` からサブレディット名を取り出す（見つからなければ null）。 */
export function extractSubreddit(sourceUrl: string): string | null {
  try {
    const u = new URL(sourceUrl);
    const match = u.pathname.match(/\/r\/([^/]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 指定URLが許可サブレディット一覧のいずれかに属するか。 */
export function isFromAllowedSubreddit(sourceUrl: string, allowedSubreddits: string[]): boolean {
  const subreddit = extractSubreddit(sourceUrl);
  if (!subreddit) return false;
  return allowedSubreddits.some((s) => s.replace(/^r\//i, "").toLowerCase() === subreddit);
}

/** タイトルにキーワードのいずれかが（大小文字無視で）含まれるか。 */
export function matchesKeyword(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((k) => k.length > 0 && lower.includes(k.toLowerCase()));
}

/**
 * 収集アイテムがLoL関連として記事化候補になり得るかを判定する（F5）。
 * reddit はサブレディット許可リストを優先適用し、それ以外（5ch/riot含め全ソース）は
 * タイトルキーワード一致で判定する（サブレディット外・キーワード不一致のいずれかで除外）。
 * ※サブレディットフィルタは reddit 固有の概念のため sourceType で明示的に限定する。
 * リファクタリングS7b: `riot-news`（Riot公式ニュース）は出典自体が公式ニュースドメインで
 * URLルール分類済み（RiotNewsAdapter）のため、キーワード一致判定はバイパスし常に関連ありとする
 * （og:titleが日本語の商品的な見出しでDEFAULT_LOL_KEYWORDSに一致しないケースを誤って除外しないため）。
 */
export function isRelevantItem(
  item: { sourceType: SourceType; sourceUrl: string; title: string },
  config: RelevanceFilterConfig,
): boolean {
  if (item.sourceType === "riot-news") return true;
  if (item.sourceType === "reddit" && config.allowedSubreddits && config.allowedSubreddits.length > 0) {
    if (!isFromAllowedSubreddit(item.sourceUrl, config.allowedSubreddits)) return false;
  }
  return matchesKeyword(item.title, config.keywords);
}
