import { describe, expect, it } from "vitest";
import { extractSubreddit, isFromAllowedSubreddit, isRelevantItem, matchesKeyword } from "@/lib/collection/filter";
import { DEFAULT_ALLOWED_SUBREDDITS, DEFAULT_LOL_KEYWORDS } from "@/lib/collection/config";

describe("extractSubreddit", () => {
  it("reddit URLからサブレディット名を取り出す", () => {
    expect(extractSubreddit("https://www.reddit.com/r/leagueoflegends/comments/abc123/title/")).toBe("leagueoflegends");
  });

  it("サブレディットを含まないURLはnull", () => {
    expect(extractSubreddit("https://www.reddit.com/user/someone")).toBeNull();
  });
});

describe("isFromAllowedSubreddit", () => {
  it("許可リストに含まれるサブレディットはtrue", () => {
    expect(isFromAllowedSubreddit("https://www.reddit.com/r/leagueoflegends/comments/1/x/", ["leagueoflegends"])).toBe(true);
  });

  it("許可リストに無いサブレディットはfalse", () => {
    expect(isFromAllowedSubreddit("https://www.reddit.com/r/randomothergame/comments/1/x/", ["leagueoflegends"])).toBe(false);
  });
});

describe("matchesKeyword", () => {
  it("キーワードが含まれていれば大小文字を無視して一致する", () => {
    expect(matchesKeyword("Patch 14.6 Jungle Nerf", ["jungle"])).toBe(true);
  });

  it("どのキーワードにも一致しなければfalse", () => {
    expect(matchesKeyword("Best build for my other game character", DEFAULT_LOL_KEYWORDS)).toBe(false);
  });
});

describe("isRelevantItem", () => {
  const config = { allowedSubreddits: DEFAULT_ALLOWED_SUBREDDITS, keywords: DEFAULT_LOL_KEYWORDS };

  it("許可サブレディット かつ キーワード一致のredditアイテムは関連ありと判定する", () => {
    const item = {
      sourceType: "reddit" as const,
      sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/abc/patch_146_jungle_nerf/",
      title: "Patch 14.6 Jungle Nerf Discussion",
    };
    expect(isRelevantItem(item, config)).toBe(true);
  });

  it("許可外サブレディットのredditアイテムは無関係と判定する(キーワード一致有無に関わらず)", () => {
    const item = {
      sourceType: "reddit" as const,
      sourceUrl: "https://www.reddit.com/r/randomothergame/comments/abc/build/",
      title: "Best build for my other game character",
    };
    expect(isRelevantItem(item, config)).toBe(false);
  });

  it("reddit以外のソースはキーワード一致のみで判定する", () => {
    const relevant = {
      sourceType: "5ch" as const,
      sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/",
      title: "【LoL】パッチ14.6のジャングル弱体化について語るスレ",
    };
    const irrelevant = {
      sourceType: "5ch" as const,
      sourceUrl: "https://otherboard.5ch.net/test/read.cgi/livejupiter/1/",
      title: "麻雀の戦術について語るスレ",
    };
    expect(isRelevantItem(relevant, config)).toBe(true);
    expect(isRelevantItem(irrelevant, config)).toBe(false);
  });
});
