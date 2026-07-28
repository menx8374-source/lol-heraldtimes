import { describe, expect, it } from "vitest";
import { classifyChange, classifyChampion, composeArticleBody } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { blockText } from "@/lib/article-body";

/**
 * 成長G3（パッチ記事のlol-times型化）: バフ/ナーフ/調整3分類・冒頭サマリ・目次のテスト。
 * F-G3-1（分類）・F-G3-2（3グループ振り分け）・F-G3-3（冒頭サマリ）・F-G3-4（目次）に対応する。
 * すべてAI不使用・純ルールのため、実ネット・LLM呼び出しに依存しない。
 */

describe("classifyChange（バフ/ナーフ/調整/判定不能の機械分類、成長G3 F-G3-1）", () => {
  it("数値が増える(反転語なし)はbuff", () => {
    expect(classifyChange("攻撃力: 55 ⇒ 58")).toBe("buff");
  });

  it("数値が減る(反転語なし)はnerf", () => {
    expect(classifyChange("確定ダメージ: 150/250/350 ⇒ 130/230/330")).toBe("nerf");
  });

  it("前後が同値ならadjust", () => {
    expect(classifyChange("シールド量: 100 ⇒ 100")).toBe("adjust");
  });

  it("数値が抽出できない変更はunknown", () => {
    expect(classifyChange("パッシブ: 効果の説明文が明確化されました")).toBe("unknown");
  });

  it("⇒を含まない行はunknown", () => {
    expect(classifyChange("これはただの説明文です")).toBe("unknown");
  });

  it("スラッシュ区切りの複数値(50/70/90 ⇒ 55/75/95)は合計比較でbuff", () => {
    expect(classifyChange("Qのダメージ 50/70/90 ⇒ 55/75/95")).toBe("buff");
  });

  it("反転ステータス: クールダウンが減る(12 ⇒ 10)はbuff", () => {
    expect(classifyChange("クールダウン 12 ⇒ 10")).toBe("buff");
  });

  it("反転ステータス: クールダウンが増える(10 ⇒ 12)はnerf", () => {
    expect(classifyChange("クールダウン 10 ⇒ 12")).toBe("nerf");
  });

  it("反転ステータス: マナが増える(50 ⇒ 60)はnerf", () => {
    expect(classifyChange("マナ 50 ⇒ 60")).toBe("nerf");
  });

  it("反転ステータス: マナが減る(60 ⇒ 50)はbuff", () => {
    expect(classifyChange("マナ 60 ⇒ 50")).toBe("buff");
  });

  it("反転ステータス: コスト/消費/詠唱時間/再使用/CDも同様に反転する", () => {
    expect(classifyChange("コスト: 3200 ⇒ 3000")).toBe("buff");
    expect(classifyChange("消費: 40 ⇒ 50")).toBe("nerf");
    expect(classifyChange("詠唱時間: 0.5 ⇒ 0.25")).toBe("buff");
    expect(classifyChange("再使用時間: 20 ⇒ 24")).toBe("nerf");
    expect(classifyChange("CD: 14 ⇒ 12")).toBe("buff");
  });

  it("前後で数値の個数が揃わない場合はunknown(安全側)", () => {
    expect(classifyChange("ダメージ: 50/70 ⇒ 55/75/90")).toBe("unknown");
  });
});

describe("classifyChampion（チャンピオン単位の集約、成長G3 F-G3-1）", () => {
  it("全てbuffならbuff", () => {
    expect(classifyChampion(["攻撃力: 55 ⇒ 58", "体力: 550 ⇒ 570"])).toBe("buff");
  });

  it("全てnerfならnerf", () => {
    expect(classifyChampion(["攻撃力: 58 ⇒ 55", "体力: 570 ⇒ 550"])).toBe("nerf");
  });

  it("buffとnerfが混在すればadjust(安全側に倒す)", () => {
    expect(classifyChampion(["攻撃力: 55 ⇒ 58", "体力: 570 ⇒ 550"])).toBe("adjust");
  });

  it("全てunknown(数値抽出不能)ならadjust", () => {
    expect(classifyChampion(["説明文が変わりました", "アイコンが更新されました"])).toBe("adjust");
  });

  it("同値(adjust)のみの変更ならadjust", () => {
    expect(classifyChampion(["シールド: 100 ⇒ 100"])).toBe("adjust");
  });
});

