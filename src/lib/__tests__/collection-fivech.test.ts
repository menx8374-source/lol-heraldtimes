import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FiveChAdapter,
  buildDatUrl,
  buildReadCgiUrl,
  buildSubjectUrl,
  buildThreadDumpFromDat,
  decodeDatBody,
  filterRelevantThreads,
  parseBoards,
  parseSubjectText,
} from "@/lib/collection/adapters/fivech";
import { parseThreadReses, extractAnchors } from "@/lib/generation/thread-format";

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const SUBJECT_TEXT =
  "1700000001.dat<>【LoL】バロン前ワイプ、議論勃発 (12)\n" +
  "1700000002.dat<>麻雀の戦術について語るスレ (50)\n" +
  "1700000003.dat<>ヤスオの伝説的アウトプレイに一同騒然 (20)\n" +
  "invalid line without proper format\n";

const DAT_TEXT_THREAD1 =
  "名無しさん<><>2026/07/25(土) 10:00:00.00 ID:aaa<>今日のランクでバロン前に味方ADCが単独で突っ込んで負けた。これADCが悪いよな?<>【LoL】バロン前ワイプ、議論勃発\n" +
  "名無しさん<><>2026/07/25(土) 10:01:00.00 ID:bbb<>&gt;&gt;1<br>状況によるけど、フラッシュが無い状態なら判断ミスだと思う。<>\n" +
  '名無しさん<><>2026/07/25(土) 10:02:00.00 ID:ccc<>いや<a href="./test/read.cgi/game/1700000001/1">サポート</a>が先に落ちたのが原因では?<>\n';

describe("純関数: parseBoards", () => {
  it("\"server/board\"のカンマ区切りをboard定義配列にパースする", () => {
    expect(parseBoards("a.example.com/board1,b.example.com/board2")).toEqual([
      { server: "a.example.com", board: "board1" },
      { server: "b.example.com", board: "board2" },
    ]);
  });

  it("前後の空白を許容する", () => {
    expect(parseBoards(" a.example.com/board1 , b.example.com/board2 ")).toEqual([
      { server: "a.example.com", board: "board1" },
      { server: "b.example.com", board: "board2" },
    ]);
  });

  it("不正な要素(区切り無し・server/boardいずれか欠落)は無視する", () => {
    expect(parseBoards("invalid, , onlyserver/, /onlyboard")).toEqual([]);
  });

  it("空文字は空配列を返す", () => {
    expect(parseBoards("")).toEqual([]);
  });
});

describe("純関数: parseSubjectText / filterRelevantThreads", () => {
  it("subject.txtの各行(threadId.dat<>タイトル (レス数))をパースする(不正行は無視)", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      threadId: "1700000001",
      title: "【LoL】バロン前ワイプ、議論勃発",
      resCount: 12,
    });
    expect(entries[1].threadId).toBe("1700000002");
    expect(entries[2].resCount).toBe(20);
  });

  it("LoL関連キーワードでタイトルを絞り込み、上位N件に制限する", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    const relevant = filterRelevantThreads(entries, ["lol", "ヤスオ"], 10);
    expect(relevant.map((e) => e.threadId).sort()).toEqual(["1700000001", "1700000003"]);
  });

  it("limitで上位N件に絞る", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    const relevant = filterRelevantThreads(entries, ["lol", "ヤスオ"], 1);
    expect(relevant).toHaveLength(1);
  });
});

