import { afterEach, describe, expect, it, vi } from "vitest";
import { composeArticleBody } from "@/lib/generation/compose";
import { buildChampionSplashUrl } from "@/lib/generation/champion-splash";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { blockText } from "@/lib/article-body";

/**
 * detailedパッチ本文（拡張E53 F-E53-1、lol-times風の詳細記事）のテスト。
 * `PATCH_ARTICLE_MODE` 未設定（既定）は "detailed" になる（拡張E53 F-E53-1）。
 * このファイルは compose.ts が持ち込む champion-splash 依存のうち `championNameToId` だけを
 * 一部モックするテストを含むため、既存の巨大テストファイル(generation-compose.test.ts)から分離した。
 */

const llm = new MockLLMClient();

/** PATCH_NOTES_MIN_LENGTH(300字)以上・アジール/ガレンの変更点を含む実パッチノート本文らしいfixture。 */
const detailedPatchContent = [
  "パッチ26.14ノートへようこそ。今回のアップデートでは複数のチャンピオンとアイテムに調整が加わっています。",
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
  "TFTのお知らせ",
  "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
].join("\n");

const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes";

describe("composeArticleBody（riot detailedパッチ本文、拡張E53 F-E53-1・テスト2、成長G3で3分類＋サマリ＋目次を追加）", () => {
  it("PATCH_ARTICLE_MODE未設定(既定)はdetailedになり、バナー画像→冒頭サマリ→目次→3グループ[見出し+画像+変更点]→linkButtonの順で組まれる", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ26.14ノート公開",
        content: detailedPatchContent,
        sourceUrl,
        imageUrl: "https://cmsassets.rgpub.io/sanity/images/patch-26-14-banner-1920x1087.jpg",
      },
      llm,
    );

    // 1. バナー画像が先頭
    expect(body[0].type).toBe("image");
    expect(body[0].type === "image" && body[0].url).toBe(
      "https://cmsassets.rgpub.io/sanity/images/patch-26-14-banner-1920x1087.jpg",
    );
    expect(body[0].type === "image" && body[0].credit).toContain("Riot Games");

    // 2. バナー直後は冒頭1文サマリ（段落）、その次は目次（toc）
    expect(body[1].type).toBe("paragraph");
    expect(body[2].type).toBe("toc");

    // アジール(攻撃力55⇒58、増加)は「主な強化」、ガレン(確定ダメージ150/250/350⇒130/230/330、減少)は
    // 「主な弱体化」に分類される。3グループ見出しが分類どおりに並ぶ（空グループ「その他の調整」は非表示）。
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化", "アジール", "主な弱体化", "ガレン"]);
    expect(headings).toContain("アジール");
    expect(headings).toContain("ガレン");

    // 目次（toc）のitemsは全heading（anchor付き）を指す
    const toc = body.find((b) => b.type === "toc");
    expect(toc?.type === "toc" && toc.items.map((i) => i.label)).toEqual(headings);
    const headingBlocks = body.filter((b) => b.type === "heading");
    for (const h of headingBlocks) {
      expect(h.type === "heading" && h.anchor).toMatch(/^sec-\d+$/);
    }

    // 3. チャンピオンごとに見出し→画像→変更点段落の順で並ぶ
    const azirHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "アジール");
    const azirImage = body[azirHeadingIndex + 1];
    expect(azirImage.type).toBe("image");
    expect(azirImage.type === "image" && azirImage.url).toBe(buildChampionSplashUrl("Azir"));
    const azirParagraph = body[azirHeadingIndex + 2];
    expect(azirParagraph.type).toBe("paragraph");
    expect(azirParagraph.type === "paragraph" && azirParagraph.text).toContain("55 ⇒ 58");

    const garenHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "ガレン");
    const garenImage = body[garenHeadingIndex + 1];
    expect(garenImage.type).toBe("image");
    expect(garenImage.type === "image" && garenImage.url).toBe(buildChampionSplashUrl("Garen"));
    const garenParagraph = body[garenHeadingIndex + 2];
    expect(garenParagraph.type).toBe("paragraph");
    expect(garenParagraph.type === "paragraph" && garenParagraph.text).toContain("150/250/350 ⇒ 130/230/330");

    // 4. 末尾は公式リンクボタン
    const lastBlock = body[body.length - 1];
    expect(lastBlock.type).toBe("linkButton");
    expect(lastBlock.type === "linkButton" && lastBlock.url).toBe(sourceUrl);

    // 逐語（部分文字列）維持の確認
    for (const b of [azirParagraph, garenParagraph]) {
      if (b.type === "paragraph") {
        expect(detailedPatchContent.replace(/\s+/g, "")).toContain(b.text.replace(/\s+/g, ""));
      }
    }
  });

  it("imageUrl未指定でもdetailed本文が組まれる（バナー省略、冒頭サマリから始まる）", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: detailedPatchContent, sourceUrl },
      llm,
    );
    expect(body[0].type).toBe("paragraph");
    expect(body[1].type).toBe("toc");
  });
});

