/**
 * 記事化候補キューのDB連携部分(F6)。重複排除・正規化の判定ロジック自体は dedupe.ts の
 * 純関数に委譲し、ここでは「対象アイテムの取得」「既存記事の出典URL(正規化後)集合の取得」
 * 「判定結果に応じたステータス更新」のみを担当する。
 */
import { prisma } from "@/lib/prisma";
import { buildCandidateQueue } from "@/lib/collection/dedupe";
import { normalizeUrl } from "@/lib/collection/normalize";
import type { SourceType } from "@/lib/collection/types";

export type QueueBuildSummary = {
  queuedCount: number;
  duplicateCount: number;
  alreadyArticledCount: number;
};

/**
 * 記事化候補キューを再構築する。articleId が設定済み(直接紐付け済み)のアイテムは対象から除外し、
 * 残りを「同一URL重複の一件化 → 既存記事の出典URLとの一致除外 → 類似話題クラスタリング」にかけて
 * ステータス(queued/duplicate/articled)をDBへ反映する。
 */
export async function rebuildCandidateQueue(): Promise<QueueBuildSummary> {
  const [items, articleSources] = await Promise.all([
    prisma.collectedItem.findMany({ where: { articleId: null } }),
    prisma.articleSource.findMany({ select: { url: true } }),
  ]);

  const articledNormalizedUrls = new Set(articleSources.map((s) => normalizeUrl(s.url)));

  const { queued, duplicates, alreadyArticled } = buildCandidateQueue(items, articledNormalizedUrls);

  // ステータスは3値しかないので、アイテムごとの個別 UPDATE(N+1)ではなく status ごとの
  // updateMany 3本にまとめる（対象0件のときはクエリを発行しない）。
  const setStatus = (targets: { id: string }[], status: string) =>
    targets.length > 0
      ? prisma.collectedItem.updateMany({
          where: { id: { in: targets.map((t) => t.id) } },
          data: { status },
        })
      : Promise.resolve();

  await Promise.all([
    setStatus(queued, "queued"),
    setStatus(duplicates, "duplicate"),
    setStatus(alreadyArticled, "articled"),
  ]);

  return { queuedCount: queued.length, duplicateCount: duplicates.length, alreadyArticledCount: alreadyArticled.length };
}

/**
 * 現在の記事化候補キュー(status="queued")を新しい順で取得する。UI/確認用の読み取り専用ヘルパ。
 * take を指定すると DB 側で件数を絞る（1回の実行で処理する候補数の上限など。全件取得→sliceの無駄を避ける）。
 * sourceType を指定すると、そのソース種別のみに絞る（拡張E48: カテゴリ別=ソース別の上限制御に使う）。
 * 未指定時は従来どおり全ソースが対象（回帰なし）。
 */
export async function listCandidateQueue(options: { take?: number; sourceType?: SourceType } = {}) {
  return prisma.collectedItem.findMany({
    where: {
      status: "queued",
      ...(options.sourceType != null ? { sourceType: options.sourceType } : {}),
    },
    orderBy: { fetchedAt: "desc" },
    ...(options.take != null ? { take: options.take } : {}),
  });
}
