import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateArticleForCandidate,
  GenerationError,
  MIN_BODY_LENGTH,
  type GenerationCandidate,
} from "@/lib/generation/generate-article";
import { MockLLMClient, type LLMClient, type LLMMessage } from "@/lib/generation/llm-client";
import { blockText, parseArticleBody } from "@/lib/article-body";
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-thumbnail";
import { LLM_TITLE_SYSTEM_PROMPT } from "@/lib/generation/title";

/**
 * env `PATCH_ARTICLE_MODE` を一時的に指定して関数を実行する(拡張E41 F-E41-2)。
 * "summary"は、後でLLMまとめに戻すとき用に残した従来のE40 3段フォールバックの回帰確認用。
 * 実行後は元の値(未設定含む)に復元する。
 */
async function withPatchMode<T>(mode: "fact" | "summary", fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PATCH_ARTICLE_MODE;
  process.env.PATCH_ARTICLE_MODE = mode;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prev;
  }
}

const llm = new MockLLMClient();

function candidate(overrides: Partial<GenerationCandidate> = {}): GenerationCandidate {
  return {
    id: "c1",
    sourceType: "riot",
    sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/",
    title: "パッチ14.6ノート公開",
    content:
      "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
    ...overrides,
  };
}

describe("generateArticleForCandidate（成功パス）", () => {
  it("見出し・段落を持つ構造化本文が最低300文字以上で生成され、出典が付与される", async () => {
    const result = await generateArticleForCandidate(candidate(), llm);

    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(MIN_BODY_LENGTH);
    expect(result.body.some((b) => b.type === "heading")).toBe(true);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0].url).toBe(candidate().sourceUrl);
    // DBに保存する形式(JSON)としても壊れずパースできる
    expect(() => parseArticleBody(result.body)).not.toThrow();
  });

  it("riot由来はカテゴリ「パッチ/メタ」、5ch由来は「5chの反応」、reddit由来は「海外の反応」になる（拡張E19）", async () => {
    const riot = await generateArticleForCandidate(candidate({ sourceType: "riot" }), llm);
    const ch5 = await generateArticleForCandidate(candidate({ sourceType: "5ch" }), llm);
    const reddit = await generateArticleForCandidate(candidate({ sourceType: "reddit" }), llm);
    expect(riot.category).toBe("パッチ/メタ");
    expect(ch5.category).toBe("5chの反応");
    expect(reddit.category).toBe("海外の反応");
  });
});

describe("generateArticleForCandidate（riotパッチ記事の構成モード切替、拡張E41 F-E41-2）", () => {
  it("既定(PATCH_ARTICLE_MODE未設定)ではriotは事実速報になり、受け入れ基準(最低300字・出典付与)を満たす", async () => {
    const result = await generateArticleForCandidate(candidate({ sourceType: "riot" }), llm);
    const headings = result.body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual([`パッチ${extractPatchNumberFromTitle(candidate().title)}が公開`]);
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(MIN_BODY_LENGTH);
    expect(result.sources[0].url).toBe(candidate().sourceUrl);
  });

  it("PATCH_ARTICLE_MODE=summaryにすると同じ候補でも従来の速報＋要点整理(composeFactBody)に切り替わる", async () => {
    const factResult = await generateArticleForCandidate(candidate({ sourceType: "riot" }), llm);
    const summaryResult = await withPatchMode("summary", () =>
      generateArticleForCandidate(candidate({ sourceType: "riot" }), llm),
    );
    const factHeadings = factResult.body.filter((b) => b.type === "heading").map((b) => b.text);
    const summaryHeadings = summaryResult.body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(factHeadings).not.toEqual(summaryHeadings);
    expect(summaryHeadings).toEqual(["速報", "要点整理", "まとめ"]);
  });
});

/** テスト用: candidate.titleから"数字.数字"のパッチ番号を取り出す(compose.tsのextractPatchNumberLabelと同じ抽出対象を確認する簡易ヘルパー)。 */
function extractPatchNumberFromTitle(title: string): string {
  const m = title.match(/\d+\.\d+/);
  if (!m) throw new Error("テスト用candidateのtitleにパッチ番号が含まれていません");
  return m[0];
}

