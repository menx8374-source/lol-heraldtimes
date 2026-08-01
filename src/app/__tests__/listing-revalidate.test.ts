/**
 * 一覧ページ（revalidate-S1 F-RV1-1、A）が静的な `revalidate` exportを持つことの検証（ブリーフ テスト4）。
 * 実描画はしない（各pageの既存描画テストはこのファイルの対象外）。値は共有定数と一致することを確認する。
 */
import { describe, expect, it } from "vitest";
import { LISTING_REVALIDATE_SECONDS } from "@/lib/revalidate-config";

describe("一覧ページの export const revalidate（revalidate-S1 F-RV1-1）", () => {
  it.each([
    ["/ (home)", () => import("@/app/page")],
    ["/category/[slug]", () => import("@/app/category/[slug]/page")],
    ["/tags", () => import("@/app/tags/page")],
    ["/tags/[tag]", () => import("@/app/tags/[tag]/page")],
    ["/patches", () => import("@/app/patches/page")],
    ["/patches/[version]", () => import("@/app/patches/[version]/page")],
    ["/archive", () => import("@/app/archive/page")],
    ["/archive/[key]", () => import("@/app/archive/[key]/page")],
    ["/tier", () => import("@/app/tier/page")],
    ["/champions", () => import("@/app/champions/page")],
    ["/champions/[slug]", () => import("@/app/champions/[slug]/page")],
  ])("%s が revalidate = LISTING_REVALIDATE_SECONDS をexportする", async (_label, load) => {
    const mod = await load();
    expect((mod as { revalidate?: number }).revalidate).toBe(LISTING_REVALIDATE_SECONDS);
  });
});
