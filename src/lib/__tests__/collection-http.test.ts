import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchShiftJisTextSafe, fetchTextSafe } from "@/lib/collection/adapters/http";

// "こんにちは、5ch。" をShift_JIS(Windows-31J/CP932)でエンコードした生バイト列(16進)。
// UTF-8として読む(既定のfetchTextSafe/res.text()相当)と文字化けし、Shift_JISとして読むと
// 元の文字列に一致することを検証する(拡張E23の受け入れ基準2)。
const SJIS_HELLO_HEX = "82b182f182c982bf82cd81413563688142";
const SJIS_HELLO_TEXT = "こんにちは、5ch。";

function bufferResponse(bodyHex: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(bodyHex, "hex")).buffer,
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe("fetchShiftJisTextSafe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Shift_JISのバイト列を正しい日本語文字列にデコードする(UTF-8だと文字化けする入力が一致する)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => bufferResponse(SJIS_HELLO_HEX)),
    );

    const result = await fetchShiftJisTextSafe("https://example.test/subject.txt");
    expect(result).toBe(SJIS_HELLO_TEXT);

    // 同じ生バイト列をUTF-8として解釈すると元の文字列には一致しない(文字化けする)ことの確認
    const utf8Decoded = new TextDecoder("utf-8").decode(Buffer.from(SJIS_HELLO_HEX, "hex"));
    expect(utf8Decoded).not.toBe(SJIS_HELLO_TEXT);
  });

  it("HTTPエラー時はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => bufferResponse("", 500)),
    );
    await expect(fetchShiftJisTextSafe("https://example.test/subject.txt")).resolves.toBeNull();
  });

  it("ネットワーク断はnullを返す(例外を投げない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetchShiftJisTextSafe("https://example.test/subject.txt")).resolves.toBeNull();
  });
});

describe("fetchTextSafe(回帰: UTF-8既定は不変)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("res.text()(UTF-8前提)をそのまま返す(reddit/riot/clip等の既存挙動は変わらない)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textResponse("こんにちは")),
    );
    await expect(fetchTextSafe("https://example.test/api")).resolves.toBe("こんにちは");
  });
});