describe("generateArticleForCandidate（clip由来=埋め込み紹介形式、拡張E17）", () => {
  function clipCandidate(overrides: Partial<GenerationCandidate> = {}): GenerationCandidate {
    return candidate({
      sourceType: "clip",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      title: "LoLハイライト動画",
      content: "今週のLoL神プレイをまとめました。",
      ...overrides,
    });
  }

  it("clip由来はカテゴリ「eスポーツ」になり、embedブロックを含む本文が生成される（拡張E19）", async () => {
    const result = await generateArticleForCandidate(clipCandidate(), llm);
    expect(result.category).toBe("eスポーツ");
    expect(result.body.some((b) => b.type === "embed")).toBe(true);
    expect(result.body.some((b) => b.type === "heading")).toBe(true);
    expect(result.sources[0].url).toBe("https://www.youtube.com/watch?v=abc123");
    // DBに保存する形式(JSON)としても壊れずパースできる
    expect(() => parseArticleBody(result.body)).not.toThrow();
  });

  it("clipのcontentが短くても(300字未満)GenerationErrorにならない(埋め込み紹介形式は最低文字数チェック対象外)", async () => {
    const result = await generateArticleForCandidate(clipCandidate({ content: "短い紹介文。" }), llm);
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeLessThan(MIN_BODY_LENGTH);
    expect(result.body.some((b) => b.type === "embed")).toBe(true);
  });
});

describe("generateArticleForCandidate（サムネイル画像、拡張E19 F-E19-3）", () => {
  it("candidate.imageUrlがhttpsの妥当なURLならGeneratedArticle.thumbnailUrlに反映される", async () => {
    const result = await generateArticleForCandidate(
      candidate({ imageUrl: "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg" }),
      llm,
    );
    expect(result.thumbnailUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg",
    );
  });

  it("candidate.imageUrlが未設定(null/undefined)ならthumbnailUrlはnullになる", async () => {
    const noImage = await generateArticleForCandidate(candidate({ imageUrl: null }), llm);
    expect(noImage.thumbnailUrl).toBeNull();
    const undefinedImage = await generateArticleForCandidate(candidate({}), llm);
    expect(undefinedImage.thumbnailUrl).toBeNull();
  });

  it("candidate.imageUrlが不正なURL(https以外)の場合はthumbnailUrlをnullにフォールバックする", async () => {
    const result = await generateArticleForCandidate(
      candidate({ imageUrl: "http://example.com/not-https.jpg" }),
      llm,
    );
    expect(result.thumbnailUrl).toBeNull();
  });
});

