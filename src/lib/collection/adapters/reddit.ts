/**
 * Reddit（海外の反応）から取得する live アダプタ（拡張E46でArctic Shiftへ全面切替）。
 *
 * 経緯: 公式OAuth（Application-only）は認証情報未設定時に常に空・かつ投稿本文のみでコメント無し＝弱い。
 * 無認証の公式JSONは403、RSSはレート制限が厳しく無人運用に不向き（検証済み）。PullPushはデータが
 * 約14か月古く不採用。**Arctic Shift**（`arctic-shift.photon-reddit.com`・無認証・無料）は最新データが
 * あるが、スコアはAPI側でソート/絞込できず（`created_utc`順のみ）、作成直後はスコアが未反映で
 * 2日程度でバックフィルされる特性がある。
 *
 * 成長G8（速報性向上）: 実測で「投稿直後0〜6時間はscore中央値=1・最大=1」を確認済み。窓を単純短縮すると
 * 新規投稿はscore足切りに全滅するため、**「収集の足切り」と「記事化の判定」を分離**する。
 * 取得窓（`computeFetchWindow`）は前寄せしつつ、窓内の投稿を「監視ウィンドウ内（新しい）」と
 * 「監視ウィンドウ外（古い）」に分け、古い投稿だけ従来どおりscore足切りを適用し、新しい投稿は
 * score足切りをせず（num_comments下限のみで無反応/bot投稿を除く）Postとして保存・監視対象に入れる
 * （`selectPostsForCollection`）。記事化はあくまで既存 HotnessEvaluator（増加率＝初速判定を含む）に
 * 委ねるため、本アダプタ・`persist-posts.ts`・記事化ロジックには一切手を入れない。
 * 監視対象の暴走防止に、新しい投稿側の選抜件数に上限（`maxMonitorCandidates`）を設ける。
 *
 * 信頼境界（外部API）: `fetchJsonSafe`（タイムアウト付き）。HTTPエラー・不正JSON・ネットワーク断は
 * いずれも例外を投げず握り潰して空配列を返す（1ソースの失敗が収集パイプライン全体を止めない方針。
 * riot/5ch live アダプタと同方針）。キー不要のため常に試行する。
 * Redditの返す本文（title/selftext/コメントbody）は信頼できないユーザー生成テキストとして扱い、
 * 整形済みのスレッドダンプ文字列を content に入れるのみでHTMLとして解釈させる経路には入れない
 * （安全フィルタ・XSSエスケープ・出典必須は既存の生成/表示層が担保）。逐語は不変（選定・整形のみ）。
 */
import type { RawCollectionItem, SourceAdapter } from "@/lib/collection/types";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import { fetchJsonSafe, dedupeBySourceUrl } from "@/lib/collection/adapters/http";

const ARCTIC_SHIFT_BASE = "https://arctic-shift.photon-reddit.com/api";
/** 5chアダプタ同様、説明的な既定UA（env `REDDIT_USER_AGENT` で上書き可）。 */
const DEFAULT_USER_AGENT = "lol-matome-sokuhou-collector/1.0 (bot; +contact via operator CONTACT_EMAIL)";

/** 投稿選別の下限スコア（既定50、監視ウィンドウ外＝古い投稿にのみ適用。env `REDDIT_MIN_SCORE` で上書き可）。 */
const DEFAULT_MIN_SCORE = 50;
/** 収集対象にする「古い」投稿数の上限（既定5。env `REDDIT_MAX_THREADS` で上書き可）。 */
const DEFAULT_MAX_THREADS = 5;
/** 1投稿あたり取り込むコメント数の上限（既定20。env `REDDIT_MAX_COMMENTS` で上書き可）。 */
const DEFAULT_MAX_COMMENTS = 20;
/**
 * 取得窓の下限（何時間前までを対象にするか。成長G8で日粒度(2日)から時間粒度・前寄せに変更、既定12時間。
 * env `REDDIT_MIN_AGE_HOURS` で上書き可）。
 */
const DEFAULT_MIN_AGE_HOURS = 12;
/**
 * 取得窓の上限（何時間前から遡るか。成長G8で日粒度(4日)から時間粒度に変更、既定72時間(約3日)。
 * env `REDDIT_MAX_AGE_HOURS` で上書き可）。
 */
