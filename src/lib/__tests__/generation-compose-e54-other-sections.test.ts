import { describe, expect, it } from "vitest";
import {
  composeArticleBody,
  extractPatchChangesDeterministic,
  extractPatchSectionsDeterministic,
} from "@/lib/generation/compose";
import { buildChampionSplashUrl } from "@/lib/generation/champion-splash";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { generateArticleForCandidate, type GenerationCandidate } from "@/lib/generation/generate-article";

/**
 * 拡張E54 F-E54-1/F-E54-2: 詳細パッチ記事にアイテム・システム変更も臨機応変に含めるテスト。
 * `extractPatchChangesDeterministic`（E40、チャンピオン節のみ）を土台に一般化した
 * `extractPatchSectionsDeterministic`（チャンピオン節＋チャンピオン以外の節）と、それを使う
 * `composeDetailedPatchBody`（composeArticleBody経由）の挙動を確認する。
 */

const llm = new MockLLMClient();
const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes";

/** チャンピオン節＋アイテム節＋システム節を含む、PATCH_NOTES_MIN_LENGTH(300字)以上のfixture。 */
const combinedPatchContent = [
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
  "アイテム",
  "ラピッドファイアケーン",
  "攻撃力: 60 ⇒ 65",
  "",
  "ドランシールド",
  "体力: 80 ⇒ 90",
  "",
  "システム",
  "召喚士呪文テレポート",
  "クールダウン: 360 ⇒ 330",
  "",
  "TFTのお知らせ",
  "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
].join("\n");

/** チャンピオンのみ（アイテム/システム節なし）のfixture＝E53相当（回帰確認用）。 */
const championOnlyPatchContent = [
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
  "TFTのお知らせ",
  "TFTセット14が近日公開予定です。詳細は追ってお知らせします。新しいシナジーやチャンピオンが多数追加され、環境が大きく変化する見込みです。今後のアップデートにもご期待ください。",
].join("\n");

/**
 * E54修正の回帰確認用フィクスチャ（実パッチ26.14で判明した不具合の再現）: チャンピオン最大数
 * (12体)を超える13体目の変更が発生すると、以降チャンピオン節にもキーワード節にも属さない
 * 「宙に浮いた」スキル/ステータスラベル（例「Eの掴み後の移動距離」「Qの減少体力反映率」）が続く。
 * これらが独立の見出しに誤昇格せず単一の「その他の変更点」にまとまり、キーワード見出し
 * （アイテム/バグ修正）だけが節になり、重複する「バグ修正」がマージされることを確認する。
 */
const twelveOrdinaryChampions = [
  "アリスター",
  "アニビア",
  "アニー",
  "アフェリオス",
  "アッシュ",
  "アジール",
  "バード",
  "アムム",
  "ブリッツクランク",
  "ブランド",
  "ブラウム",
  "ケイトリン",
];
const skillLabelMisclassificationFixture = [
  "パッチ26.14ノートへようこそ。今回のアップデートでは複数のチャンピオンとアイテムに調整が加わっています。",
  "エディタ: サンプルライター",
  "",
  ...twelveOrdinaryChampions.flatMap((name, i) => [
    name,
    i === twelveOrdinaryChampions.length - 1 ? "Rのダメージ" : "基本ステータス",
    `攻撃力: ${50 + i} ⇒ ${55 + i}`,
    "",
  ]),
  // 13体目（チャンピオン最大数12を超える）。カミールという名前自体は認識されるが上限超過のため
  // チャンピオン節としては開始されず、以降のスキルラベル＋変更行が「宙に浮いた」状態になる。
  "カミール",
  "Eの掴み後の移動距離",
  "300 ⇒ 350",
  "",
  "Qの減少体力反映率",
  "0.5 ⇒ 0.6",
  "",
  "アイテム",
  "ラピッドファイアケーン",
  "攻撃力: 60 ⇒ 65",
  "",
  "固有スキルの魔力反映率",
  "0.3 ⇒ 0.4",
  "",
  "バグ修正",
  "特定条件で発生していた表示バグを修正: 発生 ⇒ 解消",
  "",
  "バグ修正",
  "別の状況で発生していたバグも修正: 発生 ⇒ 解消",
].join("\n");

