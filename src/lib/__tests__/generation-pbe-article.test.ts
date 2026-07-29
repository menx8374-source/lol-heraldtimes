/**
 * runPbeArticleGeneration（PBE-S4 F-PBE4-2）の結合テスト。専用テストDB
 * （vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で書き込む。
 * 実HTTPは叩かず、globalThis.fetch を固定フィクスチャでスタブする（既存
 * collection-cdragon-pbe.test.ts と同じ方式）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runPbeArticleGeneration } from "@/lib/generation/pbe-article";
import { parseArticleBody, blockText } from "@/lib/article-body";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PBE_ITEM = {
  id: 3031,
  name: "インフィニティエッジ",
  description: "<stats>攻撃力 +70</stats>クリティカル時のダメージが増加する。",
  priceTotal: 3300,
  from: [1038, 1037],
  to: [],
  inStore: true,
  iconPath: "/lol-game-data/assets/items/icons2d/3031.png",
};

const LATEST_ITEM = { ...PBE_ITEM, priceTotal: 3400 }; // 合計コストのみ変更

/** items/champion-summaryを含む標準フィクスチャでfetchをスタブする（差分1件のitemのみ・champion空）。 */
function stubFetchWithDiff(pbeVersion: string, latestVersion: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/pbe/content-metadata.json")) return jsonResponse({ version: pbeVersion });
      if (url.includes("/latest/content-metadata.json")) return jsonResponse({ version: latestVersion });
      if (url.includes("/pbe/") && url.includes("/v1/items.json") && url.includes("/ja_jp/")) {
        return jsonResponse([{ ...PBE_ITEM, name: "インフィニティエッジ(JA)" }]);
      }
      if (url.includes("/pbe/") && url.includes("/v1/items.json")) return jsonResponse([PBE_ITEM]);
      if (url.includes("/latest/") && url.includes("/v1/items.json")) return jsonResponse([LATEST_ITEM]);
      if (url.includes("/v1/champion-summary.json")) return jsonResponse([]); // championは対象外(空)にして負荷を避ける
      throw new Error(`unexpected url in test: ${url}`);
    }),
  );
}

/** バージョン取得のみのスタブ（items/champion-summaryへは到達しないはずのテスト用）。 */
function stubFetchVersionsOnly(pbeVersion: string | null, latestVersion: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/pbe/content-metadata.json")) {
        return pbeVersion ? jsonResponse({ version: pbeVersion }) : jsonResponse({}, 500);
      }
      if (url.includes("/latest/content-metadata.json")) {
        return latestVersion ? jsonResponse({ version: latestVersion }) : jsonResponse({}, 500);
      }
      throw new Error(`unexpected url in test (items/champion-summaryへは到達しないはず): ${url}`);
    }),
  );
}

beforeEach(async () => {
  await resetDb();
  delete process.env.PBE_ARTICLE_MODE;
});

afterEach(() => {
  delete process.env.PBE_ARTICLE_MODE;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runPbeArticleGeneration（PBE-S4 F-PBE4-2）", () => {
  it("PBE_ARTICLE_MODE未設定(既定off)では即座にdisabledで返り、fetch・DBに一切アクセスしない（テスト1・回帰ゼロ）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"));
    expect(result).toEqual({ status: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const postCount = await prisma.post.count();
    expect(postCount).toBe(0);
  });

  it("PBE_ARTICLE_MODE=off明示でも同様にdisabled（fetchなし）", async () => {
    process.env.PBE_ARTICLE_MODE = "off";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runPbeArticleGeneration();
    expect(result).toEqual({ status: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on かつ pbe==latest(差分なし)のときは即returnし、items/champion-summaryへは一切fetchしない（テスト3）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("content-metadata.json")) return jsonResponse({ version: "16.15.0" });
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runPbeArticleGeneration();
    expect(result).toEqual({ status: "no_diff" });
    // content-metadata(pbe/latest)の2回だけで、items/champion-summary等は一切呼ばれない。
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const postCount = await prisma.post.count();
    expect(postCount).toBe(0);
  });

  it("on かつバージョン取得失敗のときは何もしない(記事を作らない・例外なし、テスト3)", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchVersionsOnly(null, "16.15.0"); // pbe側が500失敗

    const result = await runPbeArticleGeneration();
    expect(result).toEqual({ status: "fetch_failed" });

    const postCount = await prisma.post.count();
    expect(postCount).toBe(0);
  });

  it("on かつ pbe≠latest で差分ありのとき、未確定バッジ・出典付きのPBE記事を新規作成する（テスト2）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");

    const now = new Date("2026-07-29T00:00:00.000Z");
    const result = await runPbeArticleGeneration(now);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");
    expect(result.pbeVersion).toBe("16.16");

    const post = await prisma.post.findUnique({
      where: { sourceType_externalId: { sourceType: "riot", externalId: "pbe-16.16" } },
    });
    expect(post).not.toBeNull();
    expect(post!.monitoring).toBe(false); // hotness判定を経ない速報のため監視対象外

    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    expect(article.slug).toBe("pbe-16.16");
    expect(article.status).toBe("published");
    expect(article.title).toContain("【PBE先行】");
    expect(article.title).toContain("16.16");

    const body = parseArticleBody(article.body);
    const text = body.map(blockText).join("\n");
    expect(text).toContain("【PBE・未確定】");
    expect(text).toContain("データ: CommunityDragon / Riot Games");
    expect(text).toContain("スキルのダメージ・レシオ等の詳細");
    // itemのdiff内容(合計コスト 3400⇒3300)がそのまま出典逐語で載る
    expect(text).toContain("3400");
    expect(text).toContain("3300");

    const sources = await prisma.articleSource.findMany({ where: { articleId: article.id } });
    expect(sources.length).toBeGreaterThan(0);
  });

  it("一意化: 同一pbeバージョンで再実行しても記事が重複せず、同一Article/Postをin-place上書き更新する（テスト4）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");

    const first = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"));
    expect(first.status).toBe("created");

    // 同じフィクスチャで再実行(2回目)。
    const second = await runPbeArticleGeneration(new Date("2026-07-29T01:00:00.000Z"));
    expect(second.status).toBe("updated");
    if (first.status !== "created" || second.status !== "updated") throw new Error("unexpected status");
    expect(second.articleId).toBe(first.articleId); // 同一記事をin-place更新(重複なし)
    expect(second.postId).toBe(first.postId);

    const postCount = await prisma.post.count({ where: { sourceType: "riot", externalId: "pbe-16.16" } });
    expect(postCount).toBe(1);
    const articleCount = await prisma.article.count({ where: { slug: "pbe-16.16" } });
    expect(articleCount).toBe(1);
  });
});
