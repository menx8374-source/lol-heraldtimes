import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RiotDataDragonAdapter,
  buildPatchItem,
  buildPatchNoteUrl,
  fetchPatchNotesText,
  PATCH_NOTES_MIN_LENGTH,
  PATCH_NOTES_MAX_LENGTH,
} from "@/lib/collection/adapters/riot-datadragon";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";
const PATCH_NOTE_URL = buildPatchNoteUrl("14.6.1");

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe("純関数: buildPatchNoteUrl / buildPatchItem", () => {
  it("バージョンからmajor.minor単位で一意・安定なパッチノートURLを構築する", () => {
    expect(buildPatchNoteUrl("14.6.1")).toBe(
      "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
    );
    // DDragon 16.14 は公式パッチノートでは 26.14（2025年の呼称変更以降 major+10）。現行パッチのURLを正しく作れること（拡張E34c）。
    expect(buildPatchNoteUrl("16.14.1")).toBe(
      "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes",
    );
    // revision(3番目)が違っても同一パッチとして同じURLになる(dedupが効く)
    expect(buildPatchNoteUrl("14.6.2")).toBe(buildPatchNoteUrl("14.6.1"));
  });

  it("新パッチ検知アイテムはパッチ事実のタイトル・contentを持ちキーワード「パッチ」を含む", () => {
    const now = new Date("2026-07-25T00:00:00+09:00");
    const item = buildPatchItem("14.6.1", now);
    expect(item.title).toContain("パッチ");
    expect(item.title).toContain("14.6");
    expect(item.sourceUrl).toBe(buildPatchNoteUrl("14.6.1"));
    expect(item.fetchedAt).toBe(now);
  });

  it("新パッチ検知アイテムには画像を設定しない", () => {
    const item = buildPatchItem("14.6.1", new Date());
    expect(item.imageUrl).toBeFalsy();
  });

  it("patchNotesText(本文, PATCH_NOTES_MIN_LENGTH以上)が渡されると、contentに本文がそのまま入りタイトルが「まとめ」表記になる（拡張E34）", () => {
    const patchNotesText = "実際のパッチノート本文。".repeat(30); // 300字以上
    expect(patchNotesText.length).toBeGreaterThanOrEqual(PATCH_NOTES_MIN_LENGTH);
    const item = buildPatchItem("14.6.1", new Date(), patchNotesText);
    expect(item.title).toBe("【パッチ】14.6 の主な変更点まとめ");
    expect(item.content).toBe(patchNotesText);
    expect(item.sourceUrl).toBe(buildPatchNoteUrl("14.6.1"));
  });

  it("patchNotesTextが短すぎる(PATCH_NOTES_MIN_LENGTH未満)場合は従来の汎用contentのまま(フォールバック)", () => {
    const item = buildPatchItem("14.6.1", new Date(), "短い本文");
    expect(item.title).toBe("【パッチ】14.6 のゲームデータが公開");
    expect(item.content).toContain("Data Dragon");
  });

  it("patchNotesTextがnull/未指定の場合は従来どおりの汎用content(回帰なし)", () => {
    const withNull = buildPatchItem("14.6.1", new Date(), null);
    const withoutArg = buildPatchItem("14.6.1", new Date());
    expect(withNull.content).toBe(withoutArg.content);
    expect(withNull.title).toBe(withoutArg.title);
  });
});

