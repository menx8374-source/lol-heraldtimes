import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FiveChAdapter,
  buildDatUrl,
  buildReadCgiUrl,
  buildSubjectUrl,
  buildThreadDumpFromDat,
  decodeDatBody,
  filterRelevantThreads,
  matchKeywordThreads,
  parseBoards,
  parseDatReses,
  parseFiveChExternalId,
  parseSubjectText,
  selectHighlightReses,
  type DatRes,
  type SubjectEntry,
} from "@/lib/collection/adapters/fivech";
import { parseThreadReses, extractAnchors } from "@/lib/generation/thread-format";
import { DEFAULT_LOL_KEYWORDS } from "@/lib/collection/config";

const SUBJECT_TEXT =
  "1700000001.dat<>【LoL】バロン前ワイプ、議論勃発 (12)\n" +
  "1700000002.dat<>麻雀の戦術について語るスレ (50)\n" +
  "1700000003.dat<>ヤスオの伝説的アウトプレイに一同騒然 (20)\n" +
  "invalid line without proper format\n";

const DAT_TEXT_THREAD1 =
  "名無しさん<><>2026/07/25(土) 10:00:00.00 ID:aaa<>今日のランクでバロン前に味方ADCが単独で突っ込んで負けた。これADCが悪いよな?<>【LoL】バロン前ワイプ、議論勃発\n" +
  "名無しさん<><>2026/07/25(土) 10:01:00.00 ID:bbb<>&gt;&gt;1<br>状況によるけど、フラッシュが無い状態なら判断ミスだと思う。<>\n" +
  '名無しさん<><>2026/07/25(土) 10:02:00.00 ID:ccc<>いや<a href="./test/read.cgi/game/1700000001/1">サポート</a>が先に落ちたのが原因では?<>\n';

// SUBJECT_TEXT/DAT_TEXT_THREAD1 をShift_JIS(Windows-31J/CP932)でエンコードした生バイト列(16進)。
// 5chが実際に返すのと同じShift_JISバイト列でFiveChAdapterの取得経路(拡張E23)を検証するため、
// UTF-8前提のtext()ではなくarrayBuffer()でこのバイト列を返すモックを使う。
// (事前にNode `TextDecoder("shift_jis").decode()` で上記2定数と完全一致することを確認済み)
const SUBJECT_TEXT_SJIS_HEX =
  "313730303030303030312e6461743c3e81794c6f4c817a836f838d8393914f838f8343837681418b63985f967594ad20283132290a" +
  "313730303030303030322e6461743c3e9683909d82cc90ed8f7082c982c282a282c48cea82e98358838c20283530290a" +
  "313730303030303030332e6461743c3e83848358834982cc936090e093498341834583678376838c834382c988ea93af919b915220283230290a" +
  "696e76616c6964206c696e6520776974686f75742070726f70657220666f726d61740a";

const DAT_TEXT_THREAD1_SJIS_HEX =
  "96bc96b382b582b382f13c3e3c3e323032362f30372f3235289379292031303a30303a30302e30302049443a6161613c3e" +
  "8da193fa82cc83898393834e82c5836f838d8393914f82c996a195fb41444382aa925093c682c593cb82c18d9e82f182c5958982af82bd814282b182ea41444382aa88ab82a282e682c83f3c3e" +
  "81794c6f4c817a836f838d8393914f838f8343837681418b63985f967594ad0a" +
  "96bc96b382b582b382f13c3e3c3e323032362f30372f3235289379292031303a30313a30302e30302049443a6262623c3e" +
  "2667743b2667743b313c62723e8ff38bb582c982e682e982af82c781418374838983628356838582aa96b382a28ff391d482c882e794bb9266837e835882be82c68e7682a481423c3e0a" +
  "96bc96b382b582b382f13c3e3c3e323032362f30372f3235289379292031303a30323a30302e30302049443a6363633c3e" +
  "82a282e23c6120687265663d222e2f746573742f726561642e6367692f67616d652f313730303030303030312f31223e8354837c815b83673c2f613e82aa90e682c9978e82bf82bd82cc82aa8cb488f682c582cd3f3c3e0a";

