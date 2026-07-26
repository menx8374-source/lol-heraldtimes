/**
 * Mockアダプタ（reddit/5ch/riot共通実装）。fixture JSON を読み込んで
 * RawCollectionItem[] として返すだけの決定論的アダプタ。
 * architecture.md の方針: 初期実装は fixture ベースの Mock、後日 live アダプタへ差し替え。
 */
import type { RawCollectionItem, SourceAdapter, SourceType } from "@/lib/collection/types";
import redditFixture from "@/lib/collection/fixtures/reddit.json";
import fivechFixture from "@/lib/collection/fixtures/5ch.json";
import riotFixture from "@/lib/collection/fixtures/riot.json";

type FixtureRow = {
  sourceUrl?: string | null;
  title: string;
  content: string;
  fetchedAt: string;
  /** サムネイル画像URL（拡張E19）。fixtureに無ければ未設定のままでよい。 */
  imageUrl?: string | null;
};

function toRawItems(rows: FixtureRow[]): RawCollectionItem[] {
  return rows.map((row) => ({
    sourceUrl: row.sourceUrl,
    title: row.title,
    content: row.content,
    fetchedAt: new Date(row.fetchedAt),
    imageUrl: row.imageUrl,
  }));
}

const FIXTURES: Record<SourceType, FixtureRow[]> = {
  reddit: redditFixture,
  "5ch": fivechFixture,
  riot: riotFixture,
};

/** fixture JSON を読むだけの Mock アダプタ。 */
export class MockSourceAdapter implements SourceAdapter {
  constructor(public readonly sourceType: SourceType) {}

  async fetchItems(): Promise<RawCollectionItem[]> {
    return toRawItems(FIXTURES[this.sourceType]);
  }
}