const DEFAULT_MAX_AGE_HOURS = 72;
/**
 * 監視ウィンドウ（成長G8 F-G8-2）: 投稿からこの時間以内なら「新しい投稿」としてscore足切りをせず
 * Post保存・監視対象に入れる（既定24時間。env `REDDIT_MONITOR_MAX_AGE_HOURS` で上書き可）。
 */
const DEFAULT_MONITOR_MAX_AGE_HOURS = 24;
/**
 * 監視ウィンドウ内の投稿に適用する最低限のノイズ抑制フィルタ（成長G8 F-G8-2）:
 * `num_comments` がこれ未満の投稿（bot投稿・無反応投稿）は監視対象にしない（既定1。
 * env `REDDIT_MONITOR_MIN_COMMENTS` で上書き可）。
 */
const DEFAULT_MONITOR_MIN_COMMENTS = 1;
/**
 * 監視ウィンドウ内（新しい投稿）から選抜する件数の上限（成長G8 F-G8-2、監視対象の暴走防止）。
 * 既定5。env `REDDIT_MAX_MONITOR_CANDIDATES` で上書き可。
 */
const DEFAULT_MAX_MONITOR_CANDIDATES = 5;
/**
 * コメント選抜で「議論(返信の多い)コメント」に確保する枠数（成長G8 F-G8-3）。
 * 既定2。env `REDDIT_DISCUSSION_COMMENT_SLOTS` で上書き可。コメントに返信数データが1件も無ければ
 * この枠は使わず現状どおりscore降順のみになる（回帰なし）。
 */
const DEFAULT_DISCUSSION_COMMENT_SLOTS = 2;
/** 連続fetch間のディレイ(ms)（既定1000。env `REDDIT_REQUEST_DELAY_MS` で上書き可）。 */
const DEFAULT_REQUEST_DELAY_MS = 1000;
/** 投稿本文(selftext)抜粋の最大長（有界化）。 */
const SELFTEXT_EXCERPT_MAX_LENGTH = 500;

