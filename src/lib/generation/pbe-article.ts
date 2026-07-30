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
 *
 * PBE-S5 F-PBE5-1（X取得の配線・コスト安全設計）: `X_API_KEY`が設定されており、かつ前回X取得から
 * `PBE_X_MIN_INTERVAL_HOURS`（既定6h）以上経過している場合にのみ`fetchPbeSourceTweets`を呼ぶ
 * （`X_API_KEY`未設定時はそもそも呼ばない＝CDragon自動分のみ・追加コスト0）。この関数はpbe版≠latest版
 * を確認済みの経路でのみ呼ばれるため、PBE窓の判定は`runPbeArticleGeneration`側の早期returnに委ねる。
 * X取得の成否に関わらず、実行した時刻を`pbe-x-rate-limit.ts`（ファイルベースの簡易状態保存、
 * DBスキーマ変更なし）に記録し、次回以降のレート制限判定に使う。
 *
 * PBE-S6 F-PBE6-3: `Article.thumbnailUrl`（既存の任意String列、スキーマ変更なし）に
 * `resolvePbeThumbnailUrl`（pbe-compose.ts）の結果を設定する。該当が無ければnullのままとし、
 * 表示側`ArticleThumbnail`の既存カテゴリ既定サムネイルへのフォールバックに委ねる。
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
  resolvePbeThumbnailUrl,
  CDRAGON_SITE_URL,
} from "@/lib/generation/pbe-compose";
import { fetchPbeSourceTweets, type PbeSourceTweet } from "@/lib/collection/adapters/pbe-x-source";
import { readPbeCurationNotes } from "@/lib/generation/pbe-curation";
import { isPbeXRateLimited, readLastPbeXFetchAt, writeLastPbeXFetchAt } from "@/lib/generation/pbe-x-rate-limit";
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

/** テスト・注入用オプション（PBE-S5）。既定はすべて実接続（env/実ファイルI/O）。 */
export type PbeArticleGenerationOptions = {
  /** 既定 env `X_API_KEY`。テストでの上書き用。 */
  apiKey?: string;
  /** 既定は実の`fetchPbeSourceTweets`。テストでの上書き用（実HTTPを叩かない単体テスト用）。 */
  fetchTweets?: (opts: { apiKey: string }) => Promise<PbeSourceTweet[]>;
  /** 既定は`readLastPbeXFetchAt`（ファイル読み込み）。テストでの上書き用。 */
  readLastXFetchAt?: () => Date | null;
  /** 既定は`writeLastPbeXFetchAt`（ファイル書き込み）。テストでの上書き用。 */
  writeLastXFetchAt?: (at: Date) => void;
  /** 人手キュレーションファイルパスの上書き（既定 `data/pbe-curation.json`）。 */
  curationFilePath?: string;
  /** env `PBE_X_MAX_TWEETS`の上書き（既定6）。 */
  maxTweets?: number;
};

/**
 * X（データマイナー）ツイートの取得（F-PBE5-1、コスト安全設計）。以下を全て満たすときだけ
 * 実際に`fetchPbeSourceTweets`相当を呼ぶ。呼び出さない/レート制限中の場合は空配列を返し
 * （＝Xセクションなし・CDragon自動分のみ）、取得失敗時も空配列で本体を止めない。
 * - `X_API_KEY`（`options.apiKey`優先）が設定されている（未設定ならそもそも呼ばない）。
 * - 前回X取得から`PBE_X_MIN_INTERVAL_HOURS`（既定6h）以上経過している（レート制限内ならスキップ）。
 * 呼び出し元は「pbe版≠latest版（PBE窓）」を確認済みの経路でのみこの関数を呼ぶ。
 */
async function maybeFetchPbeXTweets(now: Date, options: PbeArticleGenerationOptions): Promise<PbeSourceTweet[]> {
  const apiKey = options.apiKey ?? process.env.X_API_KEY;
  if (!apiKey) {
    return [];
  }

  const readLastFetchAt = options.readLastXFetchAt ?? readLastPbeXFetchAt;
  const writeLastFetchAt = options.writeLastXFetchAt ?? writeLastPbeXFetchAt;
  const lastFetchAt = readLastFetchAt();
  if (isPbeXRateLimited(now, lastFetchAt)) {
    console.log(`[pbe-article] レート制限内のためX取得をスキップします（前回取得: ${lastFetchAt?.toISOString()}）`);
    return [];
  }

  const fetchTweets = options.fetchTweets ?? ((opts: { apiKey: string }) => fetchPbeSourceTweets(opts));
  let tweets: PbeSourceTweet[] = [];
  try {
    tweets = await fetchTweets({ apiKey });
  } catch (err) {
    console.error("[pbe-article] Xツイートの取得に失敗しました。Xセクションなしで続行します:", err);
  } finally {
    // 成否に関わらず「取得を試みた」事実を記録し、次回以降のレート制限判定に使う
    // （失敗直後の連続リトライによる無駄なAPI呼び出しも抑制する）。
    writeLastFetchAt(now);
  }
  return tweets;
}

/**
 * PBE記事の生成/上書き更新を1回実行する（F-PBE4-2）。`PBE_ARTICLE_MODE`が無効なら
 * 即座に`{status:"disabled"}`（DBにも外部APIにも一切アクセスしない）。
 */
export async function runPbeArticleGeneration(
  now: Date = new Date(),
  options: PbeArticleGenerationOptions = {},
): Promise<PbeArticleRunResult> {
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

    // F-PBE5-1/F-PBE5-3: X（opt-in・コスト安全設計）と人手キュレーション（ファイルベース・任意）。
    // ここまで到達した時点でpbe≠latest（PBE窓）・差分ありが確定しているため、記事化されない
    // ケースへのX APIの無駄打ちは発生しない。
    const tweets = await maybeFetchPbeXTweets(now, options);
    const curationNotes = readPbeCurationNotes(pbeVersion, options.curationFilePath);

    const body = composePbeArticleBody({
      pbeVersion,
      championBlocks: championChanges.map(championToBlock),
      itemBlocks: itemChanges.map(itemToBlock),
      tweets,
      curationNotes,
      maxTweets: options.maxTweets,
    });
    const title = buildPbeArticleTitle(pbeVersion);
    const bodyText = bodyBlocksToText(body);
    // PBE-S6 F-PBE6-3: サムネイル（チャンピオンのスプラッシュ→先頭アイテムのアイコン→null＝
    // 呼び出し側ArticleThumbnailの既存カテゴリ既定にフォールバック）。
    const thumbnailUrl = resolvePbeThumbnailUrl(championChanges, itemChanges);

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
          data: { title, body, thumbnailUrl },
        });
        return { status: "updated" as const, articleId: existingArticle.id, postId: post.id };
      }

      const article = await tx.article.create({
        data: {
          slug: externalId,
          title,
          category: PBE_CATEGORY,
          body,
          thumbnailUrl,
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
