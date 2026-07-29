/**
 * PBE記事の収集・記事化への配線（PBE-S4 F-PBE4-2、opt-in・既定off）。
 *
 * env `PBE_ARTICLE_MODE`（既定off）。`on`のときのみCDragon（pbe/latest）を取得し、
 * pbe版≠latest版（＝本番準備中）を確認できた場合のみ、items/champions取得→diff→
 * PBE記事を生成/上書き更新する。**off/未設定では本モジュールの公開関数はDBにも外部APIにも
 * 一切アクセスしない no-op**（既存挙動を1バイトも変えない・回帰ゼロ・追加コストなし）。
 *
 * 不変条件:
 * - pbe==latest（差分なし）・バージョン取得失敗時は即return（CDragon items/champions取得の
 *   負荷を避ける・本体を止めない）。
 * - 一意化: `externalId = "pbe-<pbeバージョン>"`（Post.sourceType="riot"との複合ユニーク）で
 *   同一PBEパッチのPost/Articleを重複させず in-place 更新する（既存の記事更新機構と同方針）。
 * - hotness判定を経ず、`PBE_ARTICLE_MODE=on`のときだけ速報生成する（免除ソースと同じ考え方）。
 * - moderation（NG/出典/中傷）不通過なら記事を作らない/更新しない。
 * - 1回の失敗（fetch/生成/DB）は例外を投げず握り潰してログし、"fetch_failed"を返す
 *   （本体=既存パイプラインを止めない）。
 * - DBスキーマは変更しない（pbe由来・未確定は本文バッジ＋externalIdの`pbe-`プレフィックスで表現）。
 */
import { prisma } from "@/lib/prisma";
import {
  fetchCDragonVersions,
  fetchPbeItems,
  fetchLatestItems,
  buildJaNameMap,
  fetchPbeChampionSummary,
  fetchLatestChampionSummary,
  resolveCandidateChampionKeys,
  fetchPbeChampions,
  fetchLatestChampions,
  buildJaChampionNameMap,
} from "@/lib/collection/adapters/cdragon-pbe";
import { diffItems, toArticleBodyPatchChangeBlock as itemToBlock } from "@/lib/generation/pbe-item-diff";
import { diffChampions, toArticleBodyPatchChangeBlock as championToBlock } from "@/lib/generation/pbe-champion-diff";
import {
  composePbeArticleBody,
  buildPbeArticleTitle,
  extractPbeVersionLabel,
  CDRAGON_SITE_URL,
} from "@/lib/generation/pbe-compose";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { bodyBlocksToText } from "@/lib/search";
import type { CategoryLabel } from "@/lib/categories";

/** PBE記事はPostモデルの`sourceType`を「riot」で再利用する（公式データそのもの、新規sourceType追加なし）。 */
const PBE_SOURCE_TYPE = "riot" as const;
/** カテゴリは既存「パッチ/メタ」を流用する（新設カテゴリを増やさない、brief許容範囲）。 */
const PBE_CATEGORY: CategoryLabel = "パッチ/メタ";

/** `PBE_ARTICLE_MODE=on`のときだけtrue。既定off。 */
export function isPbeArticleModeEnabled(): boolean {
  return process.env.PBE_ARTICLE_MODE === "on";
}

export type PbeArticleRunResult =
  | { status: "disabled" }
  | { status: "no_diff" }
  | { status: "fetch_failed" }
  | { status: "moderation_rejected"; reason?: string }
  | { status: "created" | "updated"; articleId: string; postId: string; pbeVersion: string };

/**
 * PBE記事の生成/上書き更新を1回実行する（F-PBE4-2）。`PBE_ARTICLE_MODE`が無効なら
 * 即座に`{status:"disabled"}`（DBにも外部APIにも一切アクセスしない）。
 */
