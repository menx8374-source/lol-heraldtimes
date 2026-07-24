import { describe, expect, it } from "vitest";
import {
  buildCandidateQueue,
  clusterBySimilarTopic,
  dedupeByNormalizedUrl,
  excludeArticledUrls,
} from "@/lib/collection/dedupe";

type Item = { id: string; normalizedUrl: string; title: string; content: string; fetchedAt: Date };

function item(id: string, normalizedUrl: string, title: string, content: string, fetchedAt: string): Item {
  return { id, normalizedUrl, title, content, fetchedAt: new Date(fetchedAt) };
}

describe("dedupeByNormalizedUrl", () => {
  it("同一URL(正規化後)の収集アイテムを2回取り込んでも1件にまとめる", () => {
    const items = [
      item("1", "https://example.com/a", "タイトル", "本文", "2026-07-24T10:00:00Z"),
      item("2", "https://example.com/a", "タイトル(更新)", "本文(更新)", "2026-07-24T11:00:00Z"),
      item("3", "https://example.com/b", "別記事", "別本文", "2026-07-24T10:00:00Z"),
    ];
    const result = dedupeByNormalizedUrl(items);
    expect(result).toHaveLength(2);
    // 同一URLは最新(fetchedAtが新しい)方を採用する
    expect(result.find((r) => r.normalizedUrl === "https://example.com/a")?.id).toBe("2");
  });
});

describe("excludeArticledUrls", () => {
  it("既存記事の出典URL(正規化後)と一致するアイテムを除外する", () => {
    const items = [
      item("1", "https://example.com/articled", "既に記事化済み", "本文", "2026-07-24T10:00:00Z"),
      item("2", "https://example.com/new", "未記事化", "本文", "2026-07-24T10:00:00Z"),
    ];
    const result = excludeArticledUrls(items, new Set(["https://example.com/articled"]));
    expect(result.map((r) => r.id)).toEqual(["2"]);
  });
});

describe("clusterBySimilarTopic", () => {
  it("タイトル・本文が高い類似度を持つ別URLのアイテムを同一話題としてクラスタリングする", () => {
    const items = [
      item(
        "1",
        "https://reddit.com/a",
        "Patch 14.6 Jungle Nerf Discussion Thread",
        "Riot pushed a big jungle XP nerf in patch 14.6. Community reactions are mixed.",
        "2026-07-24T10:00:00Z",
      ),
      item(
        "2",
        "https://reddit.com/b",
        "Patch 14.6 Jungle Nerf Megathread",
        "Riot pushed a big jungle XP nerf in patch 14.6, community reactions are mixed as well.",
        "2026-07-24T18:00:00Z",
      ),
      item("3", "https://reddit.com/c", "Yasuo OTP pulls off an insane outplay", "Amazing wall-jump combo clip.", "2026-07-24T14:00:00Z"),
    ];
    const clusters = clusterBySimilarTopic(items);
    expect(clusters).toHaveLength(2);
    // 代表は取得日時が最も早いアイテム
    const jungleCluster = clusters.find((c) => c.canonical.id === "1");
    expect(jungleCluster?.duplicates.map((d) => d.id)).toEqual(["2"]);
  });
});

describe("buildCandidateQueue", () => {
  it("重複を含む入力セットから、記事化候補キューには一意な話題だけが残る", () => {
    const items = [
      // 同一URLの二重取込み
      item("1", "https://reddit.com/a", "Patch 14.6 Jungle Nerf Discussion Thread", "Jungle XP nerf.", "2026-07-24T10:00:00Z"),
      item("1b", "https://reddit.com/a", "Patch 14.6 Jungle Nerf Discussion Thread", "Jungle XP nerf.", "2026-07-24T10:05:00Z"),
      // 別URLだが同一話題(高類似度)
      item("2", "https://reddit.com/b", "Patch 14.6 Jungle Nerf Megathread", "Jungle XP nerf, mains worried.", "2026-07-24T18:00:00Z"),
      // 無関係な別話題
      item("3", "https://reddit.com/c", "Yasuo OTP pulls off an insane outplay", "Amazing wall-jump combo clip.", "2026-07-24T14:00:00Z"),
      // 既に記事化済みの出典URLと一致
      item("4", "https://official.com/already-articled", "既存記事の元ネタ", "既存記事の本文", "2026-07-24T09:00:00Z"),
    ];
    const articledNormalizedUrls = new Set(["https://official.com/already-articled"]);

    const { queued, duplicates, alreadyArticled } = buildCandidateQueue(items, articledNormalizedUrls);

    // 同一URL(id="1"/"1b")は最新(fetchedAtが新しい)の "1b" が採用される
    expect(queued.map((q) => q.id).sort()).toEqual(["1b", "3"]);
    expect(duplicates.map((d) => d.id)).toEqual(["2"]);
    expect(alreadyArticled.map((a) => a.id)).toEqual(["4"]);
  });

  it("既に記事化済みのソースは再度候補にならない", () => {
    const items = [item("1", "https://official.com/x", "記事化済み話題", "本文", "2026-07-24T10:00:00Z")];
    const { queued, alreadyArticled } = buildCandidateQueue(items, new Set(["https://official.com/x"]));
    expect(queued).toHaveLength(0);
    expect(alreadyArticled.map((a) => a.id)).toEqual(["1"]);
  });
});