/** 非負整数のenv値をパースする（不正・未設定はfallback）。 */
function envIntLocal(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type RedditPostData = {
  id: string;
  permalink?: string;
  title: string;
  selftext?: string;
  created_utc: number;
  score?: number;
  /** 成長G1（F-G1-3）: upvote比率（0〜1）。Arctic Shiftが返す。低いほど賛否が割れているサイン。 */
  upvote_ratio?: number;
  stickied?: boolean;
  over_18?: boolean;
  /** 投稿画像プレビュー（Redditが自動生成する画像バリエーション）。あれば最優先で使う。 */
  preview?: { images?: { source?: { url?: string } }[] };
  /** サムネイルURL、または"self"/"default"/"nsfw"/"spoiler"等の非画像プレースホルダー文字列。 */
  thumbnail?: string;
  /** コメント数（リファクタリングS2: PostMetricsHistory.commentCount に使う）。 */
  num_comments?: number;
  /** 投稿者ユーザー名（リファクタリングS2: Post.author に使う）。 */
  author?: string;
  /** flair（リファクタリングS2: Post.flair に使う）。 */
  link_flair_text?: string | null;
  /** リンク先URL（自己投稿の場合はpermalinkと同じ。リファクタリングS2: Post.mediaに使う）。 */
  url?: string;
};

export type RedditCommentData = {
  id: string;
  body?: string;
  score?: number;
  author?: string;
  /**
   * 返信数（成長G8 F-G8-3: 議論＝賛否が割れているコメントの選抜に使う）。Arctic Shiftが返す場合のみ
   * 設定される想定。無ければ未設定のままでよい（このフィールドを持つコメントが1件も無ければ
   * 議論コメント枠は使わず、現状どおりscore降順のみで選抜する）。
   */
  num_replies?: number;
  /**
   * 親要素ID（resel-S1 F-RS1-2）。Arctic Shift `comments/search` の実応答で確認済み
   * （`t1_<コメントid>`=親が別コメント／`t3_<投稿id>`=親が投稿本体＝OP）。
   * `buildRedditThreadDump` が「親が選抜済みの別コメントのときだけ」`(parent:P)`を行頭注釈として付与する
   * のに使う（本文には混入しない）。未設定・不明形式・親が選抜対象外なら付与しない（回帰なし）。
   */
  parent_id?: string;
};

type ArcticShiftPostsResponse = { data?: RedditPostData[] };
type ArcticShiftCommentsResponse = { data?: RedditCommentData[] };

/** 投稿検索エンドポイントのURLを組み立てる（取得窓はISO日時文字列で渡す）。 */
export function buildPostsSearchUrl(subreddit: string, afterIso: string, beforeIso: string): string {
  const params = new URLSearchParams({
    subreddit,
    after: afterIso,
    before: beforeIso,
    limit: "100",
    sort: "desc",
  });
  return `${ARCTIC_SHIFT_BASE}/posts/search?${params.toString()}`;
}

/** コメント検索エンドポイントのURLを組み立てる。 */
export function buildCommentsSearchUrl(postId: string): string {
  const params = new URLSearchParams({ link_id: postId, limit: "100", sort: "desc" });
  return `${ARCTIC_SHIFT_BASE}/comments/search?${params.toString()}`;
}

/**
 * 投稿ID指定の現在値取得エンドポイントURLを組み立てる（リファクタリングS4 F-S4-1、確認済みエンドポイント）。
 */
export function buildPostsByIdsUrl(externalId: string): string {
  const params = new URLSearchParams({ ids: externalId });
  return `${ARCTIC_SHIFT_BASE}/posts/ids?${params.toString()}`;
}

/** 投稿permalinkから一意・安定な絶対URLを構築する（permalink無ければ `.../comments/<id>` にフォールバック）。 */
export function buildPostUrl(post: Pick<RedditPostData, "id" | "permalink">): string {
  if (post.permalink && post.permalink.trim().length > 0) {
    return `https://www.reddit.com${post.permalink}`;
  }
  return `https://www.reddit.com/comments/${post.id}`;
}

export type FetchWindow = { afterIso: string; beforeIso: string };

/**
 * 取得窓（after/before）を計算する純関数（拡張E46 F-E46-1、成長G8 F-G8-1で日粒度→時間粒度に変更）。
 * Arctic Shiftはスコアが作成直後は未反映でバックフィルされる特性があるため取得窓自体は必要だが、
 * 「収集の足切り」は監視ウィンドウ（`selectPostsForCollection`）側で分離したため、この窓は前寄せできる
 * （既定 `maxAgeHours前`〜`minAgeHours前`）。`now` はテスト注入可能。
 */
export function computeFetchWindow(now: Date, minAgeHours: number, maxAgeHours: number): FetchWindow {
  const msPerHour = 60 * 60 * 1000;
  const after = new Date(now.getTime() - maxAgeHours * msPerHour);
  const before = new Date(now.getTime() - minAgeHours * msPerHour);
  return { afterIso: after.toISOString(), beforeIso: before.toISOString() };
}

/**
 * 投稿配列からタイトルがLoL関連キーワードに一致する投稿のみを残す（sticky/NSFW/スコア絞込は行わない）。
 */
export function matchKeywordPosts(posts: RedditPostData[], keywords: string[]): RedditPostData[] {
  const lowerKeywords = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 0);
  return posts.filter((p) => {
    const lowerTitle = p.title.toLowerCase();
    return lowerKeywords.some((k) => lowerTitle.includes(k));
  });
}

/**
 * 投稿を選抜する純関数（拡張E46 F-E46-1）。`stickied`・`over_18` を除外し、タイトルがキーワードに
 * 一致し、`score >= minScore` の投稿のみを残す。score降順にソートし上位 `limit` 件を返す。
 */
export function selectRelevantPosts(
  posts: RedditPostData[],
  keywords: string[],
  minScore: number,
  limit: number,
): RedditPostData[] {
  const candidates = posts.filter((p) => !p.stickied && !p.over_18);
  const keywordMatched = matchKeywordPosts(candidates, keywords);
  const qualified = keywordMatched.filter((p) => (p.score ?? 0) >= minScore);
  const sorted = [...qualified].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return sorted.slice(0, Math.max(0, limit));
}

export type SelectPostsForCollectionOptions = {
  keywords: string[];
  /** 古い投稿（監視ウィンドウ外）に適用するscore下限。 */
  minScore: number;
  /** 古い投稿から選抜する件数の上限。 */
  maxThreads: number;
  /** 現在時刻（投稿からの経過時間の算出に使う）。 */
  now: Date;
  /** これ以内なら「新しい投稿」として監視ウィンドウ内に分類する時間数。 */
  monitorMaxAgeHours: number;
  /** 新しい投稿に適用する`num_comments`下限（ノイズ抑制）。 */
  monitorMinComments: number;
  /** 新しい投稿から選抜する件数の上限（監視対象の暴走防止）。 */
  maxMonitorCandidates: number;
};