describe("generateArticleForCandidate（チャンピオン検出→スプラッシュ、拡張E31 テスト3）", () => {
  // 実APIを叩かないよう、championMapはスタブを渡す(fetchChampionNameToIdMapは呼ばない)。
  const championMap = new Map([
    ["リサンドラ", "Lissandra"],
    ["リリア", "Lillia"],
  ]);

  it("candidate.imageUrlが安全なURLならソース画像が優先され、チャンピオン検出は行われない", async () => {
    const result = await generateArticleForCandidate(
      candidate({
        title: "リサンドラが強すぎると話題のスレ",
        content: "1: リサンドラの氷結スキルが強すぎる。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/3/",
        imageUrl: "https://external.example.com/reddit-image.jpg",
      }),
      llm,
      championMap,
    );
    expect(result.thumbnailUrl).toBe("https://external.example.com/reddit-image.jpg");
  });

  it("ソース画像が無く、タイトル+本文からチャンピオンを検出できればスプラッシュURLになる", async () => {
    const result = await generateArticleForCandidate(
      candidate({
        title: "リサンドラが強すぎると話題のスレ",
        content: "1: リサンドラの氷結スキルが強すぎて対処法が無い。\n2: 確かに今パッチ最強クラス。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/4/",
        imageUrl: null,
      }),
      llm,
      championMap,
    );
    expect(result.thumbnailUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lissandra_0.jpg",
    );
  });

  it("ソース画像もチャンピオン検出も無い反応記事(5ch/reddit)は決定論チャンピオンスプラッシュにフォールバックする(拡張E37)", async () => {
    const result = await generateArticleForCandidate(
      candidate({
        title: "パッチノートが公開",
        content: "1: 今回のパッチはアイテム調整が中心。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/5/",
        imageUrl: null,
      }),
      llm,
      championMap,
    );
    expect(result.thumbnailUrl).not.toBeNull();
    expect(result.thumbnailUrl).toMatch(
      /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/img\/champion\/splash\/[A-Za-z]+_0\.jpg$/,
    );
  });

  it("championMapを渡さない(未指定/null)場合は従来どおりチャンピオン検出を行わないが、反応記事は決定論スプラッシュにフォールバックする(拡張E37)", async () => {
    const noMapArg = await generateArticleForCandidate(
      candidate({
        title: "リサンドラが強すぎると話題のスレ",
        content: "1: リサンドラの氷結スキルが強すぎる。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/6/",
        imageUrl: null,
      }),
      llm,
    );
    // championMap未指定なので本文検出(Lissandra)は行われず、決定論フォールバックの絵になる
    expect(noMapArg.thumbnailUrl).not.toBeNull();
    expect(noMapArg.thumbnailUrl).toMatch(
      /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/img\/champion\/splash\/[A-Za-z]+_0\.jpg$/,
    );

    const nullMap = await generateArticleForCandidate(
      candidate({
        title: "リサンドラが強すぎると話題のスレ",
        content: "1: リサンドラの氷結スキルが強すぎる。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/7/",
        imageUrl: null,
      }),
      llm,
      null,
    );
    expect(nullMap.thumbnailUrl).not.toBeNull();
  });
});

describe("generateArticleForCandidate（反応記事の決定論チャンピオンスプラッシュフォールバック、拡張E37）", () => {
  it("reaction(5ch/reddit)でimageUrlも本文チャンピオン検出も無い場合、candidate.idから決定論的に選んだチャンピオンのスプラッシュURLになる(null にならない)", async () => {
    const result = await generateArticleForCandidate(
      candidate({
        id: "e37-c1",
        title: "パッチノートが公開",
        content: "1: 今回のパッチはアイテム調整が中心。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/e37-1/",
        imageUrl: null,
      }),
      llm,
    );
    expect(result.thumbnailUrl).toBe(pickDeterministicChampionSplashUrl("e37-c1"));
  });

  it("同じcandidate.idなら常に同じ決定論スプラッシュURLになる(再生成しても絵が変わらない)", async () => {
    const first = await generateArticleForCandidate(
      candidate({
        id: "e37-stable",
        title: "パッチノートが公開",
        content: "1: 今回のパッチはアイテム調整が中心。",
        sourceType: "reddit",
        sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/e37-stable-1/",
        imageUrl: null,
      }),
      llm,
    );
    const second = await generateArticleForCandidate(
      candidate({
        id: "e37-stable",
        title: "パッチノートが公開(再生成)",
        content: "1: 今回のパッチはアイテム調整が中心らしい。",
        sourceType: "reddit",
        sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/e37-stable-2/",
        imageUrl: null,
      }),
      llm,
    );
    expect(first.thumbnailUrl).toBe(second.thumbnailUrl);
  });

  it("reactionでもimageUrlが安全なURLならそれが優先され、決定論スプラッシュは使われない(回帰なし)", async () => {
    const result = await generateArticleForCandidate(
      candidate({
        id: "e37-with-image",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/e37-2/",
        content: "1: 今回のパッチはアイテム調整が中心。",
        imageUrl: "https://external.example.com/reaction-image.jpg",
      }),
      llm,
    );
    expect(result.thumbnailUrl).toBe("https://external.example.com/reaction-image.jpg");
  });

  it("reactionで本文にチャンピオン名があれば本文検出のスプラッシュが優先され、決定論スプラッシュは使われない(回帰なし)", async () => {
    const championMap = new Map([["リリア", "Lillia"]]);
    const result = await generateArticleForCandidate(
      candidate({
        id: "e37-with-detect",
        title: "リリアが強すぎると話題のスレ",
        content: "1: リリアの睡眠花が強すぎる。",
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/e37-3/",
        imageUrl: null,
      }),
      llm,
      championMap,
    );
    expect(result.thumbnailUrl).toBe(
      "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lillia_0.jpg",
    );
  });

  it("非reaction(riot/clip)でチャンピオン未検出のときは従来どおりthumbnailUrlがnullになる(カテゴリSVGに委ねる・回帰なし)", async () => {
    const riotResult = await generateArticleForCandidate(
      candidate({
        id: "e37-riot",
        sourceType: "riot",
        title: "パッチ14.6ノート公開",
        content:
          "本パッチではジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなる調整が入った。",
        imageUrl: null,
      }),
      llm,
    );
    expect(riotResult.thumbnailUrl).toBeNull();

    const clipResult = await generateArticleForCandidate(
      candidate({
        id: "e37-clip",
        sourceType: "clip",
        sourceUrl: "https://www.youtube.com/watch?v=e37clip",
        title: "LoLハイライト動画",
        content: "今週のLoL神プレイをまとめました。",
        imageUrl: null,
      }),
      llm,
    );
    expect(clipResult.thumbnailUrl).toBeNull();
  });
});

