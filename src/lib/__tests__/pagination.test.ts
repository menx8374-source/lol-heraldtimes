import { describe, expect, it } from "vitest";
import {
  clampPage,
  computeTotalPages,
  parsePageParam,
  paginateArray,
  paginationOffset,
} from "@/lib/pagination";

describe("parsePageParam", () => {
  it("未指定は1ページ目にする", () => {
    expect(parsePageParam(undefined)).toBe(1);
  });

  it("正の整数文字列はそのまま数値化する", () => {
    expect(parsePageParam("3")).toBe(3);
  });

  it("0以下・小数・非数値は1にフォールバックする", () => {
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-1")).toBe(1);
    expect(parsePageParam("1.5")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
  });
});

describe("computeTotalPages", () => {
  it("ページサイズちょうどで割り切れる件数は正しいページ数になる", () => {
    expect(computeTotalPages(40, 20)).toBe(2);
  });

  it("端数がある件数は切り上げる", () => {
    expect(computeTotalPages(41, 20)).toBe(3);
  });

  it("0件のときも最低1ページを返す", () => {
    expect(computeTotalPages(0, 20)).toBe(1);
  });
});

describe("clampPage", () => {
  it("範囲内はそのまま返す", () => {
    expect(clampPage(2, 5)).toBe(2);
  });

  it("0以下は1にクランプする", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it("総ページ数を超える場合は最終ページにクランプする", () => {
    expect(clampPage(99, 5)).toBe(5);
  });
});

describe("paginationOffset", () => {
  it("1ページ目のオフセットは0", () => {
    expect(paginationOffset(1, 20)).toBe(0);
  });

  it("2ページ目はページサイズ分オフセットする", () => {
    expect(paginationOffset(2, 20)).toBe(20);
  });
});

describe("paginateArray", () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);

  it("1ページ目はページサイズ分だけ切り出す", () => {
    const result = paginateArray(items, 1, 20);
    expect(result.items).toEqual(items.slice(0, 20));
    expect(result.totalCount).toBe(45);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(1);
  });

  it("最終ページは端数分だけ返す", () => {
    const result = paginateArray(items, 3, 20);
    expect(result.items).toEqual(items.slice(40, 45));
    expect(result.items).toHaveLength(5);
  });

  it("範囲外のページ番号は最終ページにクランプして返す", () => {
    const result = paginateArray(items, 99, 20);
    expect(result.page).toBe(3);
    expect(result.items).toEqual(items.slice(40, 45));
  });

  it("0件の配列は空配列・総ページ数1・ページ1を返す", () => {
    const result = paginateArray([], 1, 20);
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });
});