/** アイテムのみ（チャンピオン節なし）のfixture＝臨機応変の確認用。 */
const itemOnlyPatchContent = [
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

describe("extractPatchSectionsDeterministic（チャンピオン以外の変更点の一般化抽出、拡張E54 F-E54-1）", () => {
  it("チャンピオン節＋アイテム/システム節を含むfixtureから、両方が逐語で抽出される", () => {
    const result = extractPatchSectionsDeterministic(combinedPatchContent);
    expect(result).not.toBeNull();

    // チャンピオン節（従来どおり、E53回帰なし）
    expect(result!.champions.map((c) => c.champion)).toEqual(["アジール", "ガレン"]);
    expect(result!.champions[0].changes).toEqual(["基本ステータス 攻撃力: 55 ⇒ 58"]);
    expect(result!.champions[1].changes).toEqual([
      "R - デマーシアの正義 確定ダメージ: 150/250/350 ⇒ 130/230/330",
    ]);

    // チャンピオン以外の節（アイテム/システム、直前のセクション見出しでグルーピング）
    expect(result!.other.map((s) => s.heading)).toEqual(["アイテム", "システム"]);
    expect(result!.other[0].changes).toEqual([
      "ラピッドファイアケーン 攻撃力: 60 ⇒ 65",
      "ドランシールド 体力: 80 ⇒ 90",
    ]);
    expect(result!.other[1].changes).toEqual(["召喚士呪文テレポート クールダウン: 360 ⇒ 330"]);

    // 逐語（部分文字列）維持の確認
    const flattenedLines = combinedPatchContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join(" ");
    for (const s of result!.other) {
      for (const change of s.changes) {
        expect(flattenedLines).toContain(change);
      }
    }

    // 存在しない種類（アリーナ/ルーン/バグ修正）は出ない
    expect(result!.other.map((s) => s.heading)).not.toContain("アリーナ");
    expect(result!.other.map((s) => s.heading)).not.toContain("ルーン");
    expect(result!.other.map((s) => s.heading)).not.toContain("バグ修正");
  });

  it("チャンピオンのみのfixture（アイテム/システム節なし）は、非チャンピオン節が空になる（E53回帰なし）", () => {
    const result = extractPatchSectionsDeterministic(championOnlyPatchContent);
    expect(result).not.toBeNull();
    expect(result!.champions.map((c) => c.champion)).toEqual(["アジール", "ガレン"]);
    expect(result!.other).toEqual([]);

    // 既存のチャンピオンのみ抽出関数と同じ結果になる（回帰なし）
    const legacyResult = extractPatchChangesDeterministic(championOnlyPatchContent);
    expect(legacyResult).toEqual(result!.champions);
  });

  it("チャンピオン節が無い(アイテムのみ)fixtureでは、チャンピオン配列が空でアイテム節のみ抽出される（臨機応変）", () => {
    const result = extractPatchSectionsDeterministic(itemOnlyPatchContent);
    expect(result).not.toBeNull();
    expect(result!.champions).toEqual([]);
    expect(result!.other.map((s) => s.heading)).toEqual(["アイテム"]);
    expect(result!.other[0].changes).toEqual([
      "インフィニティエッジ クリティカル率: 20 ⇒ 25",
      "ドランブレード 攻撃力: 8 ⇒ 10",
    ]);
  });

  it("変更点が全く無いテキストは null を返す", () => {
    const text = "パッチノートの本文らしきノイズテキストです。".repeat(10);
    expect(extractPatchSectionsDeterministic(text)).toBeNull();
  });

  it("非チャンピオンのセクション数は最大8個に有界化される（見出しは相異なる10個）", () => {
    const lines: string[] = [];
    for (let n = 0; n < 10; n++) {
      // 同一見出しはマージされるため、有界化の確認には相異なる見出し文字列を使う。
      lines.push(`アイテム${n}`, `テスト項目${n}`, `数値${n}: ${n} ⇒ ${n + 1}`);
    }
    const result = extractPatchSectionsDeterministic(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.other.length).toBe(8);
  });

  it("1セクションあたりの変更行は最大8行に有界化される", () => {
    const lines = ["アイテム"];
    for (let n = 0; n < 10; n++) {
      lines.push(`テスト項目${n}`, `数値${n}: ${n} ⇒ ${n + 1}`);
    }
    const result = extractPatchSectionsDeterministic(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.other.length).toBe(1);
    expect(result!.other[0].changes.length).toBe(8);
  });
});

describe("extractPatchSectionsDeterministic（E54修正: スキル/ステータスラベルの見出し誤昇格の修正）", () => {
  it("チャンピオン上限超過後の宙に浮いた変更が単一「その他の変更点」にまとまり、キーワード見出しのみ節になり、同名見出しがマージされる", () => {
    const result = extractPatchSectionsDeterministic(skillLabelMisclassificationFixture);
    expect(result).not.toBeNull();

    // チャンピオン節は上限12体まで（13体目のカミールは含まれない）
    expect(result!.champions).toHaveLength(12);
    expect(result!.champions.map((c) => c.champion)).toEqual(twelveOrdinaryChampions);
    expect(result!.champions.map((c) => c.champion)).not.toContain("カミール");
    // チャンピオン節内のスキルラベル（例「Rのダメージ」）はそのまま文脈として変更点に前置される
    expect(result!.champions[11].changes).toEqual(["Rのダメージ 攻撃力: 61 ⇒ 66"]);

    // 見出しはキーワードを含む節（アイテム・バグ修正）と総称見出しのみ。
    // スキル/ステータスラベルが独立の見出しとして誤昇格しない。
    expect(result!.other.map((s) => s.heading)).toEqual(["その他の変更点", "アイテム", "バグ修正"]);
    const otherHeadings = result!.other.map((s) => s.heading);
    for (const mislabel of ["Rのダメージ", "Eの掴み後の移動距離", "Qの減少体力反映率", "固有スキルの魔力反映率"]) {
      expect(otherHeadings).not.toContain(mislabel);
    }

    // 宙に浮いた変更（チャンピオン上限超過後・キーワード節の外）は単一の「その他の変更点」にまとまる
    const genericSection = result!.other.find((s) => s.heading === "その他の変更点");
    expect(genericSection?.changes).toEqual([
      "Eの掴み後の移動距離 300 ⇒ 350",
      "Qの減少体力反映率 0.5 ⇒ 0.6",
    ]);

    // アイテム節: キーワード見出しのみが節になり、中の項目ラベル（固有スキルの魔力反映率）は
    // 見出しにならず節内の変更点として前置される
    const itemSection = result!.other.find((s) => s.heading === "アイテム");
    expect(itemSection?.changes).toEqual([
      "ラピッドファイアケーン 攻撃力: 60 ⇒ 65",
      "固有スキルの魔力反映率 0.3 ⇒ 0.4",
    ]);

    // 同一見出し「バグ修正」が本文中に2回現れても1つのセクションにマージされる（重複排除）
    const bugfixSections = result!.other.filter((s) => s.heading === "バグ修正");
    expect(bugfixSections).toHaveLength(1);
    expect(bugfixSections[0].changes).toEqual([
      "特定条件で発生していた表示バグを修正: 発生 ⇒ 解消",
      "別の状況で発生していたバグも修正: 発生 ⇒ 解消",
    ]);
  });
});

describe("composeArticleBody（riot detailedパッチ本文のチャンピオン以外の節、拡張E54 F-E54-2）", () => {
  it("チャンピオン節（画像付き）→アイテム/システム節（見出し＋変更点のみ・画像なし）→linkButtonの順で臨機応変に組まれる", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: combinedPatchContent, sourceUrl },
      llm,
    );

    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings[0]).toBe("パッチ26.14 の変更点");
    // チャンピオン→アイテム→システムの順
    expect(headings).toEqual(["パッチ26.14 の変更点", "アジール", "ガレン", "アイテム", "システム"]);

    // チャンピオン節は画像付き（E53のまま）
    const azirHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "アジール");
    const azirImage = body[azirHeadingIndex + 1];
    expect(azirImage.type).toBe("image");
    expect(azirImage.type === "image" && azirImage.url).toBe(buildChampionSplashUrl("Azir"));

    // アイテム節は見出し直後が段落（画像なし）
    const itemHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "アイテム");
    const itemNextBlock = body[itemHeadingIndex + 1];
    expect(itemNextBlock.type).toBe("paragraph");
    expect(itemNextBlock.type === "paragraph" && itemNextBlock.text).toContain("攻撃力: 60 ⇒ 65");
    const itemSecondBlock = body[itemHeadingIndex + 2];
    expect(itemSecondBlock.type).toBe("paragraph");
    expect(itemSecondBlock.type === "paragraph" && itemSecondBlock.text).toContain("体力: 80 ⇒ 90");

    // システム節も見出し直後が段落（画像なし）
    const systemHeadingIndex = body.findIndex((b) => b.type === "heading" && b.text === "システム");
    const systemNextBlock = body[systemHeadingIndex + 1];
    expect(systemNextBlock.type).toBe("paragraph");
    expect(systemNextBlock.type === "paragraph" && systemNextBlock.text).toContain("クールダウン: 360 ⇒ 330");

    // 末尾は公式リンクボタン
    const lastBlock = body[body.length - 1];
    expect(lastBlock.type).toBe("linkButton");

    // アイテム/システム節に画像ブロックが挟まっていない（チャンピオン画像なし・E54の制約）ことを確認
    expect(body.slice(itemHeadingIndex).some((b) => b.type === "image")).toBe(false);
  });

  it("チャンピオン節のみのfixtureでは、アイテム/システム節の見出しが一切出ない（存在しない種類は出さない）", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: championOnlyPatchContent, sourceUrl },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["パッチ26.14 の変更点", "アジール", "ガレン"]);
    expect(headings).not.toContain("アイテム");
    expect(headings).not.toContain("システム");
  });

  it("チャンピオン変更が無い(アイテムのみ)fixtureでは、チャンピオン節を出さずアイテム節のみになる（臨機応変）", async () => {
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.15ノート公開", content: itemOnlyPatchContent, sourceUrl },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["パッチ26.15 の変更点", "アイテム"]);
    // チャンピオンのスプラッシュ画像は無い（imageUrl未指定・バナーなし・チャンピオンなし）
    expect(body.some((b) => b.type === "image")).toBe(false);
    const lastBlock = body[body.length - 1];
    expect(lastBlock.type).toBe("linkButton");
  });

  it("変更点が全く取れない場合は従来どおり事実速報にフォールバックする（回帰なし）", async () => {
    const noiseOnlyContent = "パッチノートの本文らしきノイズテキストです。".repeat(30);
    const body = await composeArticleBody(
      { sourceType: "riot", title: "パッチ26.14ノート公開", content: noiseOnlyContent, sourceUrl },
      llm,
    );
    const headings = body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toEqual(["パッチ26.14が公開"]);
  });
});