export async function runPbeArticleGeneration(now: Date = new Date()): Promise<PbeArticleRunResult> {
  if (!isPbeArticleModeEnabled()) {
    return { status: "disabled" };
  }

  try {
    const versions = await fetchCDragonVersions();
    if (!versions.pbe || !versions.latest) {
      return { status: "fetch_failed" };
    }
    // pbe==latest（差分なし＝本番反映済み）の場合、items/champions取得の負荷を避けるため即return。
    if (versions.pbe === versions.latest) {
      return { status: "no_diff" };
    }

    const [pbeItems, latestItems, pbeItemsJa] = await Promise.all([
      fetchPbeItems("default"),
      fetchLatestItems("default"),
      fetchPbeItems("ja_jp"),
    ]);
    const jaItemNames = buildJaNameMap(pbeItemsJa);
    const itemChanges = diffItems(pbeItems, latestItems, jaItemNames);

    const [pbeChampionSummary, latestChampionSummary] = await Promise.all([
      fetchPbeChampionSummary(),
      fetchLatestChampionSummary(),
    ]);
    const candidateKeys = resolveCandidateChampionKeys(pbeChampionSummary, latestChampionSummary);
    const [pbeChampions, latestChampions, pbeChampionsJa] = await Promise.all([
      fetchPbeChampions(candidateKeys),
      fetchLatestChampions(candidateKeys),
      fetchPbeChampions(candidateKeys, "ja_jp"),
    ]);
    const jaChampionNames = buildJaChampionNameMap(pbeChampionsJa);
    const championChanges = diffChampions(pbeChampions, latestChampions, jaChampionNames);

    if (itemChanges.length === 0 && championChanges.length === 0) {
      return { status: "no_diff" };
    }

    const pbeVersion = extractPbeVersionLabel(versions.pbe);
    const body = composePbeArticleBody({
      pbeVersion,
      championBlocks: championChanges.map(championToBlock),
      itemBlocks: itemChanges.map(itemToBlock),
    });
    const title = buildPbeArticleTitle(pbeVersion);
    const bodyText = bodyBlocksToText(body);

    // sourceCount=1（CommunityDragon）を渡し、出典欠落チェックを通過させる（実際のArticleSourceも作成する）。
    const moderation = moderateArticleContent({ title, bodyText, sourceCount: 1 });
    if (moderation.status !== "published") {
      return { status: "moderation_rejected", reason: moderation.reason };
    }

    const externalId = `pbe-${pbeVersion}`;

    const result = await prisma.$transaction(async (tx) => {
      // 一意化: sourceType="riot"+externalId="pbe-<ver>"のPostをupsertし、同一PBEパッチの
      // 重複行を作らない（既存persist-posts.tsと同じ複合ユニークキー）。
      const post = await tx.post.upsert({
        where: { sourceType_externalId: { sourceType: PBE_SOURCE_TYPE, externalId } },
        create: {
          sourceType: PBE_SOURCE_TYPE,
          externalId,
          title,
          body: bodyText,
          url: CDRAGON_SITE_URL,
          category: PBE_CATEGORY,
          postedAt: now,
          firstSeenAt: now,
          lastCheckedAt: now,
          monitoring: false,
        },
        update: {
          title,
          body: bodyText,
          lastCheckedAt: now,
        },
      });

      const existingArticle = await tx.article.findUnique({ where: { postId: post.id } });
      if (existingArticle) {
        await tx.article.update({
          where: { id: existingArticle.id },
          data: { title, body },
        });
        return { status: "updated" as const, articleId: existingArticle.id, postId: post.id };
      }

      const article = await tx.article.create({
        data: {
          slug: externalId,
          title,
          category: PBE_CATEGORY,
          body,
          publishedAt: now,
          status: "published",
          postId: post.id,
          sources: { create: [{ label: "CommunityDragon", url: CDRAGON_SITE_URL }] },
        },
      });
      return { status: "created" as const, articleId: article.id, postId: post.id };
    });

    return { ...result, pbeVersion };
  } catch (err) {
    console.error("PBE記事の生成に失敗しました。この回はスキップします（本体は継続）:", err);
    return { status: "fetch_failed" };
  }
}
