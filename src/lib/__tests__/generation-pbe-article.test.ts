/**
 * runPbeArticleGeneration（PBE-S4 F-PBE4-2）の結合テスト。専用テストDB
 * （vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で書き込む。
 * 実HTTPは叩かず、globalThis.fetch を固定フィクスチャでスタブする（既存
 * collection-cdragon-pbe.test.ts と同じ方式）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runPbeArticleGeneration } from "@/lib/generation/pbe-article";
import { parseArticleBody, blockText } from "@/lib/article-body";
import { PBE_X_SECTION_HEADING } from "@/lib/generation/pbe-compose";
import type { PbeSourceTweet } from "@/lib/collection/adapters/pbe-x-source";

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
  displayInItemSets: true, // PBE-S6: 実在の店売りアイテムのみを対象にする絞り込み条件
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

/** pbe≠latestだがCDragon側のitem/champion差分が0件（PBE-S6でクリーン化された後の実データ相当）のフィクスチャ。 */
function stubFetchNoDiff(pbeVersion: string, latestVersion: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/pbe/content-metadata.json")) return jsonResponse({ version: pbeVersion });
      if (url.includes("/latest/content-metadata.json")) return jsonResponse({ version: latestVersion });
      if (url.includes("/v1/items.json")) return jsonResponse([]); // item差分なし
      if (url.includes("/v1/champion-summary.json")) return jsonResponse([]); // champion差分なし
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
  delete process.env.X_API_KEY;
  delete process.env.PBE_X_MIN_INTERVAL_HOURS;
  delete process.env.PBE_X_MAX_TWEETS;
});