describe("generateArticleForCandidate（riot公式パッチノートのまとめ記事、拡張E34 F-E34-2）", () => {
  // 拡張E41 F-E41-2でriotの既定は事実速報(fact)になったため、本describe(従来のsummary挙動)は
  // PATCH_ARTICLE_MODE=summaryに固定して実行する(後でLLMまとめに戻す用にコード・テストを残す)。
  let prevPatchMode: string | undefined;
  beforeAll(() => {
    prevPatchMode = process.env.PATCH_ARTICLE_MODE;
    process.env.PATCH_ARTICLE_MODE = "summary";
  });
  afterAll(() => {
    if (prevPatchMode === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prevPatchMode;
  });

  const patchNotesContent = "実際のパッチノート本文らしいテキスト。".repeat(30);
  const validSummaryJson = JSON.stringify({
    buffed: [
      "ヤスオ: 基本攻撃力が4から8に引き上げられ、序盤のレーン戦の主導権を握りやすくなり、対面のマッチアップで有利に立ち回りやすくなった。",
      "アーリ: Qのクールダウンが1秒短縮され、連続でスキルを使いやすくなり、コンボの継続力が上がった。",
    ],
    nerfed: [
      "ゼド: シールドスキルの吸収量が20から15に引き下げられ、ダイブ後の生存力がやや下がった。",
      "カタリナ: リセット可能な条件が厳しくなり、連続でキルを取ることが難しくなった。",
    ],
    other: [
      "インフィニティエッジ: 価格が3400から3300に引き下げられ、序盤から購入しやすくなった。",
      "ジャングルモンスターの経験値量が全体的に引き下げられ、序盤のレベル差がつきにくくなった。",
    ],
  });

  class StubLLMClient implements LLMClient {
    constructor(private readonly response: string) {}
    async generate(): Promise<string> {
      return this.response;
    }
  }

  it("実パッチノート本文＋要約できるLLMのとき、まとめ体裁の記事が生成され出典URLが付与される", async () => {
    const stub = new StubLLMClient(validSummaryJson);
    const result = await generateArticleForCandidate(
      candidate({ content: patchNotesContent, title: "パッチ14.6ノート公開" }),
      stub,
    );
    const headings = result.body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["主な強化チャンピオン", "主な弱体チャンピオン", "アイテム・その他の変更"]);
    expect(result.category).toBe("パッチ/メタ");
    expect(result.sources[0].url).toBe(candidate().sourceUrl);
  });

  it("実パッチノート本文だがLLMが要約できない(mock)場合でも、GenerationErrorにならずクリーンな簡易パッチ記事が生成される(拡張E35 F-E35-3、composeFactBody非経由)", async () => {
    const result = await generateArticleForCandidate(
      candidate({ content: patchNotesContent, title: "パッチ14.6ノート公開" }),
      llm,
    );
    const headings = result.body.filter((b) => b.type === "heading").map((b) => b.text);
    // composeFactBody(速報/要点整理/まとめ)には落ちず、見出し1件のクリーンな簡易記事になる
    expect(headings).not.toEqual(["速報", "要点整理", "まとめ"]);
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain("の変更点");
    expect(result.body.some((b) => b.type === "quote")).toBe(false);
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(MIN_BODY_LENGTH);
    expect(result.sources[0].url).toBe(candidate().sourceUrl);
  });
});

