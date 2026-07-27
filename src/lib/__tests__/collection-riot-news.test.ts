/**
 * RiotNewsAdapter（リファクタリングS7b F-S7b-2）の単体テスト（ブリーフ テスト1・2）。
 * 実ネットワーク非依存（`vi.stubGlobal("fetch", ...)` でHTML/HTTPエラー/ネット断を注入）。
 * `lolesports.com`（eスポーツ記事の実際の配信元。og:titleを持たず<h1>フォールバックが必要）関連の
 * 挙動は実データ確認済み。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RiotNewsAdapter,
  classifyNewsLink,
  classifyNewsUrl,
  extractH1Text,
  extractNewsLinks,
  extractOgTitle,
  parseNewsLink,
} from "@/lib/collection/adapters/riot-news";

const ORIGIN = "https://www.leagueoflegends.com";
const ESPORTS_ORIGIN = "https://lolesports.com";
const NEWS_LIST_URL = `${ORIGIN}/ja-jp/news/`;

function textResponse(body: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

describe("parseNewsLink / classifyNewsLink / classifyNewsUrl（純関数、ブリーフ テスト1）", () => {
  it("type/slugが揃わないパス(一覧トップ・種別トップ)はnull", () => {
    expect(parseNewsLink("/ja-jp/news")).toBeNull();
    expect(parseNewsLink("/ja-jp/news/dev")).toBeNull();
    expect(parseNewsLink("/ja-jp/other/dev/slug")).toBeNull();
  });

  it("leagueoflegends.comのtype/slugが揃えば取り出せる", () => {
    expect(parseNewsLink("/ja-jp/news/dev/dev-blog-jungle")).toEqual({
      url: `${ORIGIN}/ja-jp/news/dev/dev-blog-jungle`,
      type: "dev",
      slug: "dev-blog-jungle",
    });
  });

  it("esports(leagueoflegends.com) → eスポーツ", () => {
    expect(classifyNewsUrl("/ja-jp/news/esports/worlds-2026-groups-announced")).toBe("eスポーツ");
  });

  it("slugにチャンピオン/スキン系キーワード(champion/skin/reveal/cinematic)を含む → Riot公式", () => {
    expect(classifyNewsUrl("/ja-jp/news/game-updates/new-champion-reveal-frost")).toBe("Riot公式");
    expect(classifyNewsUrl("/ja-jp/news/game-updates/new-skin-line-arrives")).toBe("Riot公式");
    expect(classifyNewsUrl("/ja-jp/news/dev/champion-design-cinematic-preview")).toBe("Riot公式");
  });

  it("dev → パッチ/メタ", () => {
    expect(classifyNewsUrl("/ja-jp/news/dev/dev-blog-jungle-changes")).toBe("パッチ/メタ");
  });

  it("game-updates(非パッチノート) → パッチ/メタ", () => {
    expect(classifyNewsUrl("/ja-jp/news/game-updates/some-balance-update")).toBe("パッチ/メタ");
  });

  it("game-updatesでもパッチノートのslug(patch...notes)は除外(null、Data Dragonアダプタと重複回避)", () => {
    expect(classifyNewsUrl("/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes")).toBeNull();
  });

  it("community・未知の種別は対象外(null)", () => {
    expect(classifyNewsUrl("/ja-jp/news/community/cosplay-contest-2026")).toBeNull();
    expect(classifyNewsUrl("/ja-jp/news/unknown-type/some-slug")).toBeNull();
  });

  it("news配下でないパスはnull", () => {
    expect(classifyNewsUrl("/ja-jp/esports/worlds-2026")).toBeNull();
  });

  it("lolesports.com（実データ確認: 種別セグメントを持たない別ドメイン）は常にeスポーツ", () => {
    const link = parseNewsLink(`${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`);
    expect(link).toEqual({
      url: `${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`,
      type: null,
      slug: "lcp-2026-split-3-virtual-co-streamers",
    });
    expect(classifyNewsLink(link!)).toBe("eスポーツ");
    expect(classifyNewsUrl(`${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`)).toBe("eスポーツ");
  });

  it("lolesports.comの一覧トップ(slugが無い)はnull", () => {
    expect(parseNewsLink(`${ESPORTS_ORIGIN}/ja-jp/news/`)).toBeNull();
  });

  it("対象外ホスト(他ドメイン)はnull", () => {
    expect(parseNewsLink("https://example.com/ja-jp/news/dev/some-slug")).toBeNull();
  });
});

describe("extractOgTitle", () => {
  it("og:titleタグからcontentを取り出す(&amp;等のエンティティを復号する)", () => {
    const html = '<meta property="og:title" content="新チャンピオン &amp; 新スキン登場">';
    expect(extractOgTitle(html)).toBe("新チャンピオン & 新スキン登場");
  });

  it("属性の順序が違って(content先・property後)も取り出せる", () => {
    const html = '<meta content="タイトル" property="og:title">';
    expect(extractOgTitle(html)).toBe("タイトル");
  });

  it("シングルクォート属性でも取り出せる", () => {
    const html = "<meta property='og:title' content='タイトル'>";
    expect(extractOgTitle(html)).toBe("タイトル");
  });

  it("og:titleタグが無ければnullを返す", () => {
    expect(extractOgTitle('<meta property="og:image" content="https://example.com/x.jpg">')).toBeNull();
  });

  it("contentが空ならnullを返す", () => {
    expect(extractOgTitle('<meta property="og:title" content="">')).toBeNull();
  });
});

describe("extractH1Text（og:titleが無いページ=lolesports.com向けフォールバック、実データ確認）", () => {
  it("h1タグの内側テキストを取り出す(タグ除去・エンティティ復号)", () => {
    expect(extractH1Text("<h1>LCP 2026 Split 3 の発表&amp;告知</h1>")).toBe("LCP 2026 Split 3 の発表&告知");
  });

  it("内側に入れ子タグがあってもタグ除去され単語がくっつかない(タグ境界をスペースに)", () => {
    expect(extractH1Text("<h1>見出し<span>強調</span>続き</h1>")).toBe("見出し 強調 続き");
  });

  it("h1タグが無ければnullを返す", () => {
    expect(extractH1Text("<div>見出し無し</div>")).toBeNull();
  });
});

describe("extractNewsLinks", () => {
  it("news配下の記事リンクのみを出現順・重複なしで抽出する(一覧トップ・種別トップは除外)", () => {
    const html = `
      <nav><a href="/ja-jp/news/">ニュース</a><a href="/ja-jp/news/dev/">Dev</a></nav>
      <a href="https://www.leagueoflegends.com/ja-jp/news/dev/dev-blog-jungle-changes">Dev Blog</a>
      <a href="/ja-jp/news/esports/worlds-2026-groups-announced">Worlds</a>
      <a href="/ja-jp/news/dev/dev-blog-jungle-changes">duplicate</a>
      <a href="https://lolesports.com/ja-jp/news/lcp-2026-split-3-virtual-co-streamers">esports news</a>
      <a href="/ja-jp/other-page">other</a>
    `;
    expect(extractNewsLinks(html)).toEqual([
      { url: `${ORIGIN}/ja-jp/news/dev/dev-blog-jungle-changes`, type: "dev", slug: "dev-blog-jungle-changes" },
      {
        url: `${ORIGIN}/ja-jp/news/esports/worlds-2026-groups-announced`,
        type: "esports",
        slug: "worlds-2026-groups-announced",
      },
      {
        url: `${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`,
        type: null,
        slug: "lcp-2026-split-3-virtual-co-streamers",
      },
    ]);
  });

  it("末尾スラッシュ・クエリ・ハッシュは正規化される(同一記事は1件に集約)", () => {
    const html = `
      <a href="/ja-jp/news/dev/dev-blog-jungle-changes/">a</a>
      <a href="/ja-jp/news/dev/dev-blog-jungle-changes?utm_source=x">b</a>
      <a href="/ja-jp/news/dev/dev-blog-jungle-changes#section">c</a>
    `;
    expect(extractNewsLinks(html)).toEqual([
      { url: `${ORIGIN}/ja-jp/news/dev/dev-blog-jungle-changes`, type: "dev", slug: "dev-blog-jungle-changes" },
    ]);
  });
});

describe("RiotNewsAdapter.fetchItems（ブリーフ テスト2）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LIST_HTML = `
    <html><body>
      <nav><a href="/ja-jp/news/">ニュース</a><a href="/ja-jp/news/dev/">Dev</a></nav>
      <a href="https://www.leagueoflegends.com/ja-jp/news/dev/dev-blog-jungle-changes">Dev Blog</a>
      <a href="https://lolesports.com/ja-jp/news/lcp-2026-split-3-virtual-co-streamers">Esports</a>
      <a href="/ja-jp/news/game-updates/new-champion-reveal-frost">新チャンピオン</a>
      <a href="/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes">Patch Notes</a>
      <a href="/ja-jp/news/game-updates/some-balance-update">Balance</a>
      <a href="/ja-jp/news/community/cosplay-contest-2026">Cosplay</a>
    </body></html>
  `;

  function articleHtml(title: string, imageUrl?: string): string {
    const paragraph = "本記事の本文テキストです。".repeat(20);
    return (
      `<html><head><meta property="og:title" content="${title}">` +
      (imageUrl ? `<meta property="og:image" content="${imageUrl}">` : "") +
      `</head><body><p>${paragraph}</p></body></html>`
    );
  }

  /** lolesports.com相当(og:titleを持たない・<h1>のみ)のfixture(実データ確認済みの構造を再現)。 */
  function esportsArticleHtml(h1Title: string): string {
    const paragraph = "大会に関する本文テキストです。".repeat(20);
    return `<html><head><title>LoL Esports | </title></head><body><h1>${h1Title}</h1><p>${paragraph}</p></body></html>`;
  }

  function buildFetchMock(overrides: Record<string, () => Promise<Response>> = {}) {
    const articles: Record<string, string> = {
      [`${ORIGIN}/ja-jp/news/dev/dev-blog-jungle-changes`]: articleHtml("Dev Blog: ジャングル変更"),
      [`${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`]: esportsArticleHtml(
        "LCP 2026 Split 3のバーチャルミラー配信者",
      ),
      [`${ORIGIN}/ja-jp/news/game-updates/new-champion-reveal-frost`]: articleHtml("新チャンピオン『氷雪』登場"),
      [`${ORIGIN}/ja-jp/news/game-updates/some-balance-update`]: articleHtml("バランス調整のお知らせ"),
    };
    return vi.fn(async (url: string) => {
      if (overrides[url]) return overrides[url]();
      if (url === NEWS_LIST_URL) return textResponse(LIST_HTML);
      if (articles[url]) return textResponse(articles[url]);
      throw new Error(`unexpected url: ${url}`);
    });
  }

  it("一覧取得→URLルール分類→個別取得の順でRawCollectionItemを組み立てる(パッチノート/community除外・最大4件・lolesports.comはh1タイトルにフォールバック)", async () => {
    vi.stubGlobal("fetch", buildFetchMock());
    const adapter = new RiotNewsAdapter({ sleep: vi.fn(async () => {}), now: () => new Date("2026-07-27T00:00:00Z") });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(4);
    expect(items.map((i) => i.externalId)).toEqual([
      "dev-blog-jungle-changes",
      "lcp-2026-split-3-virtual-co-streamers",
      "new-champion-reveal-frost",
      "some-balance-update",
    ]);
    expect(items[0]).toMatchObject({
      sourceUrl: `${ORIGIN}/ja-jp/news/dev/dev-blog-jungle-changes`,
      title: "Dev Blog: ジャングル変更",
      category: "パッチ/メタ",
    });
    // lolesports.com: og:titleが無いため<h1>フォールバックでタイトルが取れる
    expect(items[1]).toMatchObject({
      sourceUrl: `${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`,
      title: "LCP 2026 Split 3のバーチャルミラー配信者",
      category: "eスポーツ",
    });
    expect(items[2]).toMatchObject({ category: "Riot公式" });
    expect(items[3]).toMatchObject({ category: "パッチ/メタ" });
    expect(items[0].content).toContain("本記事の本文テキストです。");
    expect(items[0].fetchedAt).toEqual(new Date("2026-07-27T00:00:00Z"));
  });

  it("maxItemsで件数上限を有界化する(上限を超えた候補は個別fetchされない)", async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new RiotNewsAdapter({ maxItems: 2, sleep: vi.fn(async () => {}) });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.externalId)).toEqual([
      "dev-blog-jungle-changes",
      "lcp-2026-split-3-virtual-co-streamers",
    ]);
    const calledUrls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calledUrls).not.toContain(`${ORIGIN}/ja-jp/news/game-updates/new-champion-reveal-frost`);
  });

  it("リクエスト間にディレイ(sleep)を挟む(記事間のみ、件数-1回)", async () => {
    const sleep = vi.fn(async () => {});
    vi.stubGlobal("fetch", buildFetchMock());
    const adapter = new RiotNewsAdapter({ sleep });
    await adapter.fetchItems();
    expect(sleep).toHaveBeenCalledTimes(3); // 4件選定 → 記事間ディレイは3回
  });

  it("一覧ページ取得がHTTPエラー/ネットワーク断の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("", 500)));
    const adapter = new RiotNewsAdapter({ sleep: vi.fn(async () => {}) });
    await expect(adapter.fetchItems()).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter2 = new RiotNewsAdapter({ sleep: vi.fn(async () => {}) });
    await expect(adapter2.fetchItems()).resolves.toEqual([]);
  });

  it("1記事の取得失敗(HTTPエラー)はその1件だけスキップし他は継続する(グレースフル)", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        [`${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`]: async () => textResponse("", 500),
      }),
    );
    const adapter = new RiotNewsAdapter({ sleep: vi.fn(async () => {}) });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.externalId)).not.toContain("lcp-2026-split-3-virtual-co-streamers");
  });

  it("og:titleもh1も取得できない記事はスキップする", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchMock({
        [`${ESPORTS_ORIGIN}/ja-jp/news/lcp-2026-split-3-virtual-co-streamers`]: async () =>
          textResponse("<html><body><p>タイトル無し本文</p></body></html>"),
      }),
    );
    const adapter = new RiotNewsAdapter({ sleep: vi.fn(async () => {}) });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.externalId)).not.toContain("lcp-2026-split-3-virtual-co-streamers");
  });
});
