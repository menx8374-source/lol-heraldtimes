import { describe, expect, it } from "vitest";
import {
  validateCommentInput,
  commentValidationMessage,
  moderateCommentContent,
  extractCommentAnchors,
  commentBodyToLines,
  isHoneypotFilled,
  isRapidDuplicate,
  buildCommentExcerpt,
  DEFAULT_COMMENT_NAME,
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_NAME_MAX_LENGTH,
} from "@/lib/comments";

describe("validateCommentInput（コメント投稿の入力検証, 拡張E2）", () => {
  it("本文のみでも有効。名前未入力は既定名になる", () => {
    const result = validateCommentInput({ body: "神プレイすぎる" });
    expect(result).toEqual({ ok: true, value: { name: DEFAULT_COMMENT_NAME, body: "神プレイすぎる" } });
  });

  it("名前を指定すればそのまま使われる", () => {
    const result = validateCommentInput({ name: "国内プレイヤーさん", body: "同意" });
    expect(result).toEqual({ ok: true, value: { name: "国内プレイヤーさん", body: "同意" } });
  });

  it("前後の空白はトリムされる", () => {
    const result = validateCommentInput({ name: "  太郎  ", body: "  こんにちは  " });
    expect(result).toEqual({ ok: true, value: { name: "太郎", body: "こんにちは" } });
  });

  it("本文が空（空白のみ含む）は empty_body", () => {
    expect(validateCommentInput({ body: "" })).toEqual({ ok: false, error: "empty_body" });
    expect(validateCommentInput({ body: "   " })).toEqual({ ok: false, error: "empty_body" });
  });

  it("本文が最大長を超えると body_too_long", () => {
    const result = validateCommentInput({ body: "あ".repeat(COMMENT_BODY_MAX_LENGTH + 1) });
    expect(result).toEqual({ ok: false, error: "body_too_long" });
  });

  it("本文がちょうど最大長なら有効", () => {
    const body = "あ".repeat(COMMENT_BODY_MAX_LENGTH);
    const result = validateCommentInput({ body });
    expect(result.ok).toBe(true);
  });

  it("名前が最大長を超えると name_too_long", () => {
    const result = validateCommentInput({ name: "あ".repeat(COMMENT_NAME_MAX_LENGTH + 1), body: "本文" });
    expect(result).toEqual({ ok: false, error: "name_too_long" });
  });

  it("commentValidationMessageは各エラーに穏当な日本語メッセージを返す", () => {
    expect(commentValidationMessage("empty_body")).toContain("入力してください");
    expect(commentValidationMessage("body_too_long")).toContain(String(COMMENT_BODY_MAX_LENGTH));
    expect(commentValidationMessage("name_too_long")).toContain(String(COMMENT_NAME_MAX_LENGTH));
  });
});

describe("moderateCommentContent（コメントの安全判定, 拡張E2・F9のNGワード/中傷検出を再利用）", () => {
  it("安全な通常コメントはpublished", () => {
    expect(moderateCommentContent(DEFAULT_COMMENT_NAME, "このパッチ調整は良いと思う")).toEqual({
      status: "published",
    });
  });

  it("NGワードを含むコメントはheldになりreasonがng_word", () => {
    const result = moderateCommentContent(DEFAULT_COMMENT_NAME, "このチャンピオンはカスだと思う");
    expect(result).toEqual({ status: "held", reason: "ng_word" });
  });

  it("特定個人への中傷を含むコメントはheldになりreasonがpersonal_attack", () => {
    const result = moderateCommentContent(DEFAULT_COMMENT_NAME, "田中選手は本当に無能だと思う");
    expect(result).toEqual({ status: "held", reason: "personal_attack" });
  });

  it("名前欄のNGワードも検出対象になる", () => {
    const result = moderateCommentContent("カス", "普通のコメントです");
    expect(result).toEqual({ status: "held", reason: "ng_word" });
  });
});

describe("extractCommentAnchors（本文からの>>Nアンカー抽出, 拡張E2）", () => {
  it("複数行にまたがる>>Nを出現順・重複排除で抽出する", () => {
    expect(extractCommentAnchors(">>1\n同意です\n>>3も参照")).toEqual([1, 3]);
  });

  it(">>Nが無ければ空配列", () => {
    expect(extractCommentAnchors("普通のコメント")).toEqual([]);
  });
});

describe("commentBodyToLines（コメント本文のレス風行分割, 拡張E2）", () => {
  it("空行を除去し、>>Nを含む行をorange強調にする", () => {
    const result = commentBodyToLines(">>1\n\n同意です\n");
    expect(result).toEqual([
      { text: ">>1", emphasis: "orange" },
      { text: "同意です" },
    ]);
  });

  it(">>Nを含まない行は強調なし", () => {
    expect(commentBodyToLines("普通のコメント")).toEqual([{ text: "普通のコメント" }]);
  });
});

describe("isHoneypotFilled（bot簡易検出, 拡張E2）", () => {
  it("未入力・空白のみはfalse", () => {
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled("")).toBe(false);
    expect(isHoneypotFilled("   ")).toBe(false);
  });

  it("何か入力されていればtrue", () => {
    expect(isHoneypotFilled("http://spam.example.com")).toBe(true);
  });
});

describe("isRapidDuplicate（連投スパム簡易判定, 拡張E2）", () => {
  const now = new Date("2026-07-25T12:00:00+09:00");

  it("直前の投稿が無ければfalse", () => {
    expect(isRapidDuplicate("こんにちは", null, now)).toBe(false);
  });

  it("直前と同一本文かつ時間窓内ならtrue", () => {
    const last = { body: "こんにちは", createdAt: new Date(now.getTime() - 3000) };
    expect(isRapidDuplicate("こんにちは", last, now)).toBe(true);
  });

  it("直前と同一本文でも時間窓外ならfalse", () => {
    const last = { body: "こんにちは", createdAt: new Date(now.getTime() - 60_000) };
    expect(isRapidDuplicate("こんにちは", last, now, 10_000)).toBe(false);
  });

  it("本文が異なればfalse", () => {
    const last = { body: "こんにちは", createdAt: new Date(now.getTime() - 1000) };
    expect(isRapidDuplicate("こんばんは", last, now)).toBe(false);
  });
});

describe("buildCommentExcerpt（新着コメントウィジェット用の抜粋, 拡張E2）", () => {
  it("改行・連続空白を1つの半角スペースにまとめる", () => {
    expect(buildCommentExcerpt("1行目\n2行目   です")).toBe("1行目 2行目 です");
  });

  it("上限以内はそのまま返す", () => {
    expect(buildCommentExcerpt("短いコメント")).toBe("短いコメント");
  });

  it("上限を超えると省略記号付きで切り詰める", () => {
    const long = "あ".repeat(50);
    const result = buildCommentExcerpt(long);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(41); // 40文字 + "…"
  });
});