describe("generateArticleForCandidate（タイトル決定、拡張E40 F-E40-1: 捏造タイトル解消）", () => {
  /** LLM_TITLE_SYSTEM_PROMPT(タイトル生成)向けの呼び出しだけを検知し、それ以外の呼び出し
   * (本文組み立て等)は従来どおりMockLLMClientに委譲するテスト用スタブ。 */
  class TitleCallTrackingLLMClient implements LLMClient {
    public titleCallCount = 0;
    private readonly mock = new MockLLMClient();
    async generate(messages: LLMMessage[]): Promise<string> {
      if (messages.some((m) => m.role === "system" && m.content === LLM_TITLE_SYSTEM_PROMPT)) {
        this.titleCallCount++;
        return "【速報】これはテスト用のLLM生成タイトルだよ";
      }
      return this.mock.generate(messages);
    }
  }

  it("riot候補は candidate.title をそのままタイトルにし、煽りタイトルLLM(generateHookTitleLLM)を経由しない(捏造防止)", async () => {
    const tracker = new TitleCallTrackingLLMClient();
    const result = await generateArticleForCandidate(
      candidate({ sourceType: "riot", title: "【パッチ】26.14 の主な変更点まとめ" }),
      tracker,
    );
    expect(result.title).toBe("【パッチ】26.14 の主な変更点まとめ");
    expect(tracker.titleCallCount).toBe(0);
  });

  it("5ch/reddit候補は従来どおり煽りタイトルLLMを経由する(回帰なし)", async () => {
    const trackerFivech = new TitleCallTrackingLLMClient();
    const fivechResult = await generateArticleForCandidate(
      candidate({
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/e40-1/",
        content: "1: 最初のレス。\n2: 二番目のレス。",
      }),
      trackerFivech,
    );
    expect(fivechResult.title).toBe("【速報】これはテスト用のLLM生成タイトルだよ");
    expect(trackerFivech.titleCallCount).toBe(1);

    const trackerReddit = new TitleCallTrackingLLMClient();
    const redditResult = await generateArticleForCandidate(
      candidate({
        sourceType: "reddit",
        sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/e40-1/",
        content: "1: 最初のレス。\n2: 二番目のレス。",
      }),
      trackerReddit,
    );
    expect(redditResult.title).toBe("【速報】これはテスト用のLLM生成タイトルだよ");
    expect(trackerReddit.titleCallCount).toBe(1);
  });
});

