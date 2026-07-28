/**
 * Mockアダプタ（reddit/5ch/riot共通実装）。fixture JSON を読み込んで
 * RawCollectionItem[] として返すだけの決定論的アダプタ。
 * architecture.md の方針: 初期実装は fixture ベースの Mock、後日 live アダプタへ差し替え。
 */
import type { CategoryLabel } from "@/lib/categories";
import type { RawCollectionItem, SourceAdapter, SourceType } from "@/lib/collection/types";
import redditFixture from "@/lib/collection/fixtures/reddit.json";
import fivechFixture from "@/lib/collection/fixtures/5ch.json";
import riotFixture from "@/lib/collection/fixtures/riot.json";
import riotNewsFixture from "@/lib/collection/fixtures/riot-news.json";
import xFixture from "@/lib/collection/fixtures/x.json";

type FixtureRow = {
  sourceUrl?: string | null;
  title: string;
  content: string;
  fetchedAt: string;
  /** サムネイル画像URL（拡張E19）。fixtureに無ければ未設定のままでよい。 */
  imageUrl?: string | null;
  /** 取得元ルールで付与されたカテゴリ（リファクタリングS7b、riot-news/x fixtureで使用）。 */
  category?: CategoryLabel;
  /** Post永続化用の外部ID（成長G7、xのfixtureで使用。reddit/5ch/riot/riot-newsのfixtureは未設定のまま）。 */
  externalId?: string;
  /** メトリクス: スコア（成長G7、xのfixtureで使用。upvote数等。未設定なら0扱い）。 */
  score?: number;
  /** メトリクス: コメント数（成長G7、xのfixtureで使用。reply数等）。 */
  commentCount?: number;
  /** 投稿者（成長G7、xのfixtureで使用）。 */
  author?: string | null;
  /** 画像/動画等のメディア情報（成長G7、xのfixtureで使用）。 */
  media?: unknown;
};

function toRawItems(rows: FixtureRow[]): RawCollectionItem[] {
  return rows.map((row) => ({
    sourceUrl: row.sourceUrl,
    title: row.title,
    content: row.content,
    fetchedAt: new Date(row.fetchedAt),
    imageUrl: row.imageUrl,
    category: row.category,
    externalId: row.externalId,
    score: row.score,
    commentCount: row.commentCount,
    author: row.author,
    media: row.media,
  }));
}

const FIXTURES: Record<SourceType, FixtureRow[]> = {
  reddit: redditFixture,
  "5ch": fivechFixture,
  riot: riotFixture,
  "riot-news": riotNewsFixture as FixtureRow[],
  x: xFixture as FixtureRow[],
};

/** fixture JSON を読むだけの Mock アダプタ。 */
export class MockSourceAdapter implements SourceAdapter {
  constructor(public readonly sourceType: SourceType) {}

  async fetchItems(): Promise<RawCollectionItem[]> {
    return toRawItems(FIXTURES[this.sourceType]);
  }
}