describe("composeArticleBody（detailedパッチ本文のフォールバック、拡張E53 F-E53-1・テスト3）", () => {
  it("変更点が抽出できない実パッチ本文(チャンピオン節が無い)は事実速報にフォールバックする", async () => {
    const noiseOnlyContent = "パッチノートの本文らしきノイズテキストです。".repeat(30);
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: noiseOnlyContent, sourceUrl },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    // composePatchFactFlashBodyの見出し（「パッチ<番号>が公開」）になる（detailed特有の"の変更点"にはならない）
    expect(headings).toEqual(["パッチ26.14が公開"]);
    expect(body.some((b) => b.type === "image" && b.alt.includes("スプラッシュ"))).toBe(false);
  });

  it("本文が無い(PATCH_NOTES_MIN_LENGTH未満、mock相当)場合も事実速報にフォールバックする", async () => {
    const body = await composeArticleBody(
      {
        sourceType: "riot",
        title: "パッチ26.14ノート公開",
        content: "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        sourceUrl,
      },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["パッチ26.14が公開"]);
  });
});

describe("composeArticleBody（PATCH_ARTICLE_MODE既定がdetailedであることの確認、拡張E53 F-E53-1・テスト4）", () => {
  it("env未設定時はPATCH_ARTICLE_MODE=detailed相当の挙動になる(明示的にdetailedを指定しても同じ結果)", async () => {
    const prev = process.env.PATCH_ARTICLE_MODE;
    try {
      delete process.env.PATCH_ARTICLE_MODE;
      const unset = await composeArticleBody(
        { sourceType: "riot", title: "パッチ26.14ノート公開", content: detailedPatchContent, sourceUrl },
        llm,
      );
      process.env.PATCH_ARTICLE_MODE = "detailed";
      const explicit = await composeArticleBody(
        { sourceType: "riot", title: "パッチ26.14ノート公開", content: detailedPatchContent, sourceUrl },
        llm,
      );
      expect(unset.map(blockText)).toEqual(explicit.map(blockText));
    } finally {
      if (prev === undefined) delete process.env.PATCH_ARTICLE_MODE;
      else process.env.PATCH_ARTICLE_MODE = prev;
    }
  });
});

describe("composeArticleBody（detailedパッチ本文のid不明チャンピオン、拡張E53 F-E53-1・テスト2）", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/generation/champion-splash");
  });

  it("championNameToIdがnullを返すチャンピオンは画像を省略しテキスト(見出し+変更点)のみになる", async () => {
    vi.resetModules();
    vi.doMock("@/lib/generation/champion-splash", async () => {
      const actual = await vi.importActual<typeof import("@/lib/generation/champion-splash")>(
        "@/lib/generation/champion-splash",
      );
      return {
        ...actual,
        championNameToId: (name: string) => (name === "ガレン" ? null : actual.championNameToId(name)),
      };
    });

    const { composeArticleBody: composeArticleBodyWithMock } = await import("@/lib/generation/compose");
    const body = await composeArticleBodyWithMock(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: detailedPatchContent, sourceUrl },
      llm,
    );

    const azirHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "アジール");
    expect(body[azirHeadingIndex + 1].type).toBe("image"); // アジールは解決できるので画像あり

    const garenHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "ガレン");
    // ガレンはid不明なので画像を挟まず、直後は変更点の段落(テキストのみ)になる
    const garenNextBlock = body[garenHeadingIndex + 1];
    expect(garenNextBlock.type).toBe("paragraph");
    expect(garenNextBlock.type === "paragraph" && garenNextBlock.text).toContain("150/250/350 ⇒ 130/230/330");
  });
});
