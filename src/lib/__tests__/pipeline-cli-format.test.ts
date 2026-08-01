/**
 * `scripts/pipeline.ts` のコンソール表示ロジック（src/lib/pipeline/cli-format.ts）の単体テスト。
 * admincms-S1 バグ修正: publicationStatus="review"/"scheduled" が「published」と誤表示され、
 * 実行サマリに要レビュー件数が出ていなかったのを、全値を正しく表示するように直した回帰テスト。
 */
import { describe, expect, it } from "vitest";
import { formatPublicationStatus, formatRunSummaryLine } from "@/lib/pipeline/cli-format";
import type { PostGenerationRunResult } from "@/lib/generation/post-pipeline";

type SuccessResult = Extract<PostGenerationRunResult, { status: "success" }>;

function successResult(
  publicationStatus: SuccessResult["publicationStatus"],
  heldReason?: string,
): SuccessResult {
  return {
    postId: "post-1",
    status: "success",
    articleId: "article-1",
    slug: "post-gen-post-1",
    publicationStatus,
    heldReason,
  };
}

describe("formatPublicationStatus", () => {
  it("published はそのまま published と表示する", () => {
    expect(formatPublicationStatus(successResult("published"))).toBe("published");
  });

  it("held は理由付きで表示する", () => {
    expect(formatPublicationStatus(successResult("held", "ng-word"))).toBe("held(理由:ng-word)");
  });

  it("review を published と誤表示せず要レビューと表示する（admincms-S1バグ修正）", () => {
    expect(formatPublicationStatus(successResult("review"))).toBe("review(要レビュー)");
  });

  it("scheduled を published と誤表示せず予約と表示する", () => {
    expect(formatPublicationStatus(successResult("scheduled"))).toBe("scheduled(予約)");
  });
});

describe("formatRunSummaryLine", () => {
  it("要レビュー件数を含めて実行サマリを組み立てる", () => {
    const line = formatRunSummaryLine({
      collectedCount: 10,
      candidateCount: 5,
      generationSucceeded: 4,
      generationFailed: 1,
      publishedCount: 2,
      heldCount: 1,
      reviewCount: 1,
      scheduledPublishedCount: 0,
    });
    expect(line).toContain("公開=2");
    expect(line).toContain("保留=1");
    expect(line).toContain("要レビュー=1");
    expect(line).toContain("予約公開昇格=0");
  });
});
