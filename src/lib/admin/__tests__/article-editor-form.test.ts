import { describe, expect, it } from "vitest";
import {
  blockToDraft,
  createDraftBlock,
  draftToRawBlock,
  draftsToArticleBody,
  draftsToRawBlocks,
  insertItemAfter,
  moveItem,
  removeItemAt,
  validateReactionAnchors,
  type BlockDraft,
} from "@/lib/admin/article-editor-form";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";

/** テスト用: reaction draftを型を保ったまま組み立てるヘルパー（spreadでの型幅拡がりを避ける）。 */
function reactionDraft(overrides: Partial<Extract<BlockDraft, { type: "reaction" }>>): BlockDraft {
  const base = createDraftBlock("reaction") as Extract<BlockDraft, { type: "reaction" }>;
  return { ...base, ...overrides };
}

describe("article-editor-form: フォーム⇔ブロック変換", () => {
  it("各反応系・共通ブロック種別のcreateDraftBlockが最小入力を埋めれば検証を通る", () => {
    const cases: { type: BlockDraft["type"]; fill: (d: BlockDraft) => BlockDraft }[] = [
      {
        type: "reaction",
        fill: (d) =>
          d.type === "reaction" ? { ...d, number: "1", name: "名無しさん", lines: [{ text: "本文", emphasis: "", original: "" }] } : d,
      },
      { type: "redditSource", fill: (d) => (d.type === "redditSource" ? { ...d, title: "元スレ", url: "https://reddit.com/r/x" } : d) },
      { type: "heading", fill: (d) => (d.type === "heading" ? { ...d, text: "見出し" } : d) },
      { type: "paragraph", fill: (d) => (d.type === "paragraph" ? { ...d, text: "段落" } : d) },
      { type: "quote", fill: (d) => (d.type === "quote" ? { ...d, text: "引用" } : d) },
      { type: "embed", fill: (d) => (d.type === "embed" ? { ...d, provider: "youtube", url: "https://youtube.com/watch?v=abcdefghijk" } : d) },
      { type: "image", fill: (d) => (d.type === "image" ? { ...d, url: "https://example.com/a.png", alt: "説明" } : d) },
    ];
    for (const c of cases) {
      const draft = c.fill(createDraftBlock(c.type as Exclude<BlockDraft["type"], "raw">));
      expect(() => draftsToArticleBody([draft])).not.toThrow();
    }
  });

  it("emphasisColorはemphasis:falseのとき出力しない（強調オフ→色の孤児化を防ぐ・S3 code-review修正）", () => {
    const line = { text: "本文", emphasis: "" as const, original: "" };
    // 強調オフ＋色あり（UIで強調を外したが色selectの値が残った状態）→ emphasis/emphasisColorとも出力しない。
    const off = reactionDraft({ number: "1", name: "名無しさん", lines: [line], emphasis: false, emphasisColor: "red" });
    const rawOff = draftToRawBlock(off) as Record<string, unknown>;
    expect(rawOff).not.toHaveProperty("emphasisColor");
    expect(rawOff).not.toHaveProperty("emphasis");
    // 強調オン＋色あり → 両方保持。
    const on = reactionDraft({ number: "1", name: "名無しさん", lines: [line], emphasis: true, emphasisColor: "blue" });
    expect(draftToRawBlock(on)).toMatchObject({ emphasis: true, emphasisColor: "blue" });
  });

  it("往復同一性: 各種ブロックをblockToDraft→draftToRawBlock→parseArticleBodyしても元と一致する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 3,
        name: "海外プレイヤーさん",
        lines: [
          { text: "翻訳文", original: "original text", emphasis: "red" },
          { text: "普通の行" },
        ],
        anchors: [1, 2],
        emphasis: true,
        emphasisColor: "blue",
      },
      { type: "redditSource", title: "元スレタイトル", author: "someone", subreddit: "leagueoflegends", url: "https://reddit.com/r/leagueoflegends/x" },
      { type: "heading", text: "見出しテキスト", anchor: "section-1" },
      { type: "paragraph", text: "段落テキスト" },
      { type: "quote", text: "引用テキスト", source: "出典元" },
      { type: "embed", provider: "youtube", url: "https://youtube.com/watch?v=abcdefghijk", caption: "動画キャプション" },
      { type: "image", url: "https://example.com/img.png", alt: "画像alt", credit: "撮影者クレジット" },
      // 任意フィールド無しの最小構成も混ぜる。
      { type: "reaction", number: 1, name: "名無し", lines: [{ text: "最小レス" }] },
      { type: "heading", text: "anchor無し見出し" },
      { type: "quote", text: "source無し引用" },
    ];
    const drafts = blocks.map(blockToDraft);
    const raw = draftsToRawBlocks(drafts);
    const roundTripped = parseArticleBody(raw);
    expect(roundTripped).toEqual(blocks);
  });

  it("S4未対応ブロック(toc)はraw draftとしてそのまま素通しされる", () => {
    const block: ArticleBodyBlock = { type: "toc", items: [{ label: "章1", anchor: "a1" }] };
    const draft = blockToDraft(block);
    expect(draft.type).toBe("raw");
    const raw = draftToRawBlock(draft);
    expect(parseArticleBody([raw])).toEqual([block]);
  });
});