describe("generateArticleForCandidate（riotパッチ記事の決定的抽出フォールバック、拡張E40 F-E40-2）", () => {
  // 拡張E41 F-E41-2でriotの既定は事実速報(fact)になったため、本describe(従来のsummary挙動)は
  // PATCH_ARTICLE_MODE=summaryに固定して実行する(後でLLMまとめに戻す用にコード・テストを残す)。
  let prevPatchMode: string | undefined;
  beforeAll(() => {
    prevPatchMode = process.env.PATCH_ARTICLE_MODE;
    process.env.PATCH_ARTICLE_MODE = "summary";
  });
  afterAll(() => {
    if (prevPatchMode === undefined) delete process.env.PATCH_ARTICLE_MODE;
    else process.env.PATCH_ARTICLE_MODE = prevPatchMode;
  });

  /** 実パッチノートらしいノイズを大量に含みつつ、チャンピオン別の「⇒」変更行を複数含むfixture。
   * generation-compose.test.ts の同名関数と同じ設計方針(ノイズを大きくして逐語一致率を抑える)。 */
  function buildRealisticPatchFixture(): string {
    // 単純な繰り返し文だと同じn-gramが大量に重複し、逐語一致率の判定(文字n-gramの被覆率)を
    // 実質的に薄められない(distinctなn-gram数がほぼ増えない)ため、番号を変えた文を多数連結して
    // 実ページ相当の「大量の非反復ノイズ」を作る(拡張E40)。
    const noise = Array.from(
      { length: 200 },
      (_, i) => `これはテスト用のダミー文${i}です。実際のパッチ内容とは関係ありません。`,
    ).join("");
    const champions = [
      { name: "アジール", context: "基本ステータス", changes: ["攻撃力: 55 ⇒ 58", "体力: 550 ⇒ 570"] },
      { name: "ケイトリン", context: "基本ステータス", changes: ["レベルアップごとの攻撃力: 2 ⇒ 2.5", "移動速度: 335 ⇒ 340"] },
      {
        name: "ガレン",
        context: "R - デマーシアの正義",
        changes: ["確定ダメージ: 150/250/350 ⇒ 130/230/330", "クールダウン: 120/100/80 ⇒ 130/110/90"],
      },
      { name: "ダリウス", context: "Q - 大鎌の一撃", changes: ["クールダウン: 9/8/7/6/5 ⇒ 8/7/6/5/4"] },
      { name: "ヴィエゴ", context: "パッシブ - 王家の運命", changes: ["支配時間: 6秒 ⇒ 8秒"] },
      { name: "セナ", context: "W - 慈悲の光弾", changes: ["ダメージ: 70/115/160/205/250 ⇒ 65/105/145/185/225"] },
    ];
    const sections = champions.map((c) => [c.name, c.context, ...c.changes].join("\n"));
    // 実データ(stripHtmlToText出力)同様に「ラベル行/：X ⇒行/値行」が分割されるケースも1件含める
    // (拡張E40b: 変更後の値が次行に割れても復元できることの回帰確認)。
    const jaceSplitSection = ["ジェイス", "基本ステータス", "増加移動速度", "：40 ⇒", "45"].join("\n");
    return [noise, ...sections, jaceSplitSection, "TFTのお知らせ\nTFTセット14が近日公開予定です。", noise].join(
      "\n\n",
    );
  }

  it("実パッチノート本文＋LLM要約が失敗(mock)でも、決定的抽出で変更点があればGenerationErrorにならず「主な変更点」まとめ本文になる(捏造なし・最低文字数/逐語一致率/引用比率を満たす)", async () => {
    const patchText = buildRealisticPatchFixture();
    const result = await generateArticleForCandidate(
      candidate({ content: patchText, title: "【パッチ】26.14 の主な変更点まとめ" }),
      llm,
    );
    const headings = result.body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings[0]).toBe("主な変更点（公式パッチノートより）");
    expect(headings).toContain("アジール");
    expect(headings).toContain("ジェイス");
    expect(headings).not.toEqual(["26.14の変更点"]); // クリーン定型ではない
    expect(result.body.some((b) => b.type === "quote")).toBe(false);
    // タイトルは事実タイトル(candidate.title)そのまま(拡張E40 F-E40-1、捏造なし)
    expect(result.title).toBe("【パッチ】26.14 の主な変更点まとめ");
    // 拡張E40bの重大バグ修正: 値が複数行に割れた実データケース(ジェイス)でも変更後の値まで復元され、
    // 矢印だけで終わる壊れた行が残っていない
    const paragraphs = result.body.filter((b) => b.type === "paragraph").map((b) => b.text);
    expect(paragraphs).toContain("増加移動速度 ：40 ⇒ 45");
    for (const p of paragraphs) {
      expect(p.trim().endsWith("⇒")).toBe(false);
    }
    // 受け入れ基準(generate-article.tsの検証: 最低300字・逐語一致率・引用比率)を満たしGenerationErrorにならない
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeGreaterThanOrEqual(MIN_BODY_LENGTH);
  });
});

