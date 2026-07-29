/**
 * PBE記事本文の組み立て（PBE-S4 F-PBE4-1、純関数・DB非依存・AI不使用）。
 *
 * PBE-S1 `diffItems`／PBE-S2 `diffChampions` の結果（`toArticleBodyPatchChangeBlock` 変換済み、
 * kind:"item"/"champion" の `ArticleBodyPatchChangeBlock`）を受け取り、1本のPBE先行記事の
 * `ArticleBodyBlock[]` を組み立てる。入力ブロックの内容（対象名・数値・stat）は一切書き換えず
 * そのまま並べるだけ（逐語維持・捏造禁止）。
 *
 * 構成（brief F-PBE4-1）:
 * 1. 未確定バッジ段落（先頭固定）。
 * 2. 冒頭サマリ（数値集計のみの純テンプレ）。
 * 3. 目次（toc、既存パッチ記事と同じ構造を流用）。
 * 4. チャンピオンの変更（既存の3グループ振り分け=チャンピオンの強化/チャンピオンの弱体化/
 *    チャンピオンの調整（パッチ記事刷新S9で見出し文言変更）、`championBlocks[].direction`
 *    済みの値をそのまま使う。実在するグループだけ出す）。
 * 5. アイテムの変更（`toArticleBodyPatchChangeBlock`(pbe-item-diff.ts)がdirection固定"adjust"を
 *    返すため分類はせず単一章にまとめる）。
 * 6. スキル詳細の注意書き（S1/S2はスキル効果量を一切扱っていないため常に明示する）。
 * 7. 出典（「データ: CommunityDragon / Riot Games」＋CommunityDragonへのリンク）。
 *
 * `[data-lol-patch]`のLoL公式風デザイン・目次(toc)は既存 `ArticleBodyView`
 * （patchChangeブロックを1つでも含む本文を自動検出してラップする）をそのまま流用する
 * （このモジュール自身は表示に関与しない）。
 */
import type { ArticleBodyBlock, ArticleBodyPatchChangeBlock } from "@/lib/article-body";

/** 先頭固定の未確定バッジ段落（brief記載の文言そのまま）。 */
export const PBE_ARTICLE_BADGE_TEXT =
  "【PBE・未確定】これは本番反映前のPBE（テストサーバー）の情報です。正式リリース時に変更・撤回される可能性があります。";

/** スキル効果量（ダメージ・レシオ等）を本記事では扱っていないことの明示（捏造回避・誤情報リスク対策）。 */
export const PBE_SKILL_DETAIL_NOTICE_TEXT =
  "スキルのダメージ・レシオ等の詳細（スキル効果量）は本記事では扱っていません。公式パッチノート公開後にご確認ください。";

/** データ出典の明記（`docs/pbe-research.md` §4 の結論どおりの表記）。 */
export const PBE_ARTICLE_SOURCE_TEXT = "データ: CommunityDragon / Riot Games";

/** CommunityDragon（人間可読サイト）への出典リンク。キー不要・無料の公開サイト。 */
export const CDRAGON_SITE_URL = "https://www.communitydragon.org/";

/**
 * CDragonの生バージョン文字列（例 "16.16.8000032+branch.main.content.beta"）から
 * 表示用のパッチ番号ラベル（例 "16.16"）を抜き出す。パターンに一致しない場合は
 * 生文字列をそのまま返す（捏造しない・情報を失わない）。
 */
export function extractPbeVersionLabel(rawVersion: string): string {
  const match = rawVersion.match(/^(\d+\.\d+)/);
  return match ? match[1] : rawVersion;
}

/** タイトル（F-PBE4-3、AI不使用・ルール生成）。捏造しないパッチ番号ラベルのみを差し込む。 */
export function buildPbeArticleTitle(pbeVersion: string): string {
  return `【PBE先行】パッチ${pbeVersion}のチャンピオン・アイテム変更まとめ（テストサーバー・随時更新）`;
}