describe("純関数: decodeDatBody / buildThreadDumpFromDat", () => {
  it("<br>を改行に変換し、HTMLエンティティをデコードし、>>Nアンカーを保持する", () => {
    expect(decodeDatBody("&gt;&gt;1<br>本文だよ")).toEqual([">>1", "本文だよ"]);
  });

  it("タグを除去して中身のテキストは残す", () => {
    expect(decodeDatBody('<a href="l1">&gt;&gt;1</a>への返信')).toEqual([">>1への返信"]);
  });

  it("&amp;/&quot;/&#39;/数値実体参照をデコードする", () => {
    expect(decodeDatBody("A &amp; B")).toEqual(["A & B"]);
    expect(decodeDatBody("&quot;test&quot;")).toEqual(['"test"']);
    expect(decodeDatBody("&#39;quote&#39;")).toEqual(["'quote'"]);
    expect(decodeDatBody("&#12354;")).toEqual(["あ"]);
  });

  it("dat全体をスレッドダンプ形式(N: 本文\\n\\n…)に組み立てる(レス番号=行番号)", () => {
    const content = buildThreadDumpFromDat(DAT_TEXT_THREAD1, 30);
    expect(content).toBe(
      "1: 今日のランクでバロン前に味方ADCが単独で突っ込んで負けた。これADCが悪いよな?\n\n" +
        "2: >>1\n状況によるけど、フラッシュが無い状態なら判断ミスだと思う。\n\n" +
        "3: いやサポートが先に落ちたのが原因では?",
    );
  });

  it("生成したcontentはparseThreadResesで正しく複数レスに分解できる(下流互換)", () => {
    const content = buildThreadDumpFromDat(DAT_TEXT_THREAD1, 30)!;
    const reses = parseThreadReses(content);
    expect(reses).toHaveLength(3);
    expect(reses[0].number).toBe(1);
    expect(reses[1].number).toBe(2);
    expect(extractAnchors(reses[1].lines)).toEqual([1]);
    expect(reses[2].lines[0]).toContain("サポート");
  });

  it("maxResesで取り込みレス数を上限にする", () => {
    const content = buildThreadDumpFromDat(DAT_TEXT_THREAD1, 2)!;
    expect(parseThreadReses(content)).toHaveLength(2);
  });

  it("有効なレスが1件も無ければnullを返す", () => {
    expect(buildThreadDumpFromDat("", 30)).toBeNull();
    expect(buildThreadDumpFromDat("a<>b<>c<><>\n", 30)).toBeNull();
  });
});

describe("URL構築", () => {
  it("subject.txt/dat/read.cgiのURLを構築する", () => {
    expect(buildSubjectUrl("test5ch.example", "game")).toBe("https://test5ch.example/game/subject.txt");
    expect(buildDatUrl("test5ch.example", "game", "1700000001")).toBe(
      "https://test5ch.example/game/dat/1700000001.dat",
    );
    expect(buildReadCgiUrl("test5ch.example", "game", "1700000001")).toBe(
      "https://test5ch.example/test/read.cgi/game/1700000001/",
    );
  });
});

describe("FiveChAdapter.fetchItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const board = { server: "test5ch.example", board: "game" };

  it("subject.txt→絞り込み→dat取得→スレッドダンプcontentのRawCollectionItem[]を返す(sourceUrl=read.cgi)", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["User-Agent"]).toBe("test-ua");
      if (url === buildSubjectUrl(board.server, board.board)) return textResponse(SUBJECT_TEXT);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) return textResponse(DAT_TEXT_THREAD1);
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return textResponse(DAT_TEXT_THREAD1);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua" });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(2);
    const item1 = items.find((i) => i.sourceUrl === buildReadCgiUrl(board.server, board.board, "1700000001"));
    expect(item1).toBeDefined();
    expect(item1?.title).toBe("【LoL】バロン前ワイプ、議論勃発");
    expect(parseThreadReses(item1!.content)).toHaveLength(3);
    // 麻雀スレ(1700000002)は非関連なのでdatすら取得されない(fetchMockのthrowが起きていないことで担保)
    expect(fetchMock).toHaveBeenCalledTimes(3); // subject.txt + dat*2
  });

  it("同一スレ(同一read.cgi URL)が重複した場合は重複排除して1件になる", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === buildSubjectUrl(board.server, board.board)) return textResponse(SUBJECT_TEXT);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) return textResponse(DAT_TEXT_THREAD1);
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return textResponse(DAT_TEXT_THREAD1);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // 同一board設定を2つ渡す(同一サーバ/板の重複設定)→同一read.cgi URLが2重に生成されるはずが1件に集約される
    const adapter = new FiveChAdapter({ boards: [board, board], userAgent: "test-ua" });
    const items = await adapter.fetchItems();
    const urls = items.map((i) => i.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(items).toHaveLength(2);
  });

  it("board未設定(空配列)の場合はfetchを呼ばず空配列＋スキップログを残す(例外を投げない)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new FiveChAdapter({ boards: [] });
    const items = await adapter.fetchItems();

    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("subject.txt取得がHTTPエラーの場合は空配列を返す(dat取得は行わず、例外を投げない)", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === buildSubjectUrl(board.server, board.board) ? textResponse("", 403) : textResponse(DAT_TEXT_THREAD1),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua" });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dat取得の失敗(ネットワーク断)は当該スレのみスキップし、他は継続する(例外を投げない)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === buildSubjectUrl(board.server, board.board)) return textResponse(SUBJECT_TEXT);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) throw new Error("network down");
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return textResponse(DAT_TEXT_THREAD1);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua" });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe(buildReadCgiUrl(board.server, board.board, "1700000003"));
  });

  it("既定board(env未設定)でもエラーにならず動作する(既定値使用)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textResponse("", 500)),
    );
    const adapter = new FiveChAdapter({});
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });
});
