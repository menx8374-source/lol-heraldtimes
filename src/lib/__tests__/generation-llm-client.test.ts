import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnthropicLLMClient, MockLLMClient, getLLMClient } from "@/lib/generation/llm-client";

/**
 * 拡張E24 F-E24-1: getLLMClient の mock/live 切替配線を検証する。
 * 実APIは叩かない（AnthropicLLMClient.generate自体はここでは呼ばない。配線のみの確認）。
 */
describe("getLLMClient（mock/live切替、拡張E24 F-E24-1）", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  it("mode省略・GENERATION_MODE未設定(既定mock)時はMockLLMClientを返す", () => {
    const client = getLLMClient("mock");
    expect(client).toBeInstanceOf(MockLLMClient);
  });

  it("mode='live'かつANTHROPIC_API_KEY未設定時はMockLLMClientにフォールバックする(例外を投げない)", () => {
    expect(() => getLLMClient("live")).not.toThrow();
    const client = getLLMClient("live");
    expect(client).toBeInstanceOf(MockLLMClient);
  });

  it("mode='live'かつANTHROPIC_API_KEY設定時はAnthropicLLMClientを返す", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-dummy-key";
    const client = getLLMClient("live");
    expect(client).toBeInstanceOf(AnthropicLLMClient);
  });
});

describe("MockLLMClient（reaction-selectタスク、拡張E25 F-E25-1）", () => {
  it("渡された全レスのindexをkeepに、emphasizeは空でJSON文字列を返す(決定論的モック)", async () => {
    const client = new MockLLMClient();
    const task = {
      kind: "reaction-select" as const,
      title: "テスト",
      reses: [
        { index: 0, number: 1, text: "レス1" },
        { index: 1, number: 2, text: "レス2" },
      ],
    };
    const raw = await client.generate([{ role: "user", content: JSON.stringify(task) }]);
    expect(JSON.parse(raw)).toEqual({ keep: [0, 1], emphasize: [] });
  });
});

describe("AnthropicLLMClient.generate（信頼境界のエラーハンドリング、実APIは叩かない）", () => {
  it("userメッセージが1件も無い場合はAPIを呼ばずに空文字を返す", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-dummy-key";
    const client = new AnthropicLLMClient();
    const result = await client.generate([{ role: "system", content: "system only" }]);
    expect(result).toBe("");
  });
});