/** 冒頭サマリ（数値集計のみの純テンプレ、AI不使用）。 */
function buildIntroSummary(pbeVersion: string, championCount: number, itemCount: number): string {
  return `PBE ${pbeVersion} 時点で、チャンピオン${championCount}体・アイテム${itemCount}件の変更が確認されています（スキル効果量の詳細は公式パッチノートで確定）。`;
}

export type PbeComposeInput = {
  /** 表示用パッチ番号ラベル（例 "16.16"、`extractPbeVersionLabel`の戻り値を渡す想定）。 */
  pbeVersion: string;
  /** PBE-S2 `diffChampions`→`toArticleBodyPatchChangeBlock`変換済み（kind:"champion"）。 */
  championBlocks: ArticleBodyPatchChangeBlock[];
  /** PBE-S1 `diffItems`→`toArticleBodyPatchChangeBlock`変換済み（kind:"item"）。 */
  itemBlocks: ArticleBodyPatchChangeBlock[];
};

/**
 * PBE記事本文（`ArticleBodyBlock[]`）を組み立てる純関数。入力が空（championBlocks/itemBlocks
 * ともに0件）でも例外を投げず、バッジ・サマリ・スキル注意書き・出典のみの本文を返す
 * （呼び出し側=pipelineが「差分0件なら記事を作らない」を判断するため、この関数自体は空でも動く）。
 */
export function composePbeArticleBody(input: PbeComposeInput): ArticleBodyBlock[] {
  const { pbeVersion, championBlocks, itemBlocks } = input;

  // 既存パッチ記事と同じ3グループ振り分け（強化/弱体化/調整）。既に各ブロックのdirectionが
  // 済みの値（pbe-champion-diff.tsのtoArticleBodyPatchChangeBlockが算出済み）をそのまま使う。
  const buffChampions = championBlocks.filter((b) => b.direction === "buff");
  const nerfChampions = championBlocks.filter((b) => b.direction === "nerf");
  const adjustChampions = championBlocks.filter((b) => b.direction === "adjust");
  const championGroups: { heading: string; blocks: ArticleBodyPatchChangeBlock[] }[] = [
    { heading: "チャンピオンの強化", blocks: buffChampions },
    { heading: "チャンピオンの弱体化", blocks: nerfChampions },
    { heading: "チャンピオンの調整", blocks: adjustChampions },
  ].filter((g) => g.blocks.length > 0);

  const contentBlocks: ArticleBodyBlock[] = [];
  let anchorSeq = 0;
  function pushHeading(text: string): void {
    anchorSeq++;
    contentBlocks.push({ type: "heading", text, anchor: `pbe-sec-${anchorSeq}` });
  }

  for (const group of championGroups) {
    pushHeading(group.heading);
    contentBlocks.push(...group.blocks);
  }

  // アイテムはdirection固定"adjust"（pbe-item-diff.ts）のため分類せず単一章にまとめる（brief方針）。
  if (itemBlocks.length > 0) {
    pushHeading("アイテムの変更");
    contentBlocks.push(...itemBlocks);
  }

  pushHeading("スキル詳細について");
  contentBlocks.push({ type: "paragraph", text: PBE_SKILL_DETAIL_NOTICE_TEXT });

  const tocItems = contentBlocks
    .filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading")
    .map((h) => ({ label: h.text, anchor: h.anchor as string }));

  const blocks: ArticleBodyBlock[] = [];
  blocks.push({ type: "paragraph", text: PBE_ARTICLE_BADGE_TEXT });
  blocks.push({
    type: "paragraph",
    text: buildIntroSummary(pbeVersion, championBlocks.length, itemBlocks.length),
  });
  if (tocItems.length > 0) {
    blocks.push({ type: "toc", items: tocItems });
  }
  blocks.push(...contentBlocks);
  blocks.push({ type: "paragraph", text: PBE_ARTICLE_SOURCE_TEXT });
  blocks.push({ type: "linkButton", url: CDRAGON_SITE_URL, label: "▶ CommunityDragon（データ出典）を見る" });

  return blocks;
}
