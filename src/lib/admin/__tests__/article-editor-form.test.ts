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
  validateTocAnchors,
  type BlockDraft,
  type PatchChangeDraft,
  type PatchChangeGroupDraft,
} from "@/lib/admin/article-editor-form";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";

/** テスト用: reaction draftを型を保ったまま組み立てるヘルパー（spreadでの型幅拡がりを避ける）。 */
function reactionDraft(overrides: Partial<Extract<BlockDraft, { type: "reaction" }>>): BlockDraft {
  const base = createDraftBlock("reaction") as Extract<BlockDraft, { type: "reaction" }>;
  return { ...base, ...overrides };
}

/** テスト用: heading draftを型を保ったまま組み立てるヘルパー。 */
function headingDraft(overrides: Partial<Extract<BlockDraft, { type: "heading" }>>): BlockDraft {
  const base = createDraftBlock("heading") as Extract<BlockDraft, { type: "heading" }>;
  return { ...base, ...overrides };
}

/** テスト用: patchChange draftを型を保ったまま組み立てるヘルパー。 */
function patchChangeDraft(overrides: Partial<Extract<BlockDraft, { type: "patchChange" }>>): BlockDraft {
  const base = createDraftBlock("patchChange") as Extract<BlockDraft, { type: "patchChange" }>;
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
      { type: "linkButton", fill: (d) => (d.type === "linkButton" ? { ...d, url: "https://example.com/patch-notes", label: "公式パッチノート" } : d) },
      { type: "patchChange", fill: (d) => (d.type === "patchChange" ? { ...d, targetName: "コーキ" } : d) },
    ];
    for (const c of cases) {
      const draft = c.fill(createDraftBlock(c.type));
      expect(() => draftsToArticleBody([draft])).not.toThrow();
    }
  });

  it("toc(1件以上のitems)はheadingのanchorと対応していれば検証を通る", () => {
    const heading = headingDraft({ text: "主な強化", anchor: "sec-1" });
    const toc: BlockDraft = { type: "toc", items: [{ label: "主な強化", anchor: "sec-1" }] };
    expect(() => draftsToArticleBody([heading, toc])).not.toThrow();
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
      { type: "linkButton", url: "https://example.com/patch-notes", label: "公式パッチノートを読む" },
      { type: "toc", items: [{ label: "見出しテキストへ", anchor: "section-1" }] },
      {
        type: "patchChange",
        targetName: "コーキ",
        targetIconUrl: "https://ddragon.leagueoflegends.com/cdn/img/champion/Corki.png",
        targetKind: "champion",
        direction: "buff",
        intent: "試合終盤のコーキの出撃時の火力を少し高めました。",
        groups: [
          {
            abilityKey: "base",
            changes: [{ stat: "レベルアップごとの攻撃力", before: "2", after: "2.5" }],
          },
          {
            abilityKey: "R",
            abilityName: "R - 連発ミサイル",
            abilityIconUrl: "https://ddragon.leagueoflegends.com/cdn/img/spell/MissileBarrage.png",
            changes: [
              { stat: "通常攻撃による残りリチャージ時間短縮量", before: "2秒～4秒", after: "2秒～6秒" },
              { text: "R使用中に移動できるようになりました。" },
              { stat: "備考", text: "エフェクトの視認性を改善しました。" },
            ],
          },
        ],
      },
      // groups/changesが空の最小構成も混ぜる（誤帰属ゼロの数値なし対象、article-body.tsが許容する形）。
      { type: "patchChange", targetName: "アジール", targetKind: "champion", direction: "adjust", groups: [] },
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

  it("画像のaltが空だと保存拒否される", () => {
    const draft: BlockDraft = { type: "image", url: "https://example.com/a.png", alt: "", credit: "" };
    expect(() => draftsToArticleBody([draft])).toThrow(/画像altが空/);
  });

  it("リンクボタンのurlがhttps以外だと保存拒否される", () => {
    const httpDraft: BlockDraft = { type: "linkButton", url: "http://example.com/notes", label: "非公式" };
    expect(() => draftsToArticleBody([httpDraft])).toThrow(/linkButton url.*https必須/);
    const jsDraft: BlockDraft = { type: "linkButton", url: "javascript:alert(1)", label: "危険" };
    expect(() => draftsToArticleBody([jsDraft])).toThrow(/linkButton url.*https必須/);
  });

  it("目次(toc)に記事内に存在しないアンカーを指定すると、どのブロックか分かるメッセージで拒否される", () => {
    const heading = headingDraft({ text: "見出し", anchor: "sec-1" });
    const toc: BlockDraft = { type: "toc", items: [{ label: "存在しない章", anchor: "sec-999" }] };
    expect(() => draftsToArticleBody([heading, toc])).toThrow(
      /本文ブロック\[1\]のtoc itemsに存在しないアンカーがあります: sec-999/,
    );
  });

  it("validateTocAnchorsは単体でも同じ検証を行う", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "toc", items: [{ label: "章", anchor: "missing" }] }];
    expect(() => validateTocAnchors(blocks)).toThrow(/toc itemsに存在しないアンカーがあります: missing/);
  });

  it("patchChangeの数値変更でbefore/afterいずれかが空だと、どのグループ・何行目かが分かるメッセージで拒否される", () => {
    const draft = patchChangeDraft({
      targetName: "コーキ",
      groups: [
        {
          abilityKey: "",
          abilityName: "",
          abilityIconUrl: "",
          changes: [{ kind: "numeric", stat: "攻撃力", before: "", after: "2.5", text: "" }],
        },
      ],
    });
    expect(() => draftsToArticleBody([draft])).toThrow(
      /groups\[0\]のchanges\[0\]がstat\/before\/after\(数値変更\)・text\(記述式変更\)のいずれも満たしません/,
    );
  });

  it("patchChangeのtargetKind/directionは定義済みの語彙以外を受け付けない（不正なJSON入力を想定）", () => {
    // 不正な語彙はUIのselectでは選べないが、blocksJson(フォーム送信値)は任意の文字列を受け付けうるため、
    // parseArticleBody側で最終的に弾かれることを確認する（`as unknown as BlockDraft`で意図的に型を緩める）。
    const invalidKind = {
      ...patchChangeDraft({ targetName: "x" }),
      targetKind: "unknown",
    } as unknown as BlockDraft;
    expect(() => draftsToArticleBody([invalidKind])).toThrow(/targetKindが不正/);
    const invalidDirection = {
      ...patchChangeDraft({ targetName: "x" }),
      direction: "op",
    } as unknown as BlockDraft;
    expect(() => draftsToArticleBody([invalidDirection])).toThrow(/directionが不正/);
  });
});