describe("fetchPatchNotesText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HTMLからタグを除去しエンティティを復号した本文テキストを返す(PATCH_NOTES_MIN_LENGTH以上のとき)", async () => {
    const paragraph = "本パッチではヤスオが強化され、ゼドが弱体化された。".repeat(15); // 十分な長さ(300字超)
    const html = `<html><head><style>.x{color:red}</style></head><body><script>var x=1;</script>` +
      `<h1>パッチノート</h1><p>${paragraph}&amp;R&nbsp;&lt;test&gt;</p></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(PATCH_NOTE_URL);
        return textResponse(html);
      }),
    );
    const text = await fetchPatchNotesText("14.6.1");
    expect(text).not.toBeNull();
    expect(text).toContain("パッチノート");
    expect(text).toContain(paragraph);
    // タグは除去され、エンティティは復号されている
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<script>");
    expect(text).toContain("&R <test>");
  });

  it("HTTPエラーの場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("", 500)));
    await expect(fetchPatchNotesText("14.6.1")).resolves.toBeNull();
  });

  it("ネットワーク断の場合はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchPatchNotesText("14.6.1")).resolves.toBeNull();
  });

  it("本文が短すぎる(JSレンダリング等で本文が取れない)場合はnullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textResponse("<html><body><div id=\"root\"></div></body></html>")),
    );
    await expect(fetchPatchNotesText("14.6.1")).resolves.toBeNull();
  });

  it("上限文字数(PATCH_NOTES_MAX_LENGTH)を超える本文は切り詰められる", async () => {
    const longParagraph = "あ".repeat(PATCH_NOTES_MAX_LENGTH + 500);
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(`<p>${longParagraph}</p>`)));
    const text = await fetchPatchNotesText("14.6.1");
    expect(text).not.toBeNull();
    expect(text!.length).toBe(PATCH_NOTES_MAX_LENGTH);
  });

  it("PATCH_NOTES_MAX_LENGTHが拡大されており、旧上限(15000字)超だが新上限未満の本文は切り詰められず全文入りきる(拡張E35 F-E35-1)", async () => {
    expect(PATCH_NOTES_MAX_LENGTH).toBeGreaterThan(15000);
    const paragraph = "本パッチの実際の変更内容テキスト。".repeat(2000); // 15000字超・新上限未満
    expect(paragraph.length).toBeGreaterThan(15000);
    expect(paragraph.length).toBeLessThan(PATCH_NOTES_MAX_LENGTH);
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(`<p>${paragraph}</p>`)));
    const text = await fetchPatchNotesText("14.6.1");
    expect(text).not.toBeNull();
    expect(text).toContain(paragraph);
  });

  it("nav/header/footer/asideのボイラープレートが除去され、本文相当のテキストは残る(拡張E35 F-E35-1)", async () => {
    const paragraph = "本パッチではヤスオが強化され、ゼドが弱体化された。".repeat(15); // 300字超
    const html =
      "<html><body>" +
      "<header><nav><a href='/'>ニュース</a><a href='/esports'>eスポーツ</a><a href='/wiki'>Wiki</a></nav></header>" +
      `<main><h1>パッチノート</h1><p>${paragraph}</p></main>` +
      "<aside><h3>関連記事</h3><a href='/x'>関連記事タイトルその1</a><a href='/y'>関連記事タイトルその2</a></aside>" +
      "<footer><nav><a href='/terms'>利用規約</a><a href='/privacy'>プライバシー</a></nav></footer>" +
      "</body></html>";
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(html)));
    const text = await fetchPatchNotesText("14.6.1");
    expect(text).not.toBeNull();
    // 本文相当のテキストは残る
    expect(text).toContain(paragraph);
    expect(text).toContain("パッチノート");
    // nav/header/footer/aside内のテキストはページから丸ごと落ちている
    expect(text).not.toContain("ニュース");
    expect(text).not.toContain("eスポーツ");
    expect(text).not.toContain("Wiki");
    expect(text).not.toContain("関連記事");
    expect(text).not.toContain("利用規約");
    expect(text).not.toContain("プライバシー");
  });

  it("極端に短い断片(2文字以下)が3件以上連続するボイラープレートは間引かれる(best-effort)", async () => {
    const paragraph = "本パッチではヤスオが強化され、ゼドが弱体化された。".repeat(15); // 300字超
    // ナビ的な短い断片の連続(タグに包まれていなくても、行としては短い断片が連続するケース)
    const html =
      `<div>Q<br/>W<br/>E<br/>R<br/></div><p>${paragraph}</p>`;
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(html)));
    const text = await fetchPatchNotesText("14.6.1");
    expect(text).not.toBeNull();
    expect(text).toContain(paragraph);
    // 4件連続する1文字断片(Q/W/E/R)は間引かれ、本文には残らない
    expect(text).not.toMatch(/^Q$/m);
  });
});

describe("RiotDataDragonAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("versionsのみを取得し、新パッチ検知1件のみを返す(拡張E20 F-E20-2: チャンピオン紹介は廃止)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ now: () => new Date("2026-07-25T00:00:00Z") });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("パッチ");
    expect(items[0].sourceUrl).toBe(
      "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-14-6-notes",
    );

    // champion.json へのfetchは発生しない
    const championCall = fetchMock.mock.calls.find(([url]) => (url as string).includes("/champion.json"));
    expect(championCall).toBeUndefined();
  });

  it("公式パッチノート本文の取得に成功した場合、contentに本文が入りタイトルが「まとめ」表記になる(拡張E34 F-E34-1、実ネットワーク非依存)", async () => {
    const paragraph = "ヤスオが強化され、ゼドが弱体化されるなどの変更が入った。".repeat(15);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      if (url === PATCH_NOTE_URL) return textResponse(`<p>${paragraph}</p>`);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ now: () => new Date("2026-07-25T00:00:00Z") });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("【パッチ】14.6 の主な変更点まとめ");
    expect(items[0].content).toContain(paragraph);
  });

  it("公式パッチノート本文の取得に失敗した場合は従来の汎用contentにフォールバックする(例外を投げない)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      if (url === PATCH_NOTE_URL) return textResponse("", 500);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RiotDataDragonAdapter({ now: () => new Date("2026-07-25T00:00:00Z") });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("【パッチ】14.6 のゲームデータが公開");
    expect(items[0].content).toContain("Data Dragon");
  });

  it("versions取得がHTTPエラーの場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(null, 500)),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("versions取得が不正JSON(パース失敗)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      })),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });

  it("ネットワーク断(fetchがreject)の場合は空配列を返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const adapter = new RiotDataDragonAdapter();
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });
});
