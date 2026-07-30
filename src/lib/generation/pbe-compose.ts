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
 * 2. 冒頭サマリ（簡潔な導入文のみ・ルール生成。PBE-S6 F-PBE6-2で件数を数える文言は削除した）。
 * 3. 目次（toc、既存パッチ記事と同じ構造を流用）。
 * 4. チャンピオンの変更（既存の3グループ振り分け=チャンピオンの強化/チャンピオンの弱体化/
 *    チャンピオンの調整（パッチ記事刷新S9で見出し文言変更）、`championBlocks[].direction`
 *    済みの値をそのまま使う。実在するグループだけ出す）。
 * 5. アイテムの変更（`toArticleBodyPatchChangeBlock`(pbe-item-diff.ts)がdirection固定"adjust"を
 *    返すため分類はせず単一章にまとめる）。
 * 6. PBE-S5 F-PBE5-2/F-PBE5-3で追加: 「PBEのスキル変更（データマイナー情報・未確定）」
 *    （Xツイートの埋め込み/引用＋人手キュレーション、`tweets`/`curationNotes`いずれも未指定/空なら
 *    このセクション自体を出さない＝既存挙動を変えない）。
 * 7. スキル詳細の注意書き（S1/S2はスキル効果量を一切扱っていないため常に明示する）。
 * 8. 出典（「データ: CommunityDragon / Riot Games」＋CommunityDragonへのリンク）。
 *
 * `[data-lol-patch]`のLoL公式風デザイン・目次(toc)は既存 `ArticleBodyView`
 * （patchChangeブロックを1つでも含む本文を自動検出してラップする）をそのまま流用する
 * （このモジュール自身は表示に関与しない）。
 */
import type { ArticleBodyBlock, ArticleBodyPatchChangeBlock } from "@/lib/article-body";
import { isValidTweetStatusUrl } from "@/lib/embed";
import type { PbeSourceTweet } from "@/lib/collection/adapters/pbe-x-source";
import type { PbeCurationNote } from "@/lib/generation/pbe-curation";
import type { PbeChampionChange } from "@/lib/generation/pbe-champion-diff";
import type { PbeItemChange } from "@/lib/generation/pbe-item-diff";
import { buildChampionSplashUrl } from "@/lib/generation/champion-splash";
import { buildCDragonItemIconUrl } from "@/lib/collection/adapters/cdragon-pbe";
import { isSafeImageUrl } from "@/lib/image-url";

/** 先頭固定の未確定バッジ段落（brief記載の文言そのまま）。 */
export const PBE_ARTICLE_BADGE_TEXT =
  "【PBE・未確定】これは本番反映前のPBE（テストサーバー）の情報です。正式リリース時に変更・撤回される可能性があります。";

/** スキル効果量（ダメージ・レシオ等）を本記事では扱っていないことの明示（捏造回避・誤情報リスク対策）。 */
export const PBE_SKILL_DETAIL_NOTICE_TEXT =
  "スキルのダメージ・レシオ等の詳細（スキル効果量）は本記事では扱っていません。公式パッチノート公開後にご確認ください。";

/** データ出典の明記（`docs/pbe-research.md` §4 の結論どおりの表記）。 */
export const PBE_ARTICLE_SOURCE_TEXT = "データ: CommunityDragon / Riot Games";

/** X/人手キュレーションのスキル変更セクション見出し（PBE-S5 F-PBE5-2）。 */
export const PBE_X_SECTION_HEADING = "PBEのスキル変更（データマイナー情報・未確定）";

/** セクション冒頭の未確定注記（brief記載の文言そのまま、PBE-S5 F-PBE5-2）。 */
export const PBE_X_SECTION_NOTICE_TEXT =
  "以下はデータマイナー（Spideraxe氏）およびRiot開発陣のPBE投稿に基づく未確定情報です。数値は本番リリース時に変更される場合があります。正式な数値は公式パッチノートで確定します。";

/** 1記事あたりのツイート埋め込み件数上限の既定値（env `PBE_X_MAX_TWEETS`で上書き可能）。 */
const DEFAULT_PBE_X_MAX_TWEETS = 6;

/** env `PBE_X_MAX_TWEETS`（未設定・不正値は既定6）を読む。`override`があればそちらを優先する（テスト用）。 */
function resolvePbeXMaxTweets(override: number | undefined): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  const raw = Number(process.env.PBE_X_MAX_TWEETS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_PBE_X_MAX_TWEETS;
}

/**
 * PbeSourceTweet 1件をブロックへ変換する（F-PBE5-2）。有効なtweet status URL
 * （`isValidTweetStatusUrl`）なら公式oEmbed埋め込み（`embed`ブロック、既存G7/E22の埋め込み表示を
 * 流用）、そうでなければ短い引用（逐語text）＋画像（mediaUrls）＋出典（作者ハンドル・tweet URL）に
 * する。逐語維持・数値を書き換えない（捏造禁止）。
 */