describe("article-editor-form: patchChangeの組み立て（グループ/変更行の追加・削除・種別判別）", () => {
  it("グループの追加(insertItemAfter)・削除(removeItemAt)の結果が期待した構造になる", () => {
    const group1: PatchChangeGroupDraft = {
      abilityKey: "Q",
      abilityName: "Q",
      abilityIconUrl: "",
      changes: [{ kind: "numeric", stat: "ダメージ", before: "80", after: "100", text: "" }],
    };
    const group2: PatchChangeGroupDraft = {
      abilityKey: "base",
      abilityName: "",
      abilityIconUrl: "",
      changes: [{ kind: "descriptive", stat: "", before: "", after: "", text: "説明文" }],
    };
    const afterAdd = insertItemAfter([group1], 0, group2);
    expect(afterAdd).toEqual([group1, group2]);
    const afterRemove = removeItemAt(afterAdd, 0);
    expect(afterRemove).toEqual([group2]);

    const draft = patchChangeDraft({ targetName: "テスト対象", groups: afterRemove });
    const body = draftsToArticleBody([draft]);
    expect(body[0]).toMatchObject({
      groups: [{ abilityKey: "base", changes: [{ text: "説明文" }] }],
    });
  });

  it("変更行の追加(insertItemAfter)・削除(removeItemAt)の結果が期待した構造になる", () => {
    const numeric: PatchChangeDraft = { kind: "numeric", stat: "体力", before: "500", after: "550", text: "" };
    const descriptive: PatchChangeDraft = { kind: "descriptive", stat: "", before: "", after: "", text: "追加の説明" };
    const afterAdd = insertItemAfter<PatchChangeDraft>([numeric], 0, descriptive);
    expect(afterAdd).toEqual([numeric, descriptive]);
    const afterRemove = removeItemAt(afterAdd, 0);
    expect(afterRemove).toEqual([descriptive]);
  });

  it("数値変更(stat/before/after全非空)と記述式変更(text非空)の判別が入出力で正しい", () => {
    const numericBlock: ArticleBodyBlock = {
      type: "patchChange",
      targetName: "コーキ",
      targetKind: "champion",
      direction: "buff",
      groups: [{ changes: [{ stat: "攻撃力", before: "2", after: "2.5" }] }],
    };
    const descriptiveBlock: ArticleBodyBlock = {
      type: "patchChange",
      targetName: "コーキ",
      targetKind: "champion",
      direction: "buff",
      groups: [{ changes: [{ text: "R使用中に移動できるようになりました。" }] }],
    };
    const descriptiveWithLabelBlock: ArticleBodyBlock = {
      type: "patchChange",
      targetName: "コーキ",
      targetKind: "champion",
      direction: "buff",
      groups: [{ changes: [{ stat: "備考", text: "エフェクトの視認性を改善しました。" }] }],
    };
    for (const block of [numericBlock, descriptiveBlock, descriptiveWithLabelBlock]) {
      const draft = blockToDraft(block);
      expect(parseArticleBody(draftsToRawBlocks([draft]))).toEqual([block]);
    }
    // draft.kindがdraftToRawBlockの出力(数値=stat/before/after、記述式=text＋任意stat)に正しく反映される。
    const numericDraft = blockToDraft(numericBlock);
    expect(numericDraft.type === "patchChange" && numericDraft.groups[0].changes[0].kind).toBe("numeric");
    const descriptiveDraft = blockToDraft(descriptiveBlock);
    expect(descriptiveDraft.type === "patchChange" && descriptiveDraft.groups[0].changes[0].kind).toBe("descriptive");
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