/**
 * 投稿を「収集の足切り」（記事化の質ゲートとは別）で選抜する純関数（成長G8 F-G8-2）。
 * stickied/over_18除外・キーワード一致は共通で適用したうえで、投稿を経過時間で
 * 「古い投稿（監視ウィンドウ外）」と「新しい投稿（監視ウィンドウ内）」に分ける。
 *
 * - 古い投稿: 従来どおり `selectRelevantPosts` と同じ規則（score下限＋降順＋`maxThreads`件）。
 *   バックフィルが効いており伸びなかった投稿を今さら拾わない。
 * - 新しい投稿: score下限を適用せず、`num_comments >= monitorMinComments` のみでノイズ抑制し、
 *   `maxMonitorCandidates`件まで選抜する（監視対象として早期にPost保存し、記事化は既存
 *   HotnessEvaluatorの増加率判定に委ねる）。
 *
 * 戻り値は「古い投稿の選抜結果＋新しい投稿の選抜結果」の結合（重複は無い。経過時間で排他的に分類するため）。
 */
export function selectPostsForCollection(
  posts: RedditPostData[],
  options: SelectPostsForCollectionOptions,
): RedditPostData[] {
  const candidates = posts.filter((p) => !p.stickied && !p.over_18);
  const keywordMatched = matchKeywordPosts(candidates, options.keywords);

  const oldPosts: RedditPostData[] = [];
  const newPosts: RedditPostData[] = [];
  for (const p of keywordMatched) {
    const ageHours = (options.now.getTime() - p.created_utc * 1000) / 3600000;
    if (ageHours <= options.monitorMaxAgeHours) {
      newPosts.push(p);
    } else {
      oldPosts.push(p);
    }
  }

  // 古い投稿: 既にsticky/nsfw/キーワードは適用済みのため、selectRelevantPostsのscore下限/降順/limitのみが効く。
  const oldSelected = selectRelevantPosts(oldPosts, options.keywords, options.minScore, options.maxThreads);

  // 新しい投稿: score足切りはせず、num_comments下限のみでノイズ抑制。監視上限で頭打ち。
  const newQualified = newPosts.filter((p) => (p.num_comments ?? 0) >= options.monitorMinComments);
  const newSorted = [...newQualified].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const newSelected = newSorted.slice(0, Math.max(0, options.maxMonitorCandidates));

  return [...oldSelected, ...newSelected];
}

/** コメント本文が実質空（削除・除去・空白のみ）かどうか。 */
function isEmptyOrRemovedBody(body: string | undefined): boolean {
  if (!body) return true;
  const trimmed = body.trim();
  return trimmed.length === 0 || trimmed === "[deleted]" || trimmed === "[removed]";
}

export type SelectTopCommentsOptions = {
  /**
   * 返信数上位から確保する「議論(賛否が割れている)コメント」の枠数（成長G8 F-G8-3）。
   * 未指定/0、または対象コメントに `num_replies` を持つものが1件も無ければこの枠は使わず、
   * 従来どおりscore降順のみで選抜する（回帰なし）。
   */
  discussionSlots?: number;
};

/**
 * コメントを整形する純関数（拡張E46 F-E46-1、成長G8 F-G8-3で議論コメント枠を追加）。
 * `[deleted]`/`[removed]`/空本文/`AutoModerator` を除外し、score降順で上位 `limit` 件を返す
 * （逐語は不変・選定のみ）。`options.discussionSlots` が指定され、かつ対象コメントのいずれかに
 * `num_replies`（返信数）が設定されている場合は、末尾の`discussionSlots`件を「score上位に
 * 含まれない中で返信数が多いコメント」に差し替える（賛否両論の議論を拾う）。返信数データが
 * 無ければ現状どおりscore降順のみ（回帰しない）。
 */
