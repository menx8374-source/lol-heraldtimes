/**
 * 1ソース分の収集ロジック（DB非依存の純関数寄りの実装）。
 * F5の「取得件数上限・実行間隔・LoL関連フィルタ・出典URL必須・1ソース失敗が他を止めない」を
 * DBアクセス無しでテストできるよう、`lastRunAt` を引数で受け取り、アダプタの
 * `fetchItems()` が reject した場合は例外を投げずに failure 結果として返す。
 * DBへの永続化・レート制限判定用の `lastRunAt` 取得は呼び出し側（pipeline.ts）が担う。
 */
import { isRelevantItem } from "@/lib/collection/filter";
import { capItems, isRateLimited } from "@/lib/collection/rate-limit";
import type { CollectionItem, RawCollectionItem, SourceAdapter, SourceConfig, SourceType } from "@/lib/collection/types";

export type CollectSourceResult =
  | { sourceType: SourceType; status: "skipped-rate-limited"; fetchedCount: 0; items: [] }
  | { sourceType: SourceType; status: "success"; fetchedCount: number; items: CollectionItem[] }
  | { sourceType: SourceType; status: "failure"; fetchedCount: 0; items: []; errorMessage: string };

/** 出典URL(非空文字列)を持つ生アイテムだけを共通フォーマットへ変換する。URL欠落は捨てる(F5)。 */
export function toCollectionItems(sourceType: SourceType, raw: RawCollectionItem[]): CollectionItem[] {
  const items: CollectionItem[] = [];
  for (const r of raw) {
    const url = r.sourceUrl?.trim();
    if (!url) continue;
    items.push({
      sourceType,
      sourceUrl: url,
      title: r.title,
      content: r.content,
      fetchedAt: r.fetchedAt,
      // 未設定(undefined)のときはキー自体を残しても toEqual 等の比較上は無視されるため、
      // 素直に転記するだけでよい(既存の共通フォーマット比較テストへの影響を避ける)。
      imageUrl: r.imageUrl,
      // リファクタリングS2: Post永続化用メタも同様にそのまま転記する(未設定は無視される)。
      externalId: r.externalId,
      score: r.score,
      commentCount: r.commentCount,
      author: r.author,
      flair: r.flair,
      media: r.media,
      // リファクタリングS7: 取得元ルールで付与したカテゴリ(RiotNewsの種別分類等)を Post/Article まで
      // 伝えるため転記する。ここで漏らすと Post.category が null になりソース既定カテゴリに落ちる。
      category: r.category,
    });
  }
  return items;
}

/**
 * 1ソース分の収集を実行する。レート制限中はfetchせずスキップし、
 * アダプタが例外/rejectしても捕捉して failure 結果を返す(呼び出し側で他ソース収集を継続できる)。
 */
export async function collectFromSource(
  adapter: SourceAdapter,
  config: SourceConfig,
  now: Date,
  lastRunAt: Date | null,
): Promise<CollectSourceResult> {
  const sourceType = adapter.sourceType;

  if (isRateLimited(lastRunAt, now, config.rateLimit.minIntervalMsBetweenRuns)) {
    return { sourceType, status: "skipped-rate-limited", fetchedCount: 0, items: [] };
  }

  try {
    const raw = await adapter.fetchItems();
    const capped = capItems(raw, config.rateLimit.maxItemsPerRun);
    const withUrl = toCollectionItems(sourceType, capped);
    const relevant = withUrl.filter((item) => isRelevantItem(item, config.relevance));
    return { sourceType, status: "success", fetchedCount: raw.length, items: relevant };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { sourceType, status: "failure", fetchedCount: 0, items: [], errorMessage };
  }
}