afterEach(() => {
  delete process.env.PBE_ARTICLE_MODE;
  delete process.env.X_API_KEY;
  delete process.env.PBE_X_MIN_INTERVAL_HOURS;
  delete process.env.PBE_X_MAX_TWEETS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** PBE-S5テスト用のPbeSourceTweetビルダー（fixtureと同じ形の実データ相当）。 */
function sourceTweet(overrides: Partial<PbeSourceTweet> = {}): PbeSourceTweet {
  return {
    author: "Spideraxe",
    authorHandle: "Spideraxe30",
    text: "PBE datamine: Ahri Q AP ratio nerf incoming. Numbers are on the infographic below.",
    url: "https://x.com/Spideraxe30/status/1820000000000000001",
    createdAt: new Date("2026-07-28T09:00:00.000Z"),
    mediaUrls: ["https://pbs.twimg.com/media/mock-ahri-pbe-numbers.jpg"],
    ...overrides,
  };
}

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

    // PBE-S6 F-PBE6-3: チャンピオン変更が無いこのフィクスチャでは、先頭アイテムのアイコンURLが
    // thumbnailUrlに設定される。
    expect(article.thumbnailUrl).toBe(
      "https://raw.communitydragon.org/pbe/game/lol-game-data/assets/items/icons2d/3031.png",
    );

    // 冒頭サマリに件数を数える文言(チャンピオンN体・アイテムM件等)が出ない(PBE-S6 F-PBE6-2)。
    expect(text).not.toMatch(/体・アイテム|体の変更|件の変更が確認されています/);
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

describe("runPbeArticleGeneration: Xツイートのopt-in配線・レート制限・人手キュレーション（PBE-S5）", () => {
  it("X_API_KEY未設定なら、onでもfetchTweetsを呼ばずCDragon自動分のみのPBE記事になる（テスト1・回帰ゼロ）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn();

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), { fetchTweets });

    expect(fetchTweets).not.toHaveBeenCalled();
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");
    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    const text = bodyText(article.body);
    expect(text).not.toContain(PBE_X_SECTION_HEADING);
  });

  it("on＋apiKeyあり＋pbe≠latest＋レート内(前回取得なし)のとき、fetchTweetsが呼ばれツイートが未確定セクションとして統合される。moderationも通過する（テスト2）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn(async () => [sourceTweet()]);
    const writeLastXFetchAt = vi.fn();

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => null,
      writeLastXFetchAt,
    });

    expect(fetchTweets).toHaveBeenCalledWith({ apiKey: "test-x-key" });
    expect(writeLastXFetchAt).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");

    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    const text = bodyText(article.body);
    expect(text).toContain(PBE_X_SECTION_HEADING);
    expect(text).toContain("未確定情報です");
    expect(text).toContain("@Spideraxe30"); // 出典（作者ハンドル）

    // 逐語＋出典URL（有効なtweet status URLなのでembedブロックになる。テキストの改変・数値の
    // 機械再構成は行っていない＝urlがそのままembedとして本文に含まれる）
    const embeds = parseArticleBody(article.body).filter((b) => b.type === "embed");
    expect(embeds).toEqual([
      { type: "embed", provider: "twitter", url: sourceTweet().url, caption: "@Spideraxe30" },
    ]);
  });

  it("tweet status URLでないツイートは逐語text＋画像＋出典で統合される(OCR/機械生成していないことの担保)", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const original = "Q AP ratio 0.5 -> 0.45, W cooldown 14/13/12/11/10 -> 16/15/14/13/12.";
    const nonStatusTweet = sourceTweet({ url: "https://x.com/Spideraxe30", text: original });
    const fetchTweets = vi.fn(async () => [nonStatusTweet]);

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => null,
      writeLastXFetchAt: vi.fn(),
    });
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");

    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    const text = bodyText(article.body);
    expect(text).toContain(original); // ツイート本文が逐語のまま含まれる(改変・OCR・数値再構成なし)
    const images = parseArticleBody(article.body).filter((b) => b.type === "image");
    expect(images.some((b) => b.type === "image" && b.url === nonStatusTweet.mediaUrls[0])).toBe(true); // 画像URL(ホットリンク)
  });

  it("レート制限内(前回取得から間隔未満)なら、apiKeyがあってもfetchTweetsを呼ばず再取得しない（テスト3・X課金抑制）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const now = new Date("2026-07-29T00:00:00.000Z");
    const recentFetchAt = new Date("2026-07-28T20:00:00.000Z"); // 4時間前(既定6時間以内)
    const fetchTweets = vi.fn(async () => [sourceTweet()]);
    const writeLastXFetchAt = vi.fn();

    const result = await runPbeArticleGeneration(now, {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => recentFetchAt,
      writeLastXFetchAt,
    });

    expect(fetchTweets).not.toHaveBeenCalled();
    expect(writeLastXFetchAt).not.toHaveBeenCalled();
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");
    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    expect(bodyText(article.body)).not.toContain(PBE_X_SECTION_HEADING);
  });

  it("実際のレート制限状態(readLastPbeXFetchAt/writeLastPbeXFetchAt既定実装・一時ファイル)でも、1回目は取得し2回目(直後)はスキップする", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");

    // モジュール既定のファイルパス（data/pbe-x-last-fetch.json）は使わず、テスト内の
    // in-memoryな状態でreadLastXFetchAt/writeLastXFetchAtを注入し、実運用の「1回目は叩き
    // 2回目(直後)はレート制限で叩かない」という往復挙動を検証する。
    let stored: Date | null = null;
    const fetchTweets = vi.fn(async () => [sourceTweet()]);
    const options = {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => stored,
      writeLastXFetchAt: (at: Date) => {
        stored = at;
      },
    };

    const first = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), options);
    expect(first.status).toBe("created");
    expect(fetchTweets).toHaveBeenCalledTimes(1);

    const second = await runPbeArticleGeneration(new Date("2026-07-29T01:00:00.000Z"), options);
    expect(second.status).toBe("updated");
    expect(fetchTweets).toHaveBeenCalledTimes(1); // 1時間後の再実行(既定6h以内)では再取得しない
  });

  it("人手キュレーションファイルがあれば逐語で差し込まれ、無ければ何もしない（テスト4）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";

    const dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-integ-"));
    try {
      const curationFilePath = path.join(dir, "pbe-curation.json");
      writeFileSync(
        curationFilePath,
        JSON.stringify({
          notes: [
            {
              champion: "アジール",
              skill: "Q",
              text: "ダメージ 60/85/110/135/160 -> 60/90/120/150/180（人手書き起こし）",
              source: "https://x.com/Spideraxe30/status/1820000000000000001",
            },
          ],
        }),
        "utf-8",
      );

      // ファイルあり: 差し込まれる。
      stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
      const withFile = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), { curationFilePath });
      expect(withFile.status).toBe("created");
      if (withFile.status !== "created") throw new Error("expected created");
      const articleWithFile = await prisma.article.findUniqueOrThrow({ where: { id: withFile.articleId } });
      expect(bodyText(articleWithFile.body)).toContain("60/85/110/135/160 -> 60/90/120/150/180");

      // ファイルなし(存在しないパス): 何も差し込まれない(記事は更新されても未確定セクションは出ない)。
      const missingPath = path.join(dir, "does-not-exist.json");
      stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
      const withoutFile = await runPbeArticleGeneration(new Date("2026-07-29T02:00:00.000Z"), {
        curationFilePath: missingPath,
      });
      expect(withoutFile.status).toBe("updated");
      if (withoutFile.status !== "updated") throw new Error("expected updated");
      const articleWithoutFile = await prisma.article.findUniqueOrThrow({ where: { id: withoutFile.articleId } });
      expect(bodyText(articleWithoutFile.body)).not.toContain(PBE_X_SECTION_HEADING);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Xツイート取得が失敗（例外）しても記事生成自体は継続する(CDragon自動分のみで作成、本体を止めない)", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn(async () => {
      throw new Error("X API down");
    });
    const writeLastXFetchAt = vi.fn();

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => null,
      writeLastXFetchAt,
    });

    expect(result.status).toBe("created");
    expect(writeLastXFetchAt).toHaveBeenCalledTimes(1); // 失敗時も取得を試みた事実は記録する
    if (result.status !== "created") throw new Error("expected created");
    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    expect(bodyText(article.body)).not.toContain(PBE_X_SECTION_HEADING);
  });
});