// A1(被参照優先抽出)検証用のdat: レス4(本当に良い意見だと思う)が後発ながら3回被参照され、
// 先頭寄りのレス2/3(無反応の雑談)より優先されるべきことを検証するための素の(非SJIS)datテキスト。
const HOT_RES_DAT =
  "名無しさん<><>2026/07/25(土) 10:00:00.00 ID:aaa<>質問です<>タイトル\n" +
  "名無しさん<><>2026/07/25(土) 10:01:00.00 ID:bbb<>何でもない話1<>\n" +
  "名無しさん<><>2026/07/25(土) 10:02:00.00 ID:ccc<>何でもない話2<>\n" +
  "名無しさん<><>2026/07/25(土) 10:03:00.00 ID:ddd<>本当に良い意見だと思う<>\n" +
  "名無しさん<><>2026/07/25(土) 10:04:00.00 ID:eee<>>>4 それな<>\n" +
  "名無しさん<><>2026/07/25(土) 10:05:00.00 ID:fff<>>>4 わかりみが深い<>\n" +
  "名無しさん<><>2026/07/25(土) 10:06:00.00 ID:ggg<>>>4 その通り<>\n";

/** fetchのモック応答: FiveChAdapterは`fetchShiftJisTextSafe`(arrayBuffer→shift_jisデコード)で読むため、
 * `text()`ではなく`arrayBuffer()`でShift_JISの生バイト列を返す(5chの実際の応答を模す)。 */
function sjisResponse(bodyHex: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(bodyHex, "hex")).buffer,
  } as unknown as Response;
}

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

  it("LoL関連キーワードでタイトルを絞り込む(下限0なら全件通過)", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    const relevant = filterRelevantThreads(entries, ["lol", "ヤスオ"], 10, 0);
    expect(relevant.map((e) => e.threadId).sort()).toEqual(["1700000001", "1700000003"]);
  });

  it("limitで上位N件に絞る", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    const relevant = filterRelevantThreads(entries, ["lol", "ヤスオ"], 1, 0);
    expect(relevant).toHaveLength(1);
  });
});

describe("純関数: filterRelevantThreads (A2: レス数下限+勢い順)", () => {
  it("resCountが下限未満のスレを除外する(過疎スレ排除)", () => {
    const entries = parseSubjectText(SUBJECT_TEXT); // resCount: 1700000001=12, 1700000003=20
    const relevant = filterRelevantThreads(entries, ["lol", "ヤスオ"], 10, 20);
    expect(relevant.map((e) => e.threadId)).toEqual(["1700000003"]);
  });

  it("下限を満たすスレはresCount降順(勢い順)でソートしてから上位limit件を採用する(subject順のsliceはしない)", () => {
    const entries: SubjectEntry[] = [
      { threadId: "a", title: "lolの話1", resCount: 30 },
      { threadId: "b", title: "lolの話2", resCount: 100 },
      { threadId: "c", title: "lolの話3", resCount: 25 },
    ];
    const relevant = filterRelevantThreads(entries, ["lol"], 2, 20);
    expect(relevant.map((e) => e.threadId)).toEqual(["b", "a"]);
  });

  it("キーワード不一致のスレは下限を満たしていても除外する", () => {
    const entries: SubjectEntry[] = [{ threadId: "x", title: "麻雀の話", resCount: 999 }];
    expect(filterRelevantThreads(entries, ["lol"], 10, 20)).toEqual([]);
  });

  it("満了(1000到達)スレも上限では除外しない(resCount=1000でも通過する)", () => {
    const entries: SubjectEntry[] = [{ threadId: "y", title: "lolの満了スレ", resCount: 1000 }];
    expect(filterRelevantThreads(entries, ["lol"], 10, 20).map((e) => e.threadId)).toEqual(["y"]);
  });
});

describe("純関数: matchKeywordThreads", () => {
  it("キーワード一致のみで絞り込む(レス数・件数は考慮しない)", () => {
    const entries = parseSubjectText(SUBJECT_TEXT);
    const matched = matchKeywordThreads(entries, ["lol", "ヤスオ"]);
    expect(matched.map((e) => e.threadId).sort()).toEqual(["1700000001", "1700000003"]);
  });
});

