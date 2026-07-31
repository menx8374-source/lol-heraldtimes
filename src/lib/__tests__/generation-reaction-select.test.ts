import { describe, expect, it } from "vitest";
import { selectScoredAnchorReses, type ScoredAnchorItem } from "@/lib/generation/reaction-select";

/**
 * `selectScoredAnchorReses`（resel-S2 F-RS2-1、統一レス選定「score優先＋アンカー文脈」）の単体テスト。
 * ソース非依存の決定論純関数。Reddit/Xいずれの呼び出し側テストもこの単体テストを土台にする。
 */
describe("selectScoredAnchorReses（統一レス選定、resel-S2 F-RS2-1）", () => {
  it("空入力は空配列を返す", () => {
    expect(selectScoredAnchorReses([], { target: 12, anchorDepth: 1, hardCap: 15 })).toEqual([]);
  });

  it("score降順でtarget件を選抜する(親なし)", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 5, parentIndex: null },
      { index: 1, score: 20, parentIndex: null },
      { index: 2, score: 10, parentIndex: null },
      { index: 3, score: 1, parentIndex: null },
    ];
    // target=2なら score降順で 1(20), 2(10) が選ばれる。
    expect(selectScoredAnchorReses(items, { target: 2, anchorDepth: 1, hardCap: 5 })).toEqual([1, 2]);
  });

  it("親を1段(anchorDepth)遡って文脈として追加する(親はprimaryに無くても低scoreで採用)", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 1, parentIndex: null }, // 低score、primaryには入らないが1のparent
      { index: 1, score: 100, parentIndex: 0 }, // 高score primary、親は0
      { index: 2, score: 2, parentIndex: null }, // 無関係の低score
    ];
    // target=1: primaryは1のみ。1のparent(0)がanchorDepth=1で文脈追加される。出力は親(0)→子(1)。
    const result = selectScoredAnchorReses(items, { target: 1, anchorDepth: 1, hardCap: 5 });
    expect(result).toEqual([0, 1]);
  });

  it("anchorDepthを超えた祖先(2段目)は文脈として追加されない", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 1, parentIndex: null }, // 祖父
      { index: 1, score: 1, parentIndex: 0 }, // 親
      { index: 2, score: 100, parentIndex: 1 }, // primary(子)
    ];
    // anchorDepth=1: 2のparent(1)のみ文脈追加。1のparent(0)までは辿らない。
    const result = selectScoredAnchorReses(items, { target: 1, anchorDepth: 1, hardCap: 5 });
    expect(result).toEqual([1, 2]);

    // anchorDepth=2なら祖父(0)まで文脈追加され、親→祖父→子ではなく祖父→親→子の順で並ぶ。
    const resultDepth2 = selectScoredAnchorReses(items, { target: 1, anchorDepth: 2, hardCap: 5 });
    expect(resultDepth2).toEqual([0, 1, 2]);
  });

  it("hardCap超過はcontextのうち低scoreのものから間引く(primaryは間引かない)", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 1, parentIndex: null }, // primary1の親(context, score低)
      { index: 1, score: 100, parentIndex: 0 }, // primary
      { index: 2, score: 2, parentIndex: null }, // primary2の親(context, score中)
      { index: 3, score: 90, parentIndex: 2 }, // primary
      { index: 4, score: 80, parentIndex: null }, // primary
    ];
    // target=3: primaryは1,3,4(score100,90,80)。contextは0(score1)と2(score2)で選定合計5件。
    // hardCap=4なら、contextのうちscoreが低い方(0)から1件間引かれ合計4件になる。
    const result = selectScoredAnchorReses(items, { target: 3, anchorDepth: 1, hardCap: 4 });
    expect(result).toHaveLength(4);
    expect(result).not.toContain(0); // 低scoreのcontext(0)が間引かれる
    expect(result).toContain(2); // scoreが高い方のcontext(2)は残る
    expect(result).toEqual(expect.arrayContaining([1, 2, 3, 4]));
  });

  it("出力はチェーン整合順(親が必ず子より前に出る)。primaryをscore降順で走査し祖先→自分の順でemitする", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 1, parentIndex: null }, // 親(score低いのでcontext)
      { index: 1, score: 50, parentIndex: 0 }, // primary(子)
      { index: 2, score: 90, parentIndex: null }, // primary(独立、最高score)
    ];
    // score降順走査: 2(90)→1(50)。2は親なしでそのままemit。1は親0を先にemitしてから1。
    const result = selectScoredAnchorReses(items, { target: 3, anchorDepth: 1, hardCap: 6 });
    expect(result).toEqual([2, 0, 1]);
  });

  it("親indexがnull(ルート/プール外)でも落ちない", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 10, parentIndex: null },
      { index: 1, score: 20, parentIndex: 999 }, // プール外の親参照(存在しないindex)
    ];
    expect(() => selectScoredAnchorReses(items, { target: 2, anchorDepth: 1, hardCap: 5 })).not.toThrow();
    const result = selectScoredAnchorReses(items, { target: 2, anchorDepth: 1, hardCap: 5 });
    expect(result.sort()).toEqual([0, 1]);
  });

  it("各indexは1回だけ出力される(親子関係が複数primaryから共有されても重複しない)", () => {
    const items: ScoredAnchorItem[] = [
      { index: 0, score: 1, parentIndex: null }, // 共有される親
      { index: 1, score: 50, parentIndex: 0 },
      { index: 2, score: 60, parentIndex: 0 },
    ];
    const result = selectScoredAnchorReses(items, { target: 3, anchorDepth: 1, hardCap: 6 });
    expect(result.filter((i) => i === 0)).toHaveLength(1);
    expect(result).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(result).toHaveLength(3);
  });

  it("同scoreはindex昇順で決定論的にタイブレークする", () => {
    const items: ScoredAnchorItem[] = [
      { index: 3, score: 10, parentIndex: null },
      { index: 1, score: 10, parentIndex: null },
      { index: 2, score: 10, parentIndex: null },
    ];
    const result = selectScoredAnchorReses(items, { target: 2, anchorDepth: 1, hardCap: 5 });
    expect(result).toEqual([1, 2]);
  });
});
