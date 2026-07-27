import { describe, expect, it } from "vitest";
import { computeNextRunAt, getGenerationSource, getPipelineConfig } from "@/lib/pipeline/config";

describe("getPipelineConfig", () => {
  it("既定値（公開本数上限・実行間隔）を持つ", () => {
    const config = getPipelineConfig();
    expect(config.maxPublishPerRun).toBeGreaterThan(0);
    expect(config.intervalMs).toBeGreaterThan(0);
  });

  it("カテゴリ別公開本数上限(maxPublishPerCategory)の既定値を持つ(拡張E48)", () => {
    const config = getPipelineConfig();
    expect(config.maxPublishPerCategory).toBe(2);
  });

  it("PIPELINE_MAX_PUBLISH_PER_CATEGORY を設定すると上書きされる(拡張E48)", () => {
    const original = process.env.PIPELINE_MAX_PUBLISH_PER_CATEGORY;
    process.env.PIPELINE_MAX_PUBLISH_PER_CATEGORY = "3";
    try {
      const config = getPipelineConfig();
      expect(config.maxPublishPerCategory).toBe(3);
    } finally {
      if (original === undefined) delete process.env.PIPELINE_MAX_PUBLISH_PER_CATEGORY;
      else process.env.PIPELINE_MAX_PUBLISH_PER_CATEGORY = original;
    }
  });
});

describe("getGenerationSource（リファクタリングS5a F-S5a-2）", () => {
  it("env未設定時は既定で'post'を返す", () => {
    const original = process.env.GENERATION_SOURCE;
    delete process.env.GENERATION_SOURCE;
    try {
      expect(getGenerationSource()).toBe("post");
    } finally {
      if (original === undefined) delete process.env.GENERATION_SOURCE;
      else process.env.GENERATION_SOURCE = original;
    }
  });

  it("GENERATION_SOURCE=collectedのときは'collected'を返す", () => {
    const original = process.env.GENERATION_SOURCE;
    process.env.GENERATION_SOURCE = "collected";
    try {
      expect(getGenerationSource()).toBe("collected");
    } finally {
      if (original === undefined) delete process.env.GENERATION_SOURCE;
      else process.env.GENERATION_SOURCE = original;
    }
  });

  it("不正な値のときは既定の'post'にフォールバックする", () => {
    const original = process.env.GENERATION_SOURCE;
    process.env.GENERATION_SOURCE = "unknown";
    try {
      expect(getGenerationSource()).toBe("post");
    } finally {
      if (original === undefined) delete process.env.GENERATION_SOURCE;
      else process.env.GENERATION_SOURCE = original;
    }
  });
});

describe("computeNextRunAt", () => {
  it("前回実行時刻に間隔(ミリ秒)を加算した時刻を返す", () => {
    const last = new Date("2026-07-25T00:00:00.000Z");
    const next = computeNextRunAt(last, 60_000);
    expect(next.toISOString()).toBe("2026-07-25T00:01:00.000Z");
  });
});