describe("generateArticleForCandidate（失敗パス）", () => {
  it("出典URLが無い候補はGenerationErrorになる", async () => {
    await expect(generateArticleForCandidate(candidate({ sourceUrl: "" }), llm)).rejects.toBeInstanceOf(
      GenerationError,
    );
  });

  // 拡張E41 F-E41-2: 既定(fact)のriot記事は本文の長短に関わらず一定量の事実速報テキストを
  // 生成するため、riotでは最低文字数チェックを再現できなくなった。従来のsummaryモード
  // (composeFactBody、contentに依存する本文量)で最低文字数チェックの回帰を確認する。
  it("PATCH_ARTICLE_MODE=summaryのとき、内容が空で本文が最低文字数に満たない候補はGenerationErrorになる(回帰なし)", async () => {
    await withPatchMode("summary", async () => {
      await expect(generateArticleForCandidate(candidate({ content: "" }), llm)).rejects.toBeInstanceOf(
        GenerationError,
      );
    });
  });

  // 拡張E41 F-E41-2: fact既定のriot記事はLLMを呼ばない(composePatchFactFlashBody)ため、逐語コピーを
  // 返す「悪いLLM」を再現できない。従来のsummaryモード(composeFactBody、LLM出力をそのまま使う)で
  // 逐語コピー検知の回帰を確認する。
  it("PATCH_ARTICLE_MODE=summaryのとき、生成文が元ソースの逐語コピーに近い場合はGenerationErrorになり、正常な候補の生成は妨げない(回帰なし)", async () => {
    await withPatchMode("summary", async () => {
      // 常に元本文をそのまま返す「悪い」LLMクライアント(逐語コピー再現用スタブ)
      class VerbatimCopyLLMClient implements LLMClient {
        constructor(private readonly sourceContent: string) {}
        async generate(_messages: LLMMessage[]): Promise<string> {
          return this.sourceContent.repeat(5); // 300字以上にするため繰り返すが、内容は完全コピー
        }
      }
      const c = candidate();
      const badLlm = new VerbatimCopyLLMClient(c.content);

      await expect(generateArticleForCandidate(c, badLlm)).rejects.toBeInstanceOf(GenerationError);

      // 同じ候補集合の中の別候補(正常なMockLLMClient)は影響を受けず生成継続できる
      const other = await generateArticleForCandidate(candidate({ id: "c2" }), llm);
      expect(other.body.length).toBeGreaterThan(0);
    });
  });
});

describe("generateArticleForCandidate（まとめ速報レス形式=5ch/reddit、逐語チェック対象外）", () => {
  it("5ch由来はレス本文が元ソースと完全一致(逐語)でもGenerationErrorにならない(意図的な転載のため)", async () => {
    const content =
      "1: このジャングルナーフはマジでキツい。\nパワースパイクが遅れるとか勘弁してくれ。\n\n2: >>1\n同意、ジャングルメインは今回のパッチ悲惨すぎる。\n\n3: 一方でトップレーンからは歓迎の声も多いんだよな。";
    const result = await generateArticleForCandidate(
      candidate({
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/",
        content,
      }),
      llm,
    );
    // レス本文ブロックが逐語のまま含まれている(要約・言い換えされていない)
    const reactionBlocks = result.body.filter((b) => b.type === "reaction");
    expect(reactionBlocks.length).toBe(3);
    expect(
      reactionBlocks[0].type === "reaction" && reactionBlocks[0].lines.map((l) => l.text),
    ).toEqual(["このジャングルナーフはマジでキツい。", "パワースパイクが遅れるとか勘弁してくれ。"]);

    // body は「反応まとめ」見出し＋reactionブロックのみ(AI導入・まとめ段落なし)
    expect(result.body[0]).toEqual({ type: "heading", text: "反応まとめ" });
    expect(result.body.every((b) => b.type === "heading" || b.type === "reaction")).toBe(true);
  });

  it("300字未満の短いレスでもGenerationErrorにならない(AI要約段落を持たないため最低文字数チェック対象外)", async () => {
    const content = "1: 短いけど盛り上がってるスレ。";
    const result = await generateArticleForCandidate(
      candidate({
        sourceType: "5ch",
        sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/2/",
        content,
      }),
      llm,
    );
    const totalLength = result.body.reduce((sum, b) => sum + blockText(b).length, 0);
    expect(totalLength).toBeLessThan(MIN_BODY_LENGTH);
    expect(result.body.some((b) => b.type === "reaction")).toBe(true);
  });

  it("reactionブロックが1件も組み立てられない(空content)場合はGenerationErrorになる", async () => {
    await expect(
      generateArticleForCandidate(
        candidate({ sourceType: "5ch", content: "" }),
        llm,
      ),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