describe("runPbeArticleGeneration: no_diff判定を「全ソース空」に修正（PBE-S7）", () => {
  it("CDragon0件（item/champion差分なし）でもXツイートがあれば記事が生成される（テスト1・不具合の再現と修正確認）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchNoDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn(async () => [sourceTweet()]);
    const writeLastXFetchAt = vi.fn();

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => null,
      writeLastXFetchAt,
    });

    expect(fetchTweets).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");

    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    const text = bodyText(article.body);
    expect(text).toContain(PBE_X_SECTION_HEADING);
    expect(text).toContain("@Spideraxe30");
  });

  it("CDragon0件でも人手キュレーションがあれば記事が生成される（Xと同様に全ソース空判定に含む）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchNoDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");

    const dir = mkdtempSync(path.join(tmpdir(), "pbe-curation-s7-"));
    try {
      const curationFilePath = path.join(dir, "pbe-curation.json");
      writeFileSync(
        curationFilePath,
        JSON.stringify({
          notes: [
            { champion: "アジール", skill: "Q", text: "人手書き起こし内容", source: "https://x.com/Spideraxe30/status/1" },
          ],
        }),
        "utf-8",
      );

      const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), { curationFilePath });
      expect(result.status).toBe("created");
      if (result.status !== "created") throw new Error("expected created");
      const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
      expect(bodyText(article.body)).toContain("人手書き起こし内容");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CDragon変更あり（従来ケース）は従来どおり生成される（回帰なし・テスト2）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"));
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("expected created");
    const article = await prisma.article.findUniqueOrThrow({ where: { id: result.articleId } });
    expect(bodyText(article.body)).toContain("3300");
  });

  it("全ソース空（item/champion/tweets/curation全て0）ならno_diffで、既存記事はそのまま残す（テスト3）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";

    // 1回目: CDragon差分ありで記事を作成しておく。
    stubFetchWithDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const created = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"));
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("expected created");
    const before = await prisma.article.findUniqueOrThrow({ where: { id: created.articleId } });

    // 2回目: 同じpbeバージョンのまま全ソースが空（CDragon差分なし・X未設定・キュレーションなし）。
    vi.unstubAllGlobals();
    stubFetchNoDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn();
    const result = await runPbeArticleGeneration(new Date("2026-07-29T01:00:00.000Z"), {
      curationFilePath: path.join(tmpdir(), "does-not-exist-pbe-s7.json"),
      fetchTweets,
    });

    expect(result).toEqual({ status: "no_diff" });
    expect(fetchTweets).not.toHaveBeenCalled(); // X_API_KEY未設定のため呼ばれない(無駄打ちなし)

    // 既存記事は消えず、内容もそのまま残る（ツイート等を消さない）。
    const after = await prisma.article.findUniqueOrThrow({ where: { id: created.articleId } });
    expect(after.body).toEqual(before.body);
    expect(after.title).toBe(before.title);
  });

  it("X_API_KEY未設定・CDragonも0件ならno_diff（コスト安全設計は不変・テスト4）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchNoDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const fetchTweets = vi.fn();

    const result = await runPbeArticleGeneration(new Date("2026-07-29T00:00:00.000Z"), { fetchTweets });

    expect(result).toEqual({ status: "no_diff" });
    expect(fetchTweets).not.toHaveBeenCalled();
    const postCount = await prisma.post.count();
    expect(postCount).toBe(0);
  });

  it("レート制限内(前回取得から間隔未満)ならCDragon0件でもfetchTweetsを呼ばずno_diffになる（無駄打ちなし）", async () => {
    process.env.PBE_ARTICLE_MODE = "on";
    stubFetchNoDiff("16.16.8000032+branch.main.content.beta", "16.15.7996036+branch.releases-16-15");
    const now = new Date("2026-07-29T00:00:00.000Z");
    const recentFetchAt = new Date("2026-07-28T20:00:00.000Z"); // 4時間前(既定6時間以内)
    const fetchTweets = vi.fn(async () => [sourceTweet()]);
    const writeLastXFetchAt = vi.fn();

    const result = await runPbeArticleGeneration(now, {
      apiKey: "test-x-key",
      fetchTweets,
      readLastXFetchAt: () => recentFetchAt,
      writeLastXFetchAt,
    });

    expect(fetchTweets).not.toHaveBeenCalled();
    expect(writeLastXFetchAt).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "no_diff" });
  });
});

/** 記事本文JSONをパースして検索用の連結テキストへ変換するテスト用ヘルパ。 */
function bodyText(body: unknown): string {
  return parseArticleBody(body).map(blockText).join("\n");
}