export function selectTopComments(
  comments: RedditCommentData[],
  limit: number,
  options: SelectTopCommentsOptions = {},
): RedditCommentData[] {
  const filtered = comments.filter(
    (c) => !isEmptyOrRemovedBody(c.body) && c.author?.toLowerCase() !== "automoderator",
  );
  const effectiveLimit = Math.max(0, limit);
  const byScoreDesc = [...filtered].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const discussionSlots = options.discussionSlots ?? 0;
  const hasReplyData = filtered.some((c) => typeof c.num_replies === "number");
  if (discussionSlots <= 0 || !hasReplyData || effectiveLimit === 0) {
    return byScoreDesc.slice(0, effectiveLimit);
  }

  const scoreSlots = Math.max(0, effectiveLimit - discussionSlots);
  const topByScore = byScoreDesc.slice(0, scoreSlots);
  const usedIds = new Set(topByScore.map((c) => c.id));

  const discussionSorted = filtered
    .filter((c) => !usedIds.has(c.id) && typeof c.num_replies === "number")
    .sort((a, b) => (b.num_replies ?? 0) - (a.num_replies ?? 0));
  const discussionPicked = discussionSorted.slice(0, effectiveLimit - topByScore.length);

  return [...topByScore, ...discussionPicked];
}

/** OP本文（title＋selftext冒頭抜粋）を組み立てる（有界化。改行はスペースに畳んで1レス化）。 */
function buildOpBodyLine(post: RedditPostData): string {
  const selftext = post.selftext?.trim();
  if (!selftext) return post.title;
  const excerpt =
    selftext.length > SELFTEXT_EXCERPT_MAX_LENGTH ? `${selftext.slice(0, SELFTEXT_EXCERPT_MAX_LENGTH)}…` : selftext;
  return `${post.title}\n${excerpt}`;
}

/**
 * コメントの `parent_id`（`t1_<id>`=親が別コメント／`t3_<id>`=親が投稿本体）から、選抜済みコメント内の
 * 親のレス番号を解決する純関数（resel-S1 F-RS1-2）。親が投稿本体（OP）の場合・parent_idが無い/不明形式
 * の場合・親が選抜対象外（`numberById` に無い）の場合は null（アンカーを付けない＝ダングリング参照防止）。
 */
function resolveParentAnchorNumber(parentId: string | undefined, numberById: Map<string, number>): number | null {
  if (!parentId) return null;
  const match = parentId.match(/^t1_(.+)$/);
  if (!match) return null; // t3_（投稿本体=OP）または不明形式はアンカーを付けない
  return numberById.get(match[1]) ?? null;
}

/**
 * OP＋上位コメントを `parseThreadReses` が解釈するスレッドダンプ（`"N: 本文\n\n…"`）に組み立てる純関数
 * （拡張E46 F-E46-1、resel-S1 F-RS1-2でscore注釈と親情報を追加）。レス1=OP、レス2..=上位コメント本文
 * （逐語・改行保持）。scoreが取得済みのコメントは `"N (score:M): 本文"`、親（`parent_id`）が選抜済みの
 * 別コメント（OPではない）を指す場合は `"N (score:M parent:P): 本文"` の**行頭注釈**として付与する
 * （両方無ければ注釈なしの `"N: 本文"`）。
 *
 * **重要（resel-S1 FAIL修正）**: 本文（body）には一切 `>>N` を埋め込まない。`extractAnchors` は本文中の
 * `>>N` のみを見るため、本文に埋め込むと選定ロジック（`selectMajorConversationCluster`）の挙動が
 * S1で変化してしまう（回帰）。親情報は本文から独立した行頭の`(parent:P)`注釈として持ち回り、
 * `parseThreadReses` がパース時に`parentNumber`へ剥がす（S2で選定に使う想定）。parent_idが無い/
 * 不明形式/親が選抜対象外の場合はparent注釈を付けない（回帰なし）。
 */
export function buildRedditThreadDump(post: RedditPostData, comments: RedditCommentData[]): string {
  const parts = [`1: ${buildOpBodyLine(post)}`];
  const numberById = new Map<string, number>();
  comments.forEach((c, idx) => numberById.set(c.id, idx + 2));

  comments.forEach((c, idx) => {
    const number = idx + 2;
    const body = (c.body ?? "").trim();
    const parentAnchor = resolveParentAnchorNumber(c.parent_id, numberById);
    const annotationParts: string[] = [];
    if (typeof c.score === "number") annotationParts.push(`score:${c.score}`);
    if (parentAnchor !== null) annotationParts.push(`parent:${parentAnchor}`);
    const annotation = annotationParts.length > 0 ? ` (${annotationParts.join(" ")})` : "";
    parts.push(`${number}${annotation}: ${body}`);
  });
  return parts.join("\n\n");
}

