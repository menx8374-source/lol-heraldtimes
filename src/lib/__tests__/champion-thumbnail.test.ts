import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChampionSplashUrl,
  detectChampionSplashUrl,
  fetchChampionNameToIdMap,
  fallbackChampionNameToIdMap,
} from "@/lib/generation/champion-thumbnail";

const VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("buildChampionSplashUrl", () => {
  it("championIdから公式スプラッシュ画像(1枚目)のURLを組み立てる", () => {
    expect(buildChampionSplashUrl("Lillia")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg",
    );
  });
});

describe("detectChampionSplashUrl（テスト1: 最長一致優先）", () => {
  const map = fallbackChampionNameToIdMap();

  it("「リサンドラが強い」からLissandraのスプラッシュURLを検出する", () => {
    expect(detectChampionSplashUrl("リサンドラが強い", map)).toBe(
      buildChampionSplashUrl("Lissandra"),
    );
  });

  it("「ジンクスは〜」はJinxとして検出し、「ジン」(Jhin)への部分誤検出をしない", () => {
    expect(detectChampionSplashUrl("ジンクスは環境トップだと話題に", map)).toBe(
      buildChampionSplashUrl("Jinx"),
    );
  });

  it("「ジン強い」はJhinとして検出する(ジンクスを含まない文)", () => {
    expect(detectChampionSplashUrl("ジン強いって聞いたけど本当?", map)).toBe(
      buildChampionSplashUrl("Jhin"),
    );
  });

  it("チャンピオン名を含まない文はnullを返す", () => {
    expect(detectChampionSplashUrl("パッチノートが公開された件について", map)).toBeNull();
  });

  it("空文字はnullを返す", () => {
    expect(detectChampionSplashUrl("", map)).toBeNull();
  });

  it("ID不規則なチャンピオン(フォールバック表)を正しく検出する", () => {
    expect(detectChampionSplashUrl("ウーコンが対面で強い", map)).toBe(buildChampionSplashUrl("MonkeyKing"));
    expect(detectChampionSplashUrl("ヌヌ&ウィルンプが復権", map)).toBe(buildChampionSplashUrl("Nunu"));
    expect(detectChampionSplashUrl("カイサのアイテム選択について", map)).toBe(buildChampionSplashUrl("Kaisa"));
    expect(detectChampionSplashUrl("カジックスのジャングル刈りが早い", map)).toBe(
      buildChampionSplashUrl("Khazix"),
    );
    expect(detectChampionSplashUrl("リー・シンのコンボが決まった", map)).toBe(buildChampionSplashUrl("LeeSin"));
    expect(detectChampionSplashUrl("マスターイーの一閃が強い", map)).toBe(buildChampionSplashUrl("MasterYi"));
    expect(detectChampionSplashUrl("ミス・フォーチュンの新スキン", map)).toBe(
      buildChampionSplashUrl("MissFortune"),
    );
    expect(detectChampionSplashUrl("タム・ケンチが飲み込んだ", map)).toBe(buildChampionSplashUrl("TahmKench"));
    expect(detectChampionSplashUrl("ツイステッド・フェイトのカード投げ", map)).toBe(
      buildChampionSplashUrl("TwistedFate"),
    );
    expect(detectChampionSplashUrl("シン・ジャオの三連撃", map)).toBe(buildChampionSplashUrl("XinZhao"));
    expect(detectChampionSplashUrl("オレリオン・ソルの星が輝く", map)).toBe(
      buildChampionSplashUrl("AurelionSol"),
    );
    expect(detectChampionSplashUrl("ジャーヴァンIVの旗が刺さった", map)).toBe(
      buildChampionSplashUrl("JarvanIV"),
    );
    expect(detectChampionSplashUrl("ドクター・ムンドの化学薬品", map)).toBe(buildChampionSplashUrl("DrMundo"));
    expect(detectChampionSplashUrl("ルブランの分身コンボ", map)).toBe(buildChampionSplashUrl("Leblanc"));
  });

  it("Mapが空(size=0)の場合はnullを返す", () => {
    expect(detectChampionSplashUrl("リサンドラが強い", new Map())).toBeNull();
  });
});

describe("fetchChampionNameToIdMap（テスト2: fetchモック）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常時はDataDragonのchampion.json(ja_JP・最新version)からMapを生成する", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1", "14.5.1"]);
      if (url === "https://ddragon.leagueoflegends.com/cdn/14.6.1/data/ja_JP/champion.json") {
        return jsonResponse({
          data: {
            Lillia: { id: "Lillia", name: "リリア" },
            MonkeyKing: { id: "MonkeyKing", name: "ウーコン" },
          },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchChampionNameToIdMap();
    expect(map.get("リリア")).toBe("Lillia");
    expect(map.get("ウーコン")).toBe("MonkeyKing");
    // championId自身(英語表記)も検出対象に含まれる
    expect(map.get("Lillia")).toBe("Lillia");
  });

  it("versions取得がHTTPエラーの場合は例外を投げずフォールバック表を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null, 500)));
    const map = await fetchChampionNameToIdMap();
    expect(map.get("リサンドラ")).toBe("Lissandra");
    expect(map.get("ウーコン")).toBe("MonkeyKing");
  });

  it("champion.json取得が不正JSON(パース失敗)の場合は例外を投げずフォールバック表を返す", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === VERSIONS_URL) return jsonResponse(["14.6.1"]);
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("invalid json");
        },
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const map = await fetchChampionNameToIdMap();
    expect(map.get("リサンドラ")).toBe("Lissandra");
  });

  it("ネットワーク断(fetchがreject)の場合は例外を投げずフォールバック表を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const map = await fetchChampionNameToIdMap();
    expect(map.get("リサンドラ")).toBe("Lissandra");
  });
});
