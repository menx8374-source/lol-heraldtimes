/**
 * カテゴリ別 公開ポリシー（admincms-S1 F1）の単体・結合テスト。
 * テスト観点: 未保存時の既定値（全カテゴリ要レビュー）、1カテゴリだけ変更したときの他カテゴリ不変、
 * 未知のカテゴリ名を渡したときの扱い、未認証呼び出しの拒否。
 */
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resolveAutoPublish,
  loadCategoryPolicyRows,
  getCategoryPoliciesForDisplay,
  setCategoryAutoPublish,
} from "@/lib/admin/category-policy";
import { CATEGORY_LABELS } from "@/lib/categories";
import { UnauthorizedError } from "@/lib/auth/basic-auth";
import type { AdminAuthContext } from "@/lib/admin/auth-context";

function authorizedContext(): AdminAuthContext {
  const header = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;
  return { authorizationHeader: header };
}
const UNAUTHORIZED: AdminAuthContext = { authorizationHeader: null };

describe("resolveAutoPublish（純関数）", () => {
  it("該当行が無いカテゴリは既定値(false=要レビュー)を返す", () => {
    expect(resolveAutoPublish([], "パッチ/メタ")).toBe(false);
  });

  it("該当行があればその値を返す", () => {
    expect(resolveAutoPublish([{ category: "パッチ/メタ", autoPublish: true }], "パッチ/メタ")).toBe(true);
  });

  it("未知のカテゴリ名は既定値(false)にフォールバックする", () => {
    expect(resolveAutoPublish([{ category: "パッチ/メタ", autoPublish: true }], "存在しないカテゴリ")).toBe(false);
  });
});

describe("カテゴリ別公開ポリシーの読み書き（DB結合）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(async () => {
    await prisma.categoryPublishPolicy.deleteMany();
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("未保存時はgetCategoryPoliciesForDisplayが全カテゴリを要レビュー(autoPublish=false)で返す", async () => {
    const policies = await getCategoryPoliciesForDisplay();
    expect(policies).toHaveLength(CATEGORY_LABELS.length);
    expect(policies.every((p) => p.autoPublish === false)).toBe(true);
    expect(policies.map((p) => p.category)).toEqual(CATEGORY_LABELS);
  });

  it("1カテゴリだけ自動公開に変更しても、他カテゴリは要レビューのまま変わらない", async () => {
    await setCategoryAutoPublish("パッチ/メタ", true, authorizedContext());

    const policies = await getCategoryPoliciesForDisplay();
    const patch = policies.find((p) => p.category === "パッチ/メタ");
    const others = policies.filter((p) => p.category !== "パッチ/メタ");
    expect(patch?.autoPublish).toBe(true);
    expect(others.every((p) => p.autoPublish === false)).toBe(true);
  });

  it("同じカテゴリを再度保存すると上書きされる(自動公開→要レビューに戻せる)", async () => {
    await setCategoryAutoPublish("パッチ/メタ", true, authorizedContext());
    await setCategoryAutoPublish("パッチ/メタ", false, authorizedContext());

    const rows = await loadCategoryPolicyRows();
    expect(rows).toHaveLength(1); // upsertのため行が増えない
    expect(rows[0]).toMatchObject({ category: "パッチ/メタ", autoPublish: false });
  });

  it("未認証コンテキストではsetCategoryAutoPublishがUnauthorizedErrorを投げ、DBを変更しない", async () => {
    await expect(setCategoryAutoPublish("パッチ/メタ", true, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
    const rows = await loadCategoryPolicyRows();
    expect(rows).toHaveLength(0);
  });

  it("未知のカテゴリ名で保存しても例外にならず、getCategoryPoliciesForDisplayの結果(定義済み6カテゴリ)には影響しない", async () => {
    await setCategoryAutoPublish("存在しないカテゴリ", true, authorizedContext());
    const policies = await getCategoryPoliciesForDisplay();
    expect(policies.every((p) => p.autoPublish === false)).toBe(true);
  });
});