/** Redditが返す非画像のプレースホルダー thumbnail 値（"self"投稿・画像なし・NSFW/スポイラー隠し等）。 */
const NON_IMAGE_THUMBNAIL_VALUES = new Set(["self", "default", "nsfw", "spoiler", "image", ""]);

/**
 * 投稿の画像URLを抽出する（拡張E19 F-E19-3を踏襲）。`preview.images[0].source.url`（HTMLエンティティ
 * `&amp;` をデコード）を最優先し、無ければ `thumbnail` が `http(s)` の実画像URLのときそれを使う。
 * どちらも無ければ null（記事は既定サムネイル画像にフォールバックする）。
 */
export function extractRedditImageUrl(post: RedditPostData): string | null {
  const previewUrl = post.preview?.images?.[0]?.source?.url;
  if (previewUrl && previewUrl.trim().length > 0) {
    return previewUrl.replace(/&amp;/g, "&");
  }
  const thumbnail = post.thumbnail;
  if (thumbnail && /^https?:\/\//.test(thumbnail) && !NON_IMAGE_THUMBNAIL_VALUES.has(thumbnail.toLowerCase())) {
    return thumbnail;
  }
  return null;
}

/**
 * 投稿のメディア情報（画像URL・リンク先URL）をまとめる（リファクタリングS2 F-S2-1）。
 * どちらも無ければ undefined（Post.media は未設定のままにする）。
 */
export function buildRedditMedia(
  imageUrl: string | null,
  url: string | undefined,
): { imageUrl: string | null; url?: string } | undefined {
  if (!imageUrl && !url) return undefined;
  return { imageUrl, url };
}

/** 投稿＋選抜済みコメントから RawCollectionItem を組み立てる純関数。 */
export function buildRedditItem(post: RedditPostData, comments: RedditCommentData[]): RawCollectionItem {
  const imageUrl = extractRedditImageUrl(post);
  return {
    sourceUrl: buildPostUrl(post),
    title: post.title,
    content: buildRedditThreadDump(post, comments),
    fetchedAt: new Date(post.created_utc * 1000),
    imageUrl,
    // リファクタリングS2（F-S2-1）: Post永続化用メタ。
    externalId: post.id,
    score: post.score ?? 0,
    commentCount: post.num_comments ?? 0,
    // 成長G1（F-G1-3）: upvote_ratioが取得できない場合はundefinedのまま（論争判定はscore/commentsのみで行う）。
    upvoteRatio: post.upvote_ratio,
    author: post.author ?? null,
    flair: post.link_flair_text ?? null,
    media: buildRedditMedia(imageUrl, post.url),
  };
}

