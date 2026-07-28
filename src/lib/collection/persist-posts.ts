/**
 * リファクタリングS2（収集の履歴化）: 収集アイテムを新経路 Post / PostMetricsHistory へ
 * 並行保存するサービス（F-S2-2）。現行の CollectedItem→記事化パイプラインは不変で、
 * ここはあくまで比較用データの蓄積のみを担う（判定・記事化にはまだ使わない）。
 *
 * 信頼境界: 1件の保存失敗は握り潰してログし、他アイテムの保存を継続する。呼び出し側
 * （pipeline.ts）を含め、このモジュール全体が例外で収集本体を止めることはない。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { RawCollectionItem, SourceType } from "@/lib/collection/types";

export type PersistPostsResult = {
  /** Post が upsert された（作成/更新された）件数。 */
  postCount: number;
  /** PostMetricsHistory が追記された件数（postCountと同数になる想定）。 */
  metricsCount: number;
};

/** 1件分の Post upsert + PostMetricsHistory 追記。失敗時は false を返す（例外は投げない）。 */
async function persistOneItem(item: RawCollectionItem, sourceType: SourceType, now: Date): Promise<boolean> {
  const externalId = item.externalId;
  if (!externalId) return false;

  try {
    // item.mediaが無くitem.imageUrl（riot等のog:image、拡張E42）のみ持つソースでも
    // Post.media.imageUrlに画像が入るようフォールバックする（リファクタリングS5c F-S5c-2）。
    // どちらも無ければundefinedのまま（create時は未設定＝null、update時はこの列を更新しない＝
    // 既存値を保持。既存の挙動を変えない）。
    const baseMedia = item.media ?? (item.imageUrl ? { imageUrl: item.imageUrl } : undefined);
    // パッチ記事刷新S2（F-S2-2）: DBスキーマ変更を避けるため、riot由来の生HTML（`item.html`）は
    // 既存のJSON列 `Post.media` にキー追加する形で保持する（未設定のソースは従来どおり無変更）。
    const media = (
      item.html
        ? { ...((baseMedia && typeof baseMedia === "object" && !Array.isArray(baseMedia) ? baseMedia : {}) as object), html: item.html }
        : baseMedia
    ) as Prisma.InputJsonValue | undefined;
    const post = await prisma.post.upsert({
      where: { sourceType_externalId: { sourceType, externalId } },
      create: {
        sourceType,
        externalId,
        title: item.title,
        body: item.content,
        url: item.sourceUrl ?? "",
        author: item.author ?? null,
        flair: item.flair ?? null,
        media,
        category: item.category ?? null,
        // 成長G1（F-G1-3）: 未取得（undefined）はnull扱い（論争度判定はupvoteRatio無しでもcomment比で行う）。
        upvoteRatio: item.upvoteRatio ?? null,
        postedAt: item.fetchedAt,
        firstSeenAt: now,
        lastCheckedAt: now,
        monitoring: true,
      },
      update: {
        title: item.title,
        body: item.content,
        url: item.sourceUrl ?? "",
        author: item.author ?? null,
        flair: item.flair ?? null,
        media,
        category: item.category ?? null,
        upvoteRatio: item.upvoteRatio ?? null,
        lastCheckedAt: now,
      },
    });

    await prisma.postMetricsHistory.create({
      data: {
        postId: post.id,
        score: item.score ?? 0,
        commentCount: item.commentCount ?? 0,
        capturedAt: now,
      },
    });
    return true;
  } catch (err) {
    console.error(
      `Post永続化に失敗しました(sourceType=${sourceType}, externalId=${externalId})。この1件をスキップして続行します:`,
      err,
    );
    return false;
  }
}

/**
 * externalId を持つアイテムのみ Post へ upsert し、PostMetricsHistory を1行追記する。
 * externalId が無いアイテムは無視する（後方互換・mock/未対応ソースでの回帰防止）。
 * 1件の失敗は他アイテムの処理を止めない。全体としても例外を投げない。
 */
export async function persistPosts(
  items: RawCollectionItem[],
  sourceType: SourceType,
  now: Date,
): Promise<PersistPostsResult> {
  let postCount = 0;
  let metricsCount = 0;
  for (const item of items) {
    if (!item.externalId) continue;
    const ok = await persistOneItem(item, sourceType, now);
    if (ok) {
      postCount += 1;
      metricsCount += 1;
    }
  }
  return { postCount, metricsCount };
}