function buildTweetBlocks(tweet: PbeSourceTweet): ArticleBodyBlock[] {
  if (isValidTweetStatusUrl(tweet.url)) {
    return [{ type: "embed", provider: "twitter", url: tweet.url, caption: `@${tweet.authorHandle}` }];
  }
  const blocks: ArticleBodyBlock[] = [
    { type: "quote", text: tweet.text, source: `@${tweet.authorHandle}（${tweet.url}）` },
  ];
  for (const mediaUrl of tweet.mediaUrls) {
    blocks.push({
      type: "image",
      url: mediaUrl,
      alt: `${tweet.author}氏の投稿画像`,
      credit: `@${tweet.authorHandle}`,
    });
  }
  return blocks;
}

/** 人手キュレーションノート1件をブロックへ変換する（F-PBE5-3）。逐語のtextをそのまま引用表示する。 */
function buildCurationBlocks(note: PbeCurationNote): ArticleBodyBlock[] {
  const label = [note.champion, note.skill].filter((s): s is string => Boolean(s)).join(" ");
  const source = label
    ? `${label}（人手キュレーション・出典: ${note.source}）`
    : `人手キュレーション・出典: ${note.source}`;
  return [{ type: "quote", text: note.text, source }];
}

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

/**
 * 冒頭サマリ（AI不使用・ルール生成）。PBE-S6 F-PBE6-2: 件数を数える文言は削除する
 * （「チャンピオン0体」等の不体裁を避ける。件数を出さない簡潔な導入文のみ）。
 */
function buildIntroSummary(pbeVersion: string): string {
  return `PBE ${pbeVersion}（テストサーバー）で確認された変更のまとめです。正式な数値は公式パッチノートで確定します。`;
}

/**
 * PBE記事のサムネイルURLを決定する（PBE-S6 F-PBE6-3、優先順: チャンピオンのスプラッシュ→
 * 変更のあった先頭アイテムのアイコン→null）。`isSafeImageUrl`で検証し、壊れた/組み立てられない
 * URLは次の優先順位にフォールバックする。すべて該当が無い/壊れている場合は null を返し、
 * 呼び出し側（`ArticleThumbnail`）の既存カテゴリ既定サムネイル（例 `/default-thumb-patch-meta.svg`）
 * へのフォールバックに委ねる（新規デフォルト画像を用意しなくても記事は壊れない）。
 */
export function resolvePbeThumbnailUrl(
  championChanges: Pick<PbeChampionChange, "id">[],
  itemChanges: Pick<PbeItemChange, "iconPath">[],
): string | null {
  const firstChampionId = championChanges[0]?.id;
  if (firstChampionId) {
    const splashUrl = buildChampionSplashUrl(firstChampionId);
    if (isSafeImageUrl(splashUrl)) return splashUrl;
  }

  const firstItemIconPath = itemChanges[0]?.iconPath;
  const itemIconUrl = buildCDragonItemIconUrl(firstItemIconPath);
  if (isSafeImageUrl(itemIconUrl)) return itemIconUrl;

  return null;
}

export type PbeComposeInput = {
  /** 表示用パッチ番号ラベル（例 "16.16"、`extractPbeVersionLabel`の戻り値を渡す想定）。 */
  pbeVersion: string;
  /** PBE-S2 `diffChampions`→`toArticleBodyPatchChangeBlock`変換済み（kind:"champion"）。 */
  championBlocks: ArticleBodyPatchChangeBlock[];
  /** PBE-S1 `diffItems`→`toArticleBodyPatchChangeBlock`変換済み（kind:"item"）。 */
  itemBlocks: ArticleBodyPatchChangeBlock[];
  /** PBE-S5 F-PBE5-2: データマイナー(Spideraxe/Phroxzon)のXツイート。未指定/空ならセクション自体を出さない。 */
  tweets?: PbeSourceTweet[];
  /** PBE-S5 F-PBE5-3: 人手キュレーションノート。未指定/空ならセクション自体を出さない。 */
  curationNotes?: PbeCurationNote[];
  /** テスト・注入用。既定は env `PBE_X_MAX_TWEETS`（未設定時6）。 */
  maxTweets?: number;
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

  // PBE-S5 F-PBE5-2/F-PBE5-3: X（データマイナー）ツイート・人手キュレーションの統合。
  // 両方とも未指定/空ならこのセクション自体を出さない（既存挙動を変えない＝回帰ゼロ）。
  const tweets = (input.tweets ?? []).slice(0, resolvePbeXMaxTweets(input.maxTweets));
  const curationNotes = input.curationNotes ?? [];
  if (tweets.length > 0 || curationNotes.length > 0) {
    pushHeading(PBE_X_SECTION_HEADING);
    contentBlocks.push({ type: "paragraph", text: PBE_X_SECTION_NOTICE_TEXT });
    for (const note of curationNotes) {
      contentBlocks.push(...buildCurationBlocks(note));
    }
    for (const tweet of tweets) {
      contentBlocks.push(...buildTweetBlocks(tweet));
    }
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
    text: buildIntroSummary(pbeVersion),
  });
  if (tocItems.length > 0) {
    blocks.push({ type: "toc", items: tocItems });
  }
  blocks.push(...contentBlocks);
  blocks.push({ type: "paragraph", text: PBE_ARTICLE_SOURCE_TEXT });
  blocks.push({ type: "linkButton", url: CDRAGON_SITE_URL, label: "▶ CommunityDragon（データ出典）を見る" });

  return blocks;
}
