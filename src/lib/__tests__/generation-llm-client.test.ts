import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 成長G4 F-G4-1: Anthropic SDKをモックし、`messages.create` に渡る引数(system/user)と
 * レスポンス(usage含む)を検証する。実APIは呼ばない。
 */
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropicClient {
    messages = { create: createMock };
  }
  return { default: MockAnthropicClient };
});

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

describe("AnthropicLLMClient.generate（成長G4 F-G4-1: プロンプトキャッシュ対応、SDKモック）", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-dummy-key";
    createMock.mockReset();
  });

  it("systemが非空のとき、cache_control付きテキストブロック配列としてmessages.createに渡る", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "回答です" }],
      usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const client = new AnthropicLLMClient();
    const result = await client.generate([
      { role: "system", content: "これはsystem指示です" },
      { role: "user", content: "これはuser本文です" },
    ]);

    expect(result).toBe("回答です");
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.system).toEqual([
      { type: "text", text: "これはsystem指示です", cache_control: { type: "ephemeral" } },
    ]);
    expect(callArgs.messages).toEqual([{ role: "user", content: "これはuser本文です" }]);
  });

  it("systemが空(system役割メッセージ無し)のとき、systemキー自体を付けない", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "回答です" }],
      usage: { input_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    });
    const client = new AnthropicLLMClient();
    await client.generate([{ role: "user", content: "user本文のみ" }]);

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("system");
  });

  it("API呼び出しが失敗した場合は例外を投げず空文字を返す(本体を止めない原則)", async () => {
    createMock.mockRejectedValue(new Error("simulated Anthropic API error"));
    const client = new AnthropicLLMClient();
    const result = await client.generate([
      { role: "system", content: "system指示" },
      { role: "user", content: "user本文" },
    ]);
    expect(result).toBe("");
  });
});