export type RedditAdapterOptions = {
  /** テスト・注入用。既定は env `REDDIT_USER_AGENT`。 */
  userAgent?: string;
  /** 取得対象サブレディット。既定は config の allowedSubreddits。 */
  subreddits?: string[];
  /** LoL関連判定キーワード。既定は config の reddit relevance keywords。 */
  keywords?: string[];
  /** 現在時刻の注入点（テスト用）。既定は実時刻。 */
  now?: () => Date;
  /** 取得窓の下限（何時間前まで。成長G8で日粒度から変更）。既定は env `REDDIT_MIN_AGE_HOURS`。 */
  minAgeHours?: number;
  /** 取得窓の上限（何時間前から遡るか）。既定は env `REDDIT_MAX_AGE_HOURS`。 */
  maxAgeHours?: number;
  minScore?: number;
  maxThreads?: number;
  maxComments?: number;
  /** 監視ウィンドウ（成長G8 F-G8-2）。既定は env `REDDIT_MONITOR_MAX_AGE_HOURS`。 */
  monitorMaxAgeHours?: number;
  /** 監視ウィンドウ内投稿のnum_comments下限（成長G8 F-G8-2）。既定は env `REDDIT_MONITOR_MIN_COMMENTS`。 */
  monitorMinComments?: number;
  /** 監視ウィンドウ内から選抜する件数上限（成長G8 F-G8-2）。既定は env `REDDIT_MAX_MONITOR_CANDIDATES`。 */
  maxMonitorCandidates?: number;
  /** 議論コメント枠数（成長G8 F-G8-3）。既定は env `REDDIT_DISCUSSION_COMMENT_SLOTS`。 */
  discussionCommentSlots?: number;
  /** 連続fetch間のディレイ(ms)。既定は env `REDDIT_REQUEST_DELAY_MS`（既定1000）。 */
  delayMs?: number;
  /** ディレイの実処理の注入点（テスト用）。既定は実 setTimeout ベースの sleep。 */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Reddit（Arctic Shift REST・キー不要）から「最近の人気スレOP＋上位コメント」を収集する live アダプタ
 * （拡張E46）。取得失敗（HTTPエラー・不正JSON・ネット断）はすべて例外を投げず空配列にする。
 * 投稿一覧→各スレのコメント取得の順に直列で行い、連続fetch間にディレイを挟む（同時多重接続を避ける。
 * 5chアダプタと同方針）。
 */
export class RedditAdapter implements SourceAdapter {
  readonly sourceType = "reddit" as const;
  private readonly userAgent: string;
  private readonly subreddits: string[];
  private readonly keywords: string[];
  private readonly now: () => Date;
  private readonly minAgeHours: number;
  private readonly maxAgeHours: number;
  private readonly minScore: number;
  private readonly maxThreads: number;
  private readonly maxComments: number;
  private readonly monitorMaxAgeHours: number;
  private readonly monitorMinComments: number;
  private readonly maxMonitorCandidates: number;
  private readonly discussionCommentSlots: number;
  private readonly delayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** 実行全体で最初のfetchかどうか（最初のfetch前はディレイ不要のため）。 */
  private firstFetchDone = false;

  constructor(options: RedditAdapterOptions = {}) {
    const defaults = getDefaultSourceConfigs().reddit;
    this.userAgent = options.userAgent ?? process.env.REDDIT_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.subreddits = options.subreddits ?? defaults.relevance.allowedSubreddits ?? [];
    this.keywords = options.keywords ?? defaults.relevance.keywords;
    this.now = options.now ?? (() => new Date());
    this.minAgeHours = options.minAgeHours ?? envIntLocal("REDDIT_MIN_AGE_HOURS", DEFAULT_MIN_AGE_HOURS);
    this.maxAgeHours = options.maxAgeHours ?? envIntLocal("REDDIT_MAX_AGE_HOURS", DEFAULT_MAX_AGE_HOURS);
    this.minScore = options.minScore ?? envIntLocal("REDDIT_MIN_SCORE", DEFAULT_MIN_SCORE);
    this.maxThreads = options.maxThreads ?? envIntLocal("REDDIT_MAX_THREADS", DEFAULT_MAX_THREADS);
    this.maxComments = options.maxComments ?? envIntLocal("REDDIT_MAX_COMMENTS", DEFAULT_MAX_COMMENTS);
    this.monitorMaxAgeHours =
      options.monitorMaxAgeHours ?? envIntLocal("REDDIT_MONITOR_MAX_AGE_HOURS", DEFAULT_MONITOR_MAX_AGE_HOURS);
    this.monitorMinComments =
      options.monitorMinComments ?? envIntLocal("REDDIT_MONITOR_MIN_COMMENTS", DEFAULT_MONITOR_MIN_COMMENTS);
    this.maxMonitorCandidates =
      options.maxMonitorCandidates ?? envIntLocal("REDDIT_MAX_MONITOR_CANDIDATES", DEFAULT_MAX_MONITOR_CANDIDATES);
    this.discussionCommentSlots =
      options.discussionCommentSlots ?? envIntLocal("REDDIT_DISCUSSION_COMMENT_SLOTS", DEFAULT_DISCUSSION_COMMENT_SLOTS);
    this.delayMs = options.delayMs ?? envIntLocal("REDDIT_REQUEST_DELAY_MS", DEFAULT_REQUEST_DELAY_MS);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 取得(fetch)の直前に呼ぶ。実行全体で最初の1回だけディレイを省く（他はdelayMs待ってから進める）。 */
  private async waitBeforeFetch(): Promise<void> {
    if (this.firstFetchDone) {
      await this.sleep(this.delayMs);
    } else {
      this.firstFetchDone = true;
    }
  }

  private async fetchPosts(subreddit: string): Promise<RedditPostData[]> {
    const { afterIso, beforeIso } = computeFetchWindow(this.now(), this.minAgeHours, this.maxAgeHours);
    await this.waitBeforeFetch();
    const json = await fetchJsonSafe<ArcticShiftPostsResponse>(
      buildPostsSearchUrl(subreddit, afterIso, beforeIso),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `r/${subreddit} posts` },
    );
    return json?.data ?? [];
  }

  private async fetchComments(post: RedditPostData): Promise<RedditCommentData[]> {
    await this.waitBeforeFetch();
    const json = await fetchJsonSafe<ArcticShiftCommentsResponse>(
      buildCommentsSearchUrl(post.id),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `comments id=${post.id}` },
    );
    return json?.data ?? [];
  }

  private async fetchSubredditItems(subreddit: string): Promise<RawCollectionItem[]> {
    const posts = await this.fetchPosts(subreddit);
    // 成長G8（F-G8-2）: 「収集の足切り」と「記事化の判定」を分離。古い投稿はscore足切り、
    // 新しい投稿（監視ウィンドウ内）はscore足切りをせず監視対象に入れる（selectPostsForCollection）。
    const selected = selectPostsForCollection(posts, {
      keywords: this.keywords,
      minScore: this.minScore,
      maxThreads: this.maxThreads,
      now: this.now(),
      monitorMaxAgeHours: this.monitorMaxAgeHours,
      monitorMinComments: this.monitorMinComments,
      maxMonitorCandidates: this.maxMonitorCandidates,
    });

    const items: RawCollectionItem[] = [];
    for (const post of selected) {
      const comments = await this.fetchComments(post);
      const topComments = selectTopComments(comments, this.maxComments, {
        discussionSlots: this.discussionCommentSlots,
      });
      items.push(buildRedditItem(post, topComments));
    }
    console.log(
      `[reddit] sub=${subreddit} fetched=${posts.length} selected=${selected.length} collected=${items.length}`,
    );
    return items;
  }

  async fetchItems(): Promise<RawCollectionItem[]> {
    if (this.subreddits.length === 0) {
      console.log("[reddit] 対象サブレディットが無いため収集をスキップします");
      return [];
    }
    // 5chアダプタ同様、サブレディットは完全並列ではなく直列で取得する（同時多重接続を避ける）。
    const perSubredditResults: RawCollectionItem[][] = [];
    for (const subreddit of this.subreddits) {
      perSubredditResults.push(await this.fetchSubredditItems(subreddit));
    }
    return dedupeBySourceUrl(perSubredditResults.flat());
  }

  /**
   * リファクタリングS4（F-S4-1）: 指定した投稿の現在のスコア/コメント数を取得する
   * （`GET /api/posts/ids?ids=<externalId>` の確認済みエンドポイント）。取得失敗/空は null。
   */
  async fetchMetrics(externalId: string): Promise<{ score: number; commentCount: number } | null> {
    const json = await fetchJsonSafe<ArcticShiftPostsResponse>(
      buildPostsByIdsUrl(externalId),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `metrics id=${externalId}` },
    );
    const postData = json?.data?.[0];
    if (!postData) return null;
    return { score: postData.score ?? 0, commentCount: postData.num_comments ?? 0 };
  }

  /**
   * リファクタリングS6（F-S6-2）: 投稿の現在の内容（OP＋上位コメント）を再取得し、
   * `buildRedditThreadDump`/`selectTopComments`（既存のコメント取得・ダンプ構築ロジック）を
   * 再利用してスレッドダンプを作り直す。投稿が見つからない/取得失敗時は null。
   */
  async fetchContent(externalId: string): Promise<{ title: string; content: string; imageUrl?: string | null } | null> {
    await this.waitBeforeFetch();
    const json = await fetchJsonSafe<ArcticShiftPostsResponse>(
      buildPostsByIdsUrl(externalId),
      { headers: { "User-Agent": this.userAgent } },
      { logLabel: "reddit", context: `content id=${externalId}` },
    );
    const postData = json?.data?.[0];
    if (!postData) return null;

    const comments = await this.fetchComments(postData);
    const topComments = selectTopComments(comments, this.maxComments, {
      discussionSlots: this.discussionCommentSlots,
    });
    return {
      title: postData.title,
      content: buildRedditThreadDump(postData, topComments),
      imageUrl: extractRedditImageUrl(postData),
    };
  }
}