describe("article-editor-form: 検証エラーの伝播", () => {
  it("レスの本文行が空だと、どのブロックのlinesかが分かるメッセージで拒否される", () => {
    const draft = reactionDraft({ number: "1", name: "名無し", lines: [{ text: "", emphasis: "", original: "" }] });
    expect(() => draftsToArticleBody([draft])).toThrow(/lines\[0\]のtextが空/);
  });

  it("存在しないアンカー番号は、どのブロックかが分かるメッセージで拒否される", () => {
    const drafts: BlockDraft[] = [
      reactionDraft({ number: "1", name: "A", lines: [{ text: "本文", emphasis: "", original: "" }] }),
      reactionDraft({ number: "2", name: "B", lines: [{ text: "本文2", emphasis: "", original: "" }], anchors: "1,99" }),
    ];
    expect(() => draftsToArticleBody(drafts)).toThrow(/本文ブロック\[1\]のanchorsに存在しないレス番号があります: 99/);
  });

  it("存在するアンカーのみなら保存できる", () => {
    const drafts: BlockDraft[] = [
      reactionDraft({ number: "1", name: "A", lines: [{ text: "本文", emphasis: "", original: "" }] }),
      reactionDraft({ number: "2", name: "B", lines: [{ text: "本文2", emphasis: "", original: "" }], anchors: "1" }),
    ];
    const body = draftsToArticleBody(drafts);
    expect(body[1]).toMatchObject({ anchors: [1] });
  });

  it("reddit以外のURLは拒否される", () => {
    const draft = { ...createDraftBlock("redditSource"), title: "タイトル", url: "https://example.com/x" };
    expect(() => draftsToArticleBody([draft])).toThrow(/redditSource url/);
  });

  it("ホワイトリスト外の埋め込みURLは拒否される", () => {
    const draft = { ...createDraftBlock("embed"), provider: "youtube", url: "https://evil.example.com/watch?v=abcdefghijk" };
    expect(() => draftsToArticleBody([draft])).toThrow(/埋め込みurl/);
  });

  it("ブロック0件は拒否される", () => {
    expect(() => draftsToArticleBody([])).toThrow(/ブロックの配列（1件以上）/);
  });

  it("validateReactionAnchorsは単体でも同じ検証を行う", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "reaction", number: 1, name: "A", lines: [{ text: "x" }], anchors: [5] }];
    expect(() => validateReactionAnchors(blocks)).toThrow(/anchorsに存在しないレス番号があります: 5/);
  });
});

describe("article-editor-form: 汎用配列操作（並べ替え・削除・挿入位置）", () => {
  it("moveItemは指定indexを上下に入れ替える", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(items, 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("moveItemは範囲外方向への移動では変化しない", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(items, 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("removeItemAtは指定indexを取り除く", () => {
    expect(removeItemAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("insertItemAfterはnullで末尾、indexでその直後に挿入する", () => {
    expect(insertItemAfter(["a", "b"], null, "z")).toEqual(["a", "b", "z"]);
    expect(insertItemAfter(["a", "b", "c"], 0, "z")).toEqual(["a", "z", "b", "c"]);
  });
});