describe("composeArticleBody（detailedパッチの3グループ振り分け・冒頭サマリ・目次、成長G3 F-G3-2/3/4）", () => {
  const llm = new MockLLMClient();
  const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes";

  /** 強化(アジール)・弱体化(ガレン)・調整(反転語混在で曖昧=セナ)の3種を含むfixture。 */
  const mixedPatchContent = [
    "パッチ26.14ノートへようこそ。今回のアップデートでは複数のチャンピオンに調整が加わっています。",
    "エディタ: サンプルライター",
    "T1がLCKを制覇し3連覇を達成しました。今シーズンも熱い戦いが繰り広げられ、多くのファンが試合の行方を見守りました。",
    "",
    "アジール",
    "基本ステータス",
    "攻撃力: 55 ⇒ 58",
    "",
    "ガレン",
    "R - デマーシアの正義",
    "確定ダメージ: 150/250/350 ⇒ 130/230/330",
    "",
    "セナ",
    "W - 慈悲の光弾",
    "ダメージ: 70 ⇒ 90",
    "クールダウン: 14 ⇒ 18",
    "",
    "アイテム",
    "ラピッドファイアケーン",
    "攻撃力: 60 ⇒ 65",
    "",
    "TFTのお知らせ",
    "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
  ].join("\n");

  it("3グループ見出しが分類どおりに並び、空グループは出さない。各チャンピオンは画像+逐語のまま", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: mixedPatchContent, sourceUrl },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    // アジール: 攻撃力増加→buff。ガレン: 確定ダメージ減少→nerf。
    // セナ: ダメージ増加(buff)＋クールダウン増加(反転語→nerf)が混在するためadjust。
    expect(headings).toEqual(["主な強化", "アジール", "主な弱体化", "ガレン", "その他の調整", "セナ", "アイテム"]);

    // 逐語（部分文字列）維持の確認
    const paragraphs = body.filter((b) => b.type === "paragraph").map((b) => b.text);
    expect(paragraphs).toContain("基本ステータス 攻撃力: 55 ⇒ 58");
    expect(paragraphs).toContain("R - デマーシアの正義 確定ダメージ: 150/250/350 ⇒ 130/230/330");
    expect(paragraphs.some((p) => p.includes("ダメージ: 70 ⇒ 90"))).toBe(true);
    expect(paragraphs.some((p) => p.includes("クールダウン: 14 ⇒ 18"))).toBe(true);

    // 非チャンピオン章(アイテム)は3グループの後
    const itemIndex = headings.indexOf("アイテム");
    expect(itemIndex).toBe(headings.length - 1);
  });

  it("冒頭サマリに集計数(buff/nerf/adjust体数・otherセクション数)が正しく含まれ、0の項目は省かれる", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: mixedPatchContent, sourceUrl },
      llm,
    );
    const summary = body[0].type === "paragraph" ? body[0].text : "";
    expect(summary).toContain("1体を強化");
    expect(summary).toContain("1体を弱体化");
    expect(summary).toContain("1体を調整");
    expect(summary).not.toContain("0体");
  });

  it("チャンピオン変更が無い(アイテムのみ)パッチでは、非チャンピオン件数のみのサマリになる", async () => {
    const itemOnlyContent = [
      "パッチ26.15ノートへようこそ。今回のアップデートでは複数のアイテムに調整が加わっています。今回のパッチではチャンピオンの変更はありません。",
      "エディタ: サンプルライター",
      "T1がLCKを制覇し3連覇を達成しました。今シーズンも熱い戦いが繰り広げられ、多くのファンが試合の行方を見守りました。",
      "",
      "アイテム",
      "インフィニティエッジ",
      "クリティカル率: 20 ⇒ 25",
      "",
      "ドランブレード",
      "攻撃力: 8 ⇒ 10",
      "",
      "TFTのお知らせ",
      "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
    ].join("\n");
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.15ノート公開", content: itemOnlyContent, sourceUrl },
      llm,
    );
    const summary = body[0].type === "paragraph" ? body[0].text : "";
    expect(summary).not.toContain("体を強化");
    expect(summary).not.toContain("体を弱体化");
    expect(summary).not.toContain("体を調整");
    expect(summary).toContain("1件の変更");
  });

  it("目次: 各heading(3グループ+チャンピオン+非チャンピオン章)に連番anchorが付き、tocのitemsが全headingを指す", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: mixedPatchContent, sourceUrl },
      llm,
    );
    const tocBlock = body.find((b): b is Extract<typeof body[number], { type: "toc" }> => b.type === "toc");
    expect(tocBlock).toBeDefined();
    const headingBlocks = body.filter(
      (b): b is Extract<typeof body[number], { type: "heading" }> => b.type === "heading",
    );
    expect(tocBlock?.items).toEqual(headingBlocks.map((h) => ({ label: h.text, anchor: h.anchor })));
    for (const h of headingBlocks) {
      expect(h.anchor).toMatch(/^sec-\d+$/);
    }
    // anchorは日本語を含まない
    for (const item of tocBlock?.items ?? []) {
      expect(item.anchor).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("既存(anchor/toc無し)の非パッチ記事の表示は不変(headingにanchorが付かない)", async () => {
    const body = await composeArticleBody(
      { sourceType: "5ch", title: "普通のスレ", content: "1: 普通の反応だけで特にURLは無い\n2: そうだね" },
      llm,
    );
    const headingBlocks = body.filter((b) => b.type === "heading");
    for (const h of headingBlocks) {
      expect(h.type === "heading" && h.anchor).toBeUndefined();
    }
    expect(body.some((b) => b.type === "toc")).toBe(false);
  });

  it("fact/summaryモードの表示は不変(3分類・サマリ・目次を追加しない)", async () => {
    const prev = process.env.PATCH_ARTICLE_MODE;
    try {
      process.env.PATCH_ARTICLE_MODE = "fact";
      const body = await composeArticleBody(
        {
          sourceType: "riot",
          title: "パッチ26.14ノート公開",
          content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
          sourceUrl,
        },
        llm,
      );
      expect(body.some((b) => b.type === "toc")).toBe(false);
      const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
      expect(headings).not.toContain("主な強化");
      expect(headings).not.toContain("主な弱体化");
    } finally {
      if (prev === undefined) delete process.env.PATCH_ARTICLE_MODE;
      else process.env.PATCH_ARTICLE_MODE = prev;
    }
  });

  it("blockText(toc)がラベルを改行連結して返す(検索・安全フィルタの対象抽出との整合)", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: mixedPatchContent, sourceUrl },
      llm,
    );
    const toc = body.find((b) => b.type === "toc");
    expect(toc).toBeDefined();
    if (toc) {
      expect(blockText(toc)).toContain("主な強化");
    }
  });
});