describe("generateArticleForCandidate（riot detailedパッチ記事、逐語一致率チェック通過の確認、拡張E54 F-E54-1）", () => {
  function candidate(overrides: Partial<GenerationCandidate> = {}): GenerationCandidate {
    return {
      id: "e54-1",
      sourceType: "riot",
      sourceUrl,
      title: "【パッチ】26.14 の主な変更点まとめ",
      content: combinedPatchContent,
      ...overrides,
    };
  }

  it("チャンピオン節＋アイテム/システム節を含む実データ相当のfixtureでGenerationErrorにならない", async () => {
    // 実ページ相当の「大量の非反復ノイズ」を混ぜて逐語一致率を薄める（generation-generate-article.test.ts
    // の buildRealisticPatchFixture と同じ設計方針）。
    const noise = Array.from(
      { length: 100 },
      (_, i) => `これはテスト用のダミー文${i}です。実際のパッチ内容とは関係ありません。`,
    ).join("");
    const patchText = [noise, combinedPatchContent, noise].join("\n\n");

    const result = await generateArticleForCandidate(candidate({ content: patchText }), llm);
    const headings = result.body.filter((b) => b.type === "heading").map((b) => b.text);
    expect(headings).toContain("アイテム");
    expect(headings).toContain("システム");
    expect(headings).toContain("アジール");
  });
});