describe("A3: 関連語拡充(日本語/カタカナチャンピオン名/大会名)", () => {
  it("追加した日本語/大会名/カタカナチャンピオン名キーワードで日本語スレタイがrelevant判定になる", () => {
    const entries: SubjectEntry[] = [
      { threadId: "1", title: "LJLの試合結果について語るスレ", resCount: 50 },
      { threadId: "2", title: "アーリ強すぎ問題", resCount: 50 },
      { threadId: "3", title: "世界大会の展望を語るスレ", resCount: 50 },
      { threadId: "4", title: "麻雀の戦術について語るスレ", resCount: 50 },
    ];
    const matched = matchKeywordThreads(entries, DEFAULT_LOL_KEYWORDS);
    expect(matched.map((e) => e.threadId).sort()).toEqual(["1", "2", "3"]);
  });

  it("既存の英語キーワードの判定は回帰しない", () => {
    const entries: SubjectEntry[] = [{ threadId: "1", title: "Patch 14.6 Jungle Nerf Discussion", resCount: 50 }];
    expect(matchKeywordThreads(entries, DEFAULT_LOL_KEYWORDS)).toHaveLength(1);
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

describe("純関数: parseDatReses / selectHighlightReses (A1: 盛り上がったレス優先抽出)", () => {
  it("datの全レスを{number, bodyLines}にパースする(number=行番号=レス番号)", () => {
    const reses = parseDatReses(DAT_TEXT_THREAD1);
    expect(reses).toHaveLength(3);
    expect(reses[0]).toEqual({ number: 1, bodyLines: ["今日のランクでバロン前に味方ADCが単独で突っ込んで負けた。これADCが悪いよな?"] });
    expect(reses[1].number).toBe(2);
  });

  it("被参照(アンカー)の多いレスを優先し、レス1(OP)は常に含み、maxReses超は上位のみ・出力は元番号昇順", () => {
    const reses = parseDatReses(HOT_RES_DAT);
    expect(reses).toHaveLength(7);
    // レス4(3回被参照)が、先頭寄りだが無反応のレス3/5/6/7より優先して選ばれる(先頭固定ではない)。
    const selected = selectHighlightReses(reses, 3);
    expect(selected.map((r) => r.number)).toEqual([1, 2, 4]);
    // 逐語(本文)は書き換わっていない
    expect(selected.find((r) => r.number === 4)?.bodyLines).toEqual(["本当に良い意見だと思う"]);
    expect(selected.find((r) => r.number === 1)?.bodyLines).toEqual(["質問です"]);
  });

  it("maxReses以内に収まる場合は全有効レスを元番号昇順で返す", () => {
    const reses = parseDatReses(HOT_RES_DAT);
    const selected = selectHighlightReses(reses, 30);
    expect(selected.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("本文が空のレスは候補から除外し、有効レスが1件も無ければ空配列を返す", () => {
    expect(selectHighlightReses([{ number: 1, bodyLines: [] }], 30)).toEqual([]);
    expect(selectHighlightReses([], 30)).toEqual([]);
  });

  it("範囲外/欠番アンカー(存在しないレス番号への>>N)を含むdatでも壊れない", () => {
    const reses = parseDatReses(
      "名無しさん<><>date<>OP本文<>タイトル\n" +
        "名無しさん<><>date<>>>999 存在しないレスへの返信<>\n",
    );
    expect(() => selectHighlightReses(reses, 30)).not.toThrow();
    expect(selectHighlightReses(reses, 30).map((r) => r.number)).toEqual([1, 2]);
  });

  it("buildThreadDumpFromDatは盛り上がったレス優先で組み立て、N: 形式・元番号昇順を維持する(下流互換)", () => {
    const content = buildThreadDumpFromDat(HOT_RES_DAT, 3)!;
    expect(content).toBe("1: 質問です\n\n2: 何でもない話1\n\n4: 本当に良い意見だと思う");
    const reses = parseThreadReses(content);
    expect(reses.map((r) => r.number)).toEqual([1, 2, 4]);
  });
});

describe("selectHighlightReses（選抜レスの返信先の自己完結化、拡張E41 F-E41-1）", () => {
  it("選抜レスが直接>>Nで参照する先Nがvalidに存在すれば、上限到達時でも被参照カウント最小のレスを1件落として枠を空け、maxReses内に含める", () => {
    const reses: DatRes[] = [
      { number: 1, bodyLines: ["質問です"] }, // OP
      { number: 2, bodyLines: [">>5 わかる、それは大事"] }, // 被参照カウント2(6,7から)。5を参照する
      { number: 3, bodyLines: ["ただの雑談B"] }, // 被参照カウント1(8から)
      { number: 5, bodyLines: ["元ネタの指摘レス"] }, // 被参照カウント1(2から)。res2の参照先(本来の主役)
      { number: 6, bodyLines: [">>2 そうだね"] },
      { number: 7, bodyLines: [">>2 そうだね"] },
      { number: 8, bodyLines: [">>3 それな"] },
    ];
    // 上限3(OP+2枠): 純粋な被参照カウント順では[1,2,3]が選ばれ、res2が参照する5が漏れてしまう。
    const selected = selectHighlightReses(reses, 3);
    // res3(被参照1、非アンカー先)が落とされ、代わりにres2の参照先res5が含まれる。上限は超えない。
    expect(selected.map((r) => r.number)).toEqual([1, 2, 5]);
    expect(selected.length).toBeLessThanOrEqual(3);
    // 逐語(本文)は書き換わっていない
    expect(selected.find((r) => r.number === 5)?.bodyLines).toEqual(["元ネタの指摘レス"]);
  });

  it("枠に余裕があれば、被参照カウント順の選抜結果はそのままに参照先をそのまま追加する", () => {
    const reses: DatRes[] = [
      { number: 1, bodyLines: ["質問です"] },
      { number: 2, bodyLines: [">>5 わかる"] },
      { number: 5, bodyLines: ["元ネタ"] },
    ];
    const selected = selectHighlightReses(reses, 10);
    expect(selected.map((r) => r.number)).toEqual([1, 2, 5]);
  });

  it("参照先が存在しない番号(欠番)なら追加されない(従来どおり壊れない)", () => {
    const reses: DatRes[] = [
      { number: 1, bodyLines: ["質問です"] },
      { number: 2, bodyLines: [">>999 存在しない番号への返信"] },
    ];
    const selected = selectHighlightReses(reses, 2);
    expect(selected.map((r) => r.number)).toEqual([1, 2]);
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
      if (url === buildSubjectUrl(board.server, board.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua", minResCount: 0, delayMs: 0 });
    const items = await adapter.fetchItems();

    expect(items).toHaveLength(2);
    const item1 = items.find((i) => i.sourceUrl === buildReadCgiUrl(board.server, board.board, "1700000001"));
    expect(item1).toBeDefined();
    expect(item1?.title).toBe("【LoL】バロン前ワイプ、議論勃発");
    expect(parseThreadReses(item1!.content)).toHaveLength(3);
    // リファクタリングS2（F-S2-1・テスト1）: Post永続化用メタ(externalId/commentCount/score)が載る。
    expect(item1?.externalId).toBe(`${board.server}/${board.board}/1700000001`);
    expect(item1?.commentCount).toBe(12); // subject.txtのレス数(12)
    expect(item1?.score).toBe(0); // 5chはupvote概念が無いため常に0
    // 麻雀スレ(1700000002)は非関連なのでdatすら取得されない(fetchMockのthrowが起きていないことで担保)
    expect(fetchMock).toHaveBeenCalledTimes(3); // subject.txt + dat*2
  });

  it("同一スレ(同一read.cgi URL)が重複した場合は重複排除して1件になる", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === buildSubjectUrl(board.server, board.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // 同一board設定を2つ渡す(同一サーバ/板の重複設定)→同一read.cgi URLが2重に生成されるはずが1件に集約される
    const adapter = new FiveChAdapter({ boards: [board, board], userAgent: "test-ua", minResCount: 0, delayMs: 0 });
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
      url === buildSubjectUrl(board.server, board.board) ? sjisResponse("", 403) : sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua", delayMs: 0 });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dat取得の失敗(ネットワーク断)は当該スレのみスキップし、他は継続する(例外を投げない)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === buildSubjectUrl(board.server, board.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) throw new Error("network down");
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua", minResCount: 0, delayMs: 0 });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe(buildReadCgiUrl(board.server, board.board, "1700000003"));
  });

  it("既定board(env未設定)でもエラーにならず動作する(既定値使用)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sjisResponse("", 500)),
    );
    const adapter = new FiveChAdapter({ delayMs: 0 });
    await expect(adapter.fetchItems()).resolves.toEqual([]);
  });
});

describe("FiveChAdapter: B1 アクセス作法(ディレイ+直列化)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("取得(subject/dat)の間でsleepが呼ばれ、板が直列に処理される(delayMs:0+noop注入で実待機しない)", async () => {
    const boardA = { server: "a.example", board: "game" };
    const boardB = { server: "b.example", board: "game" };
    const callOrder: string[] = [];
    const sleepSpy = vi.fn(async (_ms: number) => {
      callOrder.push("sleep");
    });

    const fetchMock = vi.fn(async (url: string) => {
      callOrder.push(`fetch:${url}`);
      if (url === buildSubjectUrl(boardA.server, boardA.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(boardA.server, boardA.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      if (url === buildSubjectUrl(boardB.server, boardB.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(boardB.server, boardB.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new FiveChAdapter({
      boards: [boardA, boardB],
      userAgent: "test-ua",
      keywords: ["ヤスオ"], // 1700000003のみ関連(板ごとに1スレのみdat取得させる)
      minResCount: 0,
      delayMs: 0,
      sleep: sleepSpy,
    });
    await adapter.fetchItems();

    // フェッチ4回(subjectA, datA, subjectB, datB)に対し、間に入るsleepは3回(最初のフェッチ前は不要)
    expect(sleepSpy).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledWith(0);
    // 直列: フェッチ→sleep→フェッチ→sleep…の順(板が並列に混ざらない)
    expect(callOrder).toEqual([
      `fetch:${buildSubjectUrl(boardA.server, boardA.board)}`,
      "sleep",
      `fetch:${buildDatUrl(boardA.server, boardA.board, "1700000003")}`,
      "sleep",
      `fetch:${buildSubjectUrl(boardB.server, boardB.board)}`,
      "sleep",
      `fetch:${buildDatUrl(boardB.server, boardB.board, "1700000003")}`,
    ]);
  });
});

describe("FiveChAdapter: D1 可観測性(per-boardログ)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const board = { server: "test5ch.example", board: "game" };

  it("board毎にsubject/relevant/selected/collected件数をログし、収集全体の合計もログする", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === buildSubjectUrl(board.server, board.board)) return sjisResponse(SUBJECT_TEXT_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000001")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      if (url === buildDatUrl(board.server, board.board, "1700000003")) return sjisResponse(DAT_TEXT_THREAD1_SJIS_HEX);
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const adapter = new FiveChAdapter({
      boards: [board],
      userAgent: "test-ua",
      minResCount: 0,
      delayMs: 0,
      sleep: async () => {},
    });
    const items = await adapter.fetchItems();
    expect(items).toHaveLength(2);

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some(
        (l) =>
          l.includes("board=test5ch.example/game") &&
          l.includes("subject=3") &&
          l.includes("relevant=2") &&
          l.includes("selected=2") &&
          l.includes("collected=2"),
      ),
    ).toBe(true);
    expect(logs.some((l) => l.includes("収集完了") && l.includes("collected=2"))).toBe(true);
  });

  it("subject.txt取得失敗時はboard付きのskipログを残す(理由が分かる)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sjisResponse("", 403)));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua", delayMs: 0, sleep: async () => {} });
    await adapter.fetchItems();

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((l) => l.includes("board=test5ch.example/game") && l.includes("skip") && l.includes("subject")),
    ).toBe(true);
  });
});

describe("純関数: parseFiveChExternalId（S4 F-S4-1）", () => {
  it("\"server/board/threadId\"を板/スレIDに復元する", () => {
    expect(parseFiveChExternalId("egg.5ch.net/livegame/1700000001")).toEqual({
      server: "egg.5ch.net",
      board: "livegame",
      threadId: "1700000001",
    });
  });

  it("形式不一致はnullを返す", () => {
    expect(parseFiveChExternalId("invalid")).toBeNull();
    expect(parseFiveChExternalId("a/b/c/d")).toBeNull();
    expect(parseFiveChExternalId("a//c")).toBeNull();
  });
});

describe("FiveChAdapter.fetchMetrics（リファクタリングS4 F-S4-1・テスト2）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const board = { server: "test5ch.example", board: "game" };

  it("subject.txtのresCountをcommentCountに変換して返す(score:0固定)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === buildSubjectUrl(board.server, board.board) ? sjisResponse(SUBJECT_TEXT_SJIS_HEX) : sjisResponse("", 500),
      ),
    );
    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua" });
    await expect(
      adapter.fetchMetrics(`${board.server}/${board.board}/1700000001`),
    ).resolves.toEqual({ score: 0, commentCount: 12 });
  });

  it("同一板の2スレ目以降はsubject.txtを再取得せずキャッシュを使う", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === buildSubjectUrl(board.server, board.board) ? sjisResponse(SUBJECT_TEXT_SJIS_HEX) : sjisResponse("", 500),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new FiveChAdapter({ boards: [board], userAgent: "test-ua" });
    await adapter.fetchMetrics(`${board.server}/${board.board}/1700000001`);
    await adapter.fetchMetrics(`${board.server}/${board.board}/1700000003`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("externalId形式不一致はnullを返す", async () => {
    const adapter = new FiveChAdapter({ boards: [board] });
    await expect(adapter.fetchMetrics("invalid")).resolves.toBeNull();
  });

  it("subject.txt取得失敗はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sjisResponse("", 403)));
    const adapter = new FiveChAdapter({ boards: [board] });
    await expect(
      adapter.fetchMetrics(`${board.server}/${board.board}/1700000001`),
    ).resolves.toBeNull();
  });

  it("subject.txtに該当スレIDが無ければnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sjisResponse(SUBJECT_TEXT_SJIS_HEX)));
    const adapter = new FiveChAdapter({ boards: [board] });
    await expect(
      adapter.fetchMetrics(`${board.server}/${board.board}/9999999999`),
    ).resolves.toBeNull();
  });
});
