/**
 * 記事本文の構成組み立て（F7）。LLMClient経由でリライト文を取得しつつ、
 * ソース種別による構成分岐を適用する。
 * - 掲示板/Reddit（5ch/reddit）: AI要約段落を持たず、「反応まとめ」見出し＋収集したスレッドの
 *   レス群を番号付きレスとして逐語のまま並べるだけの「レス羅列中心」構成（2026-07-25 ユーザー決定の
 *   記事フォーマット改修。同日の追加改修でAI導入/まとめ段落を除去しさらにシンプル化）。
 *   レス選別は既定でAI不使用（`REACTION_SELECT_MODE`、リファクタリングS3 F-S3-3）。
 * - Riot公式（riot）: 「事実の速報＋要点整理」構成（従来どおり、引用ブロックは主従関係を保つ）。
 */
import {
  PATCH_PREVIEW_BADGE_TEXT,
  isPatchPreviewArticleBody,
  type ArticleBodyBlock,
  type ArticleBodyEmbedBlock,
  type ArticleBodyEmphasisColor,
  type ArticleBodyPatchChangeBlock,
  type ArticleBodyReactionBlock,
} from "@/lib/article-body";
import type { SourceType } from "@/lib/collection/types";
import type { LLMClient, GenerationTask } from "@/lib/generation/llm-client";
import { splitIntoSentences, excerptForQuote } from "@/lib/generation/text-utils";
import { parseThreadReses, extractAnchors, computeLineEmphasis, type ThreadRes } from "@/lib/generation/thread-format";
import { isAllowedEmbedUrl, embedProviderForUrl, isValidTweetStatusUrl } from "@/lib/embed";
import { findNgWord } from "@/lib/moderation/ng-words";
import { PATCH_NOTES_MIN_LENGTH } from "@/lib/collection/adapters/riot-datadragon";
import { CHAMPIONS } from "@/lib/generation/title";
import { isSafeImageUrl } from "@/lib/image-url";
import { buildChampionSplashUrl, championNameToId } from "@/lib/generation/champion-splash";
import { buildTranslationGlossaryText } from "@/lib/generation/translation-glossary";
import {
  parsePatchNotesHtml,
  inferDdragonVersionFromTargets,
  buildChampionSquareIconUrl,
  buildItemIconUrl,
  type PatchChangeTarget,
} from "@/lib/generation/patch-notes-parser";

// パッチ記事刷新S5 F-S5-3: 本文の速報バッジ検出は`article-body.ts`が単一の真実源（構造判定は
// ArticleBodyBlock[]専用のヘルパの置き場所に揃える）。既存の呼び出し元（confirm-patch-preview等）が
// `@/lib/generation/compose`からもimportできるよう、そのままここで再エクスポートする。
export { isPatchPreviewArticleBody };

export type GenerationCandidateInput = {
  sourceType: SourceType;
  title: string;
  content: string;
  /** riot由来の公式パッチノートリンクにのみ使う出典URL（それ以外のソース種別では未使用）。 */
  sourceUrl?: string;
  /** riot由来（拡張E42）: 公式パッチノートのメイン画像URL（og:image）。安全なhttps URLのみ本文冒頭の画像ブロックに使う。 */
  imageUrl?: string | null;
  /** 成長G7（F-G7-4）: x由来の投稿者（Post.author）。引用フォールバック時の出典表記に使う。 */
  author?: string | null;
  /**
   * パッチ記事刷新S2（F-S2-2）: riot由来の平テキスト化前の生HTML（`riot-datadragon.ts`保持）。
   * `parsePatchNotesHtml`でDOM抽出できれば誤帰属ゼロの詳細本文を組み立てる。未取得/他ソースは未設定。
   */
  html?: string | null;
  /**
   * パッチ記事刷新S5（F-S5-2, opt-in）: 未適用パッチ（本番未反映の次パッチ）の先行速報アイテムか。
   * `PATCH_PREVIEW_MODE=on` のときのみpost-pipeline.tsがPost.mediaのpatchPreviewフラグから渡す。
   * trueのとき本文先頭に速報バッジ段落を追加する。未設定/false（既定）では従来と完全同一。
   */
  isPatchPreview?: boolean;
};

/** レス投稿者の匿名化ハンドル（実名・個人特定情報は出さない）。ソース種別ごとに固定。 */
const REACTION_HANDLE: Record<"5ch" | "reddit", string> = {
  "5ch": "国内プレイヤーさん",
  reddit: "海外プレイヤーさん",
};

/** 1記事あたりの反応レス抜粋の上限件数（拡張E25 F-E25-1、超過分は先頭優先で切る）。 */
const MAX_EXCERPT_RESES = 12;

/**
 * 反応レス選別の方式（リファクタリング S3 F-S3-3）。要件「AIによる話題性判定・分類・スコアリングは禁止」
 * に合わせ、既定（未設定 or `"rules"`）は数値ルール（`selectMajorConversationCluster`によるアンカー会話
 * クラスタ選定＋決定論強調）にし、AI（`selectReactionReses`）を呼ばない。`"llm"`を指定した場合のみ
 * 従来どおりAI選別を使う（質の比較用に旧コードは削除せず残す）。
 */
function reactionSelectMode(): "rules" | "llm" {
  return process.env.REACTION_SELECT_MODE === "llm" ? "llm" : "rules";
}

/**
 * LLMによるレス抜粋・強調選定の正規化結果（拡張E28で行抽出、拡張E32で強調色に対応）。
 * keepLines: 採用したレスindex → 残す行indexの配列（元順・昇順）。null は「そのレス全行を採用」。
 * emphasize: 強調するレスindex → 色（"red"|"blue"|"purple"|"orange"、拡張E36で緑を廃止し紫を追加）
 * または null（色無しの従来強調）。
 */
type ReactionSelection = {
  keepLines: Map<number, number[] | null>;
  emphasize: Map<number, ArticleBodyEmphasisColor | null>;
};

/**
 * LLMが返した `{keep, emphasize}` 生JSON値を防御的に検証・正規化する純関数（拡張E25 F-E25-1）。
 * 範囲外・非整数・重複を除去し、上限件数(MAX_EXCERPT_RESES)超過分は先頭優先で切る。
 * emphasize は必ず keep の部分集合に丸める。keep が1件も残らない場合は null（＝呼び出し側で
 * 「全レス・強調なし」にフォールバックさせる）を返す。
 */
/**
 * LLMの生出力から最初のJSONオブジェクト（`{ ... }`）部分だけを取り出す（拡張E26）。
 * ```json ... ``` のコードフェンスや前後の説明文が付いていてもparseできるようにする。
 * `{`が無い/`}`が先行するなど不正な場合は null。
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

/**
 * keep の1要素（number または {index, lines?}）から、レスindexと生の lines 指定を取り出す。
 * どちらの形にも一致しなければ null（呼び出し側で無視する）。
 */
function parseKeepEntry(entry: unknown): { index: unknown; rawLines: unknown } | null {
  if (typeof entry === "number") return { index: entry, rawLines: undefined };
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    return { index: e.index, rawLines: e.lines };
  }
  return null;
}

/** 強調色として許可する値の集合（拡張E32、おばにゅー流。拡張E36で緑を廃止し紫を追加）。 */
const ALLOWED_EMPHASIS_COLORS = new Set<ArticleBodyEmphasisColor>(["red", "blue", "purple", "orange"]);

/**
 * emphasize の1要素（number または {index, color?}）から、レスindexと生の color 指定を取り出す。
 * どちらの形にも一致しなければ null（呼び出し側で無視する）。number（従来形式）は色無しとして扱う。
 */
function parseEmphasizeEntry(entry: unknown): { index: unknown; rawColor: unknown } | null {
  if (typeof entry === "number") return { index: entry, rawColor: undefined };
  if (typeof entry === "object" && entry !== null) {
    const e = entry as Record<string, unknown>;
    return { index: e.index, rawColor: e.color };
  }
  return null;
}

function normalizeReactionSelection(raw: unknown, reses: ThreadRes[]): ReactionSelection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.keep)) return null;

  const resCount = reses.length;
  const isValidIndex = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= 0 && n < resCount;

  const keepLines = new Map<number, number[] | null>();
  for (const rawEntry of obj.keep) {
    const parsed = parseKeepEntry(rawEntry);
    if (!parsed || !isValidIndex(parsed.index) || keepLines.has(parsed.index)) continue;
    if (keepLines.size >= MAX_EXCERPT_RESES) continue;

    const lineCount = reses[parsed.index].lines.length;
    const isValidLine = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n < lineCount;

    let normalizedLines: number[] | null = null;
    if (Array.isArray(parsed.rawLines)) {
      const dedupedLines: number[] = [];
      const seenLines = new Set<number>();
      for (const ln of parsed.rawLines) {
        if (!isValidLine(ln) || seenLines.has(ln)) continue;
        seenLines.add(ln);
        dedupedLines.push(ln);
      }
      dedupedLines.sort((a, b) => a - b); // 元の行順を維持
      // 空/全て不正な行指定は「そのレスは全行採用」に丸める。
      normalizedLines = dedupedLines.length > 0 ? dedupedLines : null;
    }
    keepLines.set(parsed.index, normalizedLines);
  }
  if (keepLines.size === 0) return null;

  const rawEmphasize = Array.isArray(obj.emphasize) ? obj.emphasize : [];
  const emphasize = new Map<number, ArticleBodyEmphasisColor | null>();
  for (const rawEntry of rawEmphasize) {
    const parsed = parseEmphasizeEntry(rawEntry);
    if (!parsed || !isValidIndex(parsed.index) || !keepLines.has(parsed.index)) continue;
    const color =
      typeof parsed.rawColor === "string" && ALLOWED_EMPHASIS_COLORS.has(parsed.rawColor as ArticleBodyEmphasisColor)
        ? (parsed.rawColor as ArticleBodyEmphasisColor)
        : null;
    emphasize.set(parsed.index, color);
  }

  return { keepLines, emphasize };
}

/**
 * LLMに「話題に関係する重要なレスの抜粋」と「そのうち特に強調すべきレス」を選ばせる（拡張E25 F-E25-1）。
 * レス本文は書き換えさせず、選定インデックスのみをJSONで返させる。APIエラー・JSON parse失敗・
 * 検証不通過など、うまく選定できない場合は例外を投げずに null を返す（呼び出し側が全レス・強調なしに
 * フォールバックする）。
 */
async function selectReactionReses(
  llmClient: LLMClient,
  title: string,
  reses: ThreadRes[],
): Promise<ReactionSelection | null> {
  if (reses.length === 0) return null;
  try {
    const task: GenerationTask = {
      kind: "reaction-select",
      title,
      reses: reses.map((r, index) => ({ index, number: r.number, lines: r.lines })),
    };
    const raw = await llmClient.generate([
      {
        role: "system",
        content:
          "あなたはLoLまとめサイトの編集者です。渡されたスレッドのレス一覧(title=記事の話題, " +
          "reses=各レスのindex/number/lines[行配列])から、記事としてまとめるレスを厳選してください。" +
          "5chスレは複数の話題に脱線しがちです。まずスレ全体で最も反応・議論が集まっている1つの" +
          "中心的な話題を見極め、それに沿ったレスだけを選んでください（話題を1つに絞ること）。" +
          "次のようなレスは中心話題に無関係なので必ず除外してください: 別の話題への脱線、" +
          "別チャンピオンや別のゲームシステムについての雑談、独立した別の質問(例:「〜のおすすめは？」" +
          "「〜って誰かいる？」)、スレのルール文・テンプレ(「!extend」「次スレは>>950」" +
          "「配信者やプロの話題禁止」等の定型・運営文)。" +
          "互いに>>Nで参照し合い会話としてつながっているレスは、中心話題の議論である可能性が高いため" +
          "優先して選んでください。無理に多く選ぶ必要はありません。少数でも話題が一貫している方を" +
          "優先してください。" +
          "レス本文・行は書き換えず、渡された中からindexを選ぶだけです。長いレスは、記事の話題に沿った行だけを" +
          "残すために対象レスの lines のうち残す行indexを指定できます（指定しなければそのレスの全行を採用）。" +
          '出力はJSONのみとし、{"keep": [index または {"index": N, "lines": [行index,...]}, ...], ' +
          '"emphasize": [index または {"index": N, "color": "red"|"blue"|"purple"|"orange"}, ...]} の形式に' +
          "してください（説明文・前置き・コードブロックは付けない）。" +
          "keepは厳選した重要レスのindex（全行採用ならindexの数値のまま、行を絞る場合はオブジェクト形式）、" +
          "emphasizeはkeepの中でも特に注目・重要なレスのindexです。おばにゅー流に色(red=最重要/否定的な反応、" +
          "blue=注目/肯定的な反応、purple=補足的な反応、orange=ネタ・ユーモラスな反応 等)を割り当ててよい" +
          "（色は任意、無くても構わない）。",
      },
      { role: "user", content: JSON.stringify(task) },
    ]);
    if (!raw || raw.trim().length === 0) return null;
    // Haiku等が ```json ... ``` のコードフェンスや前置きを付けることがあるため、
    // 最初の { から最後の } までを取り出してからparseする（拡張E26で頑健化）。
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    const parsed: unknown = JSON.parse(jsonStr);
    return normalizeReactionSelection(parsed, reses);
  } catch {
    return null;
  }
}

/**
 * レス翻訳（reaction-translate、拡張E47 F-E47-1）の system 指示。拡張E51 F-E51-2で「行ごとの直訳・
 * 行数厳密一致」から「レス（コメント）全体を文脈ごと自然な日本語にする」方針へ書き換えた。日本の
 * 『海外の反応』まとめサイトのように、日本人プレイヤーが書いたような自然な口語・スッと読める日本語に
 * 意訳してよい（逐語訳・翻訳調を避ける）。ただし事実・数値・固有名詞（チャンピオン名/選手名/チーム名/
 * スコア）の捏造・改変・重要情報の欠落は禁止する（ここで固定する）。成長G4 F-G4-3で末尾に
 * LoLスラング対訳表（`buildTranslationGlossaryText()`）とFew-shot例を追記し訳ゆれを抑えた。
 * 対訳表・例は完全に静的（日付・レス本文などの動的値を含まない）。プロンプトキャッシュ
 * （llm-client.tsの`cache_control`）はsystemがプレフィックス一致であることが前提のため、
 * ここに動的値を混ぜてはならない。
 */
export const REACTION_TRANSLATE_SYSTEM_PROMPT =
  "あなたは日本の『海外の反応』まとめサイトの翻訳担当です。渡す各レスはRedditのコメント全文（英語）です。" +
  "まるで日本人プレイヤーが自分の言葉で書いたような、スッと頭に入る自然な口語の日本語に翻訳してください。" +
  "逐語訳・翻訳調は避け、意味・ニュアンス・温度感が伝わるこなれた日本語にしてください" +
  "（人気の海外の反応まとめサイトのように読みやすく）。" +
  "英語のネットスラング・略語・LoL用語（チャンピオン名・レーン・BAN/ピック・ナーフ/バフ等）は、" +
  "日本のプレイヤーが普段使う自然な言い回しに置き換えてください。皮肉・ジョーク・愚痴・煽り合いなどの" +
  "口調やテンションも日本語の口語で再現してください。一文が長い・回りくどいコメントは、日本語として" +
  "自然な短さ・語順に整えて読みやすくしてよいです（意味は保つこと）。" +
  "ただし事実・数値・固有名詞（チャンピオン名/選手名/チーム名/スコア）は変えない・作らない・重要な情報を" +
  "落とさないでください。意訳・自然化はしてよいですが、情報の追加/削除や事実の改変はしないでください。" +
  "読みやすさ重視で自然な文にしてください。ただし元コメントに無い過度な脚色・煽り増しはしないでください。" +
  "誤字・脱字・変換ミス（同音異義語。例「視聴」を「試聴」、「体制」を「態勢」等）に注意し、正しい漢字表記にしてください。" +
  '出力はJSONのみとし、{"translations": [{"index": N, "text": "自然な日本語訳（1コメント分・複数文可）"}, ...]} ' +
  "の形式にしてください（説明文・前置き・コードブロックは付けない）。\n\n" +
  "以下のLoLスラングは日本のプレイヤーが使う自然な言い回しに寄せて訳すこと:\n" +
  buildTranslationGlossaryText() +
  "\n\n" +
  "翻訳例（口調・記法の参考。数値/固有名詞は例のダミー値であり実データではない）:\n" +
  '例1: 入力「>>3 nah this is just int, dude threw a 20k gold lead lmao」→ ' +
  '出力「>>3 いやこれただの利敵行為でしょ、2万ゴールドのリード投げ捨てたのマジで草」\n' +
  '例2: 入力「Riot pls, this champ is so broken it should be nerfed asap」→ ' +
  '出力「Riotさん頼むよ、このチャンピオンぶっ壊れすぎて早急にナーフすべきでしょ」';

/**
 * LLMが返した `{translations:[{index,text}]}` 生JSON値を検証・正規化する純関数（拡張E47 F-E47-1、
 * 拡張E51 F-E51-1でレス単位の全文翻訳に変更。行数一致の制約は撤廃）。index が入力に実在し、text が
 * 非空文字列であれば採用する。上位の `translateReactionLines` が最終的に null を返すかどうかを
 * 判断できるよう、ここでは（空も含め）Map を返す。
 */
function normalizeTranslations(
  raw: unknown,
  reses: { index: number; text: string }[],
): Map<number, string> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.translations)) return null;

  const validIndices = new Set(reses.map((r) => r.index));
  const result = new Map<number, string>();
  for (const rawEntry of obj.translations) {
    if (typeof rawEntry !== "object" || rawEntry === null) continue;
    const e = rawEntry as Record<string, unknown>;
    const index = e.index;
    if (typeof index !== "number" || !Number.isInteger(index) || !validIndices.has(index)) continue;
    if (result.has(index)) continue;
    if (typeof e.text !== "string" || e.text.trim().length === 0) continue;
    result.set(index, e.text);
  }
  return result;
}

/**
 * 1回のLLM呼び出しに渡すレスのバッチサイズ（既定件数、拡張E49 F-E49-1）。env
 * `REDDIT_TRANSLATE_BATCH_SIZE` で上書き可能（不正値・未設定は既定値）。
 */
const DEFAULT_REDDIT_TRANSLATE_BATCH_SIZE = 6;
function redditTranslateBatchSize(): number {
  const raw = Number(process.env.REDDIT_TRANSLATE_BATCH_SIZE);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_REDDIT_TRANSLATE_BATCH_SIZE;
}

/** 1バッチあたりの合計文字数の安全上限（拡張E49 F-E49-1、件数上限とは別に長文レスが混ざる場合の保険）。 */
const REDDIT_TRANSLATE_BATCH_CHAR_LIMIT = 3000;

/**
 * 表示対象レスを、件数（`redditTranslateBatchSize()`件ごと）と合計文字数（`REDDIT_TRANSLATE_BATCH_CHAR_LIMIT`）
 * の両方の安全上限でバッチに分割する（拡張E49 F-E49-1、拡張E51 F-E51-1でレス全文（text）単位に変更）。
 * 1記事分の全レスを1回のLLM呼び出しでまとめて送ると出力JSONが大きくなり途中で切れてparse不能になりやすい
 * ため、バッチ単位に分けることで「あるバッチの失敗が記事全体を英語にする」事態を避ける。1件だけで
 * バッチサイズ・文字数上限を超える場合でもそのレス単独のバッチにする（無限ループ・空バッチにはしない）。
 */
function splitIntoTranslateBatches(
  reses: { index: number; text: string }[],
): { index: number; text: string }[][] {
  const batchSize = redditTranslateBatchSize();
  const batches: { index: number; text: string }[][] = [];
  let current: { index: number; text: string }[] = [];
  let currentChars = 0;

  for (const res of reses) {
    const resChars = res.text.length;
    if (
      current.length > 0 &&
      (current.length >= batchSize || currentChars + resChars > REDDIT_TRANSLATE_BATCH_CHAR_LIMIT)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(res);
    currentChars += resChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * 1バッチ分のレス全文をLLMに翻訳させる（拡張E49 F-E49-1、旧 translateReactionLines の単発実装を
 * バッチ単位に切り出したもの。拡張E51 F-E51-1でレス全文単位に変更）。失敗（APIエラー・空応答・
 * parse不能・不正形式）時は例外を投げず null を返す（呼び出し側がそのバッチのレスだけ英語原文
 * フォールバックする）。
 */
async function translateReactionBatch(
  llmClient: LLMClient,
  batch: { index: number; text: string }[],
): Promise<Map<number, string> | null> {
  try {
    const task: GenerationTask = { kind: "reaction-translate", reses: batch };
    const raw = await llmClient.generate([
      { role: "system", content: REACTION_TRANSLATE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(task) },
    ]);
    if (!raw || raw.trim().length === 0) return null;
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    const parsed: unknown = JSON.parse(jsonStr);
    return normalizeTranslations(parsed, batch);
  } catch {
    return null;
  }
}

/**
 * reddit反応記事の表示対象レスをLLMで日本語訳する（拡張E47 F-E47-1、拡張E49 F-E49-1でバッチ分割、
 * 拡張E51 F-E51-1でレス（コメント）全体の全文翻訳に変更＝行単位の直訳をやめ文脈を保つ）。全レスを
 * 1回でまとめて送らず、`splitIntoTranslateBatches` で分割したバッチごとに個別translateし、結果の
 * Mapをマージして返す。あるバッチが失敗（null）しても他バッチの訳はそのまま活かす（そのバッチの
 * レスだけ呼び出し側で英語原文フォールバックになる＝記事まるごと英語にしない）。全レスが空配列の
 * 場合のみ null を返す。
 */
async function translateReactionLines(
  llmClient: LLMClient,
  reses: { index: number; text: string }[],
): Promise<Map<number, string> | null> {
  if (reses.length === 0) return null;
  const batches = splitIntoTranslateBatches(reses);
  const merged = new Map<number, string>();
  for (const batch of batches) {
    const result = await translateReactionBatch(llmClient, batch);
    if (!result) continue; // このバッチのレスだけ訳が欠け、呼び出し側が英語フォールバックする
    for (const [index, text] of result) merged.set(index, text);
  }
  return merged;
}

/**
 * LLMの話題関連レス選定（selectReactionReses）が null を返したときのフォールバックとして使う純関数
 * （拡張E43 F-E43-2）。スレは複数の話題に脱線しがちなため、収集した全レスをそのまま出すと中心話題と
 * 無関係な独立レス（別質問・別話題の脱線）が混入する。代わりに `>>N` アンカーで双方向連結した
 * 「会話クラスタ（連結成分）」を求め、最も会話が集まっている最大クラスタのレスindexだけを返す。
 * - 各レスの `>>N`（reses に実在する番号のみ、自己参照は無視）を双方向の辺とみなし連結成分を作る
 *   （union-find）。
 * - 最大サイズの連結成分を採用。同サイズは「クラスタ内の被参照延べ回数が多い→クラスタ内最小レス番号が
 *   小さい」の順で決定論的に選ぶ。
 * - スレ内に有効な `>>N` アンカーが1つも無い（＝全レスが連結成分サイズ1）場合のみ、最後の保険として
 *   全レスを採用する。
 * - 採用レスは元スレ順（レス番号ではなく元の配列index昇順、＝reses自体が元スレ順）で並べ、
 *   `MAX_EXCERPT_RESES` を超える分は先頭優先で切る。
 */
export function selectMajorConversationCluster(reses: ThreadRes[]): number[] {
  const n = reses.length;
  if (n === 0) return [];
  const numberToIndex = new Map(reses.map((r, i) => [r.number, i]));

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // 各レスindexが、他のレスから >>N で参照された延べ回数（同サイズクラスタのタイブレークに使う）。
  const referencedCount = new Array<number>(n).fill(0);
  let hasAnchoredPair = false;
  reses.forEach((res, i) => {
    for (const anchorNumber of extractAnchors(res.lines)) {
      const anchorIndex = numberToIndex.get(anchorNumber);
      if (anchorIndex === undefined || anchorIndex === i) continue;
      hasAnchoredPair = true;
      union(i, anchorIndex);
      referencedCount[anchorIndex]++;
    }
  });

  if (!hasAnchoredPair) {
    // アンカーが全く無いスレ（会話クラスタが作れない）は、最後の保険として全レスを採用する。
    return reses.map((_, i) => i).slice(0, MAX_EXCERPT_RESES);
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }

  let best: number[] = [];
  let bestReferenced = -1;
  let bestMinNumber = Infinity;
  for (const members of clusters.values()) {
    const totalReferenced = members.reduce((sum, idx) => sum + referencedCount[idx], 0);
    const minNumber = Math.min(...members.map((idx) => reses[idx].number));
    const isBetter =
      members.length > best.length ||
      (members.length === best.length && totalReferenced > bestReferenced) ||
      (members.length === best.length && totalReferenced === bestReferenced && minNumber < bestMinNumber);
    if (isBetter) {
      best = members;
      bestReferenced = totalReferenced;
      bestMinNumber = minNumber;
    }
  }

  return best
    .slice()
    .sort((a, b) => a - b)
    .slice(0, MAX_EXCERPT_RESES);
}

/** 拡張E33 F-E33-1: 色付き強調の最低保証で使う色の割り当て順（red→blue→purple→orange、拡張E36で緑を廃止）。 */
const MIN_COLOR_FALLBACK_COLORS: ArticleBodyEmphasisColor[] = ["red", "blue", "purple", "orange"];

/** レス1件分の表示本文の総文字数（行テキストの合計）。長いレス優先の判定に使う。 */
function reactionBlockCharCount(block: ArticleBodyReactionBlock): number {
  return block.lines.reduce((sum, l) => sum + l.text.length, 0);
}

/**
 * 反応ブロックが2件以上あるのにLLM/mockがどのレスにも強調を付けなかった場合、決定論的に
 * 一部を色付き強調にする最低保証（拡張E33 F-E33-1）。1件でも既にemphasis/emphasisColorが
 * 付いている記事はLLMの編集判断を尊重しそのまま返す。本文・行・レス選定・逐語テキストは
 * 一切変更せず、表示上の強調フラグ・色のみを付加する。
 */
function applyMinColorFallback(blocks: ArticleBodyReactionBlock[]): ArticleBodyReactionBlock[] {
  if (blocks.length < 2) return blocks;
  if (blocks.some((b) => b.emphasis || b.emphasisColor)) return blocks;

  const minColored = Math.max(1, Math.round(blocks.length / 4));
  const ranked = blocks
    .map((b, index) => ({ index, charCount: reactionBlockCharCount(b) }))
    .sort((a, b) => b.charCount - a.charCount || a.index - b.index)
    .slice(0, minColored);

  const colorByIndex = new Map<number, ArticleBodyEmphasisColor>();
  ranked.forEach((r, i) => colorByIndex.set(r.index, MIN_COLOR_FALLBACK_COLORS[i % MIN_COLOR_FALLBACK_COLORS.length]));

  return blocks.map((b, index) => {
    const color = colorByIndex.get(index);
    return color ? { ...b, emphasis: true, emphasisColor: color } : b;
  });
}

/**
 * 行テキストのうち、NGワード（findNgWord）を含む文（splitIntoSentencesで分割した1文単位）だけを
 * 削除し、残りの文をそのまま結合して返す（拡張E36 F-E36-3、伏字(*)化からの置き換え）。
 * NGワードを含まない文は一切書き換えない（逐語維持）。全ての文がNGで削除された場合は空文字列を
 * 返す（呼び出し側でその行を落とす判断に使う）。
 */
function removeNgSentences(text: string): string {
  return splitIntoSentences(text)
    .filter((sentence) => findNgWord(sentence) === null)
    .join("");
}

/**
 * レス1件分の表示行（ArticleBodyReactionLine[]）を、抽出行（英語の逐語）と翻訳結果（reddit時のみ、
 * 自然な日本語の全文。無ければnull）から組み立てる（拡張E47 F-E47-1、拡張E51 F-E51-3でレス全体の
 * 自然な日本語全文からの組み立てに変更＝行数一致の制約は撤廃）。
 * - 訳がある → 訳文（1コメント分の自然な日本語）を改行で行に分割（空行は除去、改行が無ければ1行）
 *   して組む。text=日本語訳のみ（拡張E50で原文英語併記=originalの付与は廃止）。
 * - 訳が全く無い（5ch・reddit翻訳失敗） → 抽出行そのまま（originalなし、英語原文フォールバック）。
 * いずれの場合もNGワードを含む文はremoveNgSentencesで削除し、削除後に空になった行は落とす
 * （全行がNGで空になれば、そのレスは戻り値が空配列になり呼び出し側で不掲載になる）。
 * 強調(computeLineEmphasis)は表示テキスト（訳があれば日本語）に対して判定する。
 */
function buildReactionDisplayLines(
  extractedLines: string[],
  translatedText: string | null,
): ArticleBodyReactionBlock["lines"] {
  if (translatedText && translatedText.trim().length > 0) {
    const splitLines = translatedText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const jaLines = splitLines.length > 0 ? splitLines : [translatedText.trim()];
    const emphasis = computeLineEmphasis(jaLines);
    const lines: ArticleBodyReactionBlock["lines"] = [];
    jaLines.forEach((jaText, li) => {
      const cleanedText = removeNgSentences(jaText);
      if (cleanedText.length === 0) return;
      lines.push({
        text: cleanedText,
        ...(emphasis[li] ? { emphasis: emphasis[li] } : {}),
      });
    });
    return lines;
  }

  // 訳が全く無い（5ch・reddit翻訳失敗）: 抽出行そのまま（originalなし、英語原文フォールバック）。
  const emphasis = computeLineEmphasis(extractedLines);
  const lines: ArticleBodyReactionBlock["lines"] = [];
  extractedLines.forEach((rawText, li) => {
    const cleanedText = removeNgSentences(rawText);
    if (cleanedText.length === 0) return;
    lines.push({ text: cleanedText, ...(emphasis[li] ? { emphasis: emphasis[li] } : {}) });
  });
  return lines;
}

/**
 * スレッドの content（逐語）を、まとめ速報のレス（reaction）ブロック配列に組み立てる。
 * レス番号・本文行は逐語のまま保持し、重要行の強調・アンカーの妥当性(既出番号のみ)だけを付加する。
 * 拡張E25 F-E25-1: LLMに話題関連レスの抜粋・重要レスの強調選定を委ね、選定できた場合は
 * keepインデックスのレスだけを元スレ順で組み、emphasizeインデックスのレスにブロック単位の
 * 強調フラグを立てる。選定できない場合（mockモード・APIエラー・parse失敗・keep空等）は
 * 全レスではなく、`>>N`アンカーで連結した会話クラスタのうち最大のものだけを採用する
 * （selectMajorConversationCluster、拡張E43 F-E43-2。アンカーが全く無いスレのみ全レス・強調なしで
 * 組む。本体を止めない）。
 * 拡張E32: emphasizeに色(red/blue/purple/orange、拡張E36で緑を廃止し紫を追加)が指定されていれば
 * emphasisColor も付与する（任意・後方互換）。
 * 拡張E36 F-E36-3: 本文行にNGワードが含まれる場合、伏字化（拡張E27）ではなく該当する文（1文単位）
 * だけを removeNgSentences で削除する。削除後に空になった行は落とし、レスの全行が空になった
 * （＝NG文を除くと何も残らない＝意味が通らない）場合は、そのレス自体を反応ブロックに含めない
 * （moderateArticleContent の ng_word 保留を避けて公開する意図は維持しつつ、逐語＋伏字なしにする）。
 * 拡張E33: 反応ブロックが2件以上あるのにどのレスにも強調が付かない場合は、決定論フォールバック
 * （applyMinColorFallback）で最低限の色付き強調を補い、全黒字の記事が出ないようにする。
 * 拡張E41 F-E41-1: 選ばれた表示レスが実際に表示する行（keepLines指定があればその行、なければ全行）に
 * `>>N` アンカーを含み、参照先Nが reses に存在し未選択なら、文脈としてそのレスも表示に追加する
 * （全行・強調なし。追加した文脈レスがさらに参照する先は辿らない＝1階層のみ）。追加後は元スレ順
 * （index昇順）に整列してから組む。
 * 拡張E51 F-E51-1/F-E51-3: reddit翻訳はレス（コメント）全体の全文を渡し、自然な日本語の全文を
 * 改行区切りで行に分割して採用する（行数一致の制約は撤廃、buildReactionDisplayLines参照）。訳が
 * 全く無いレスのみ英語原文フォールバックにする。
 * リファクタリングS3 F-S3-3: `REACTION_SELECT_MODE`（既定 rules）が"llm"でない限り、AIによる
 * `selectReactionReses` を呼ばず、常に `selectMajorConversationCluster`（数値ルール＝アンカー会話
 * クラスタ）でレスを選ぶ（AI選別・スコアリングを行わない）。強調は決定論（`computeLineEmphasis`＋
 * `applyMinColorFallback`）で付与する。
 */
async function buildReactionBlocks(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
  llmClient: LLMClient,
): Promise<ArticleBodyReactionBlock[]> {
  const reses = parseThreadReses(candidate.content);
  const name = REACTION_HANDLE[sourceType];
  const knownNumbers = new Set(reses.map((r) => r.number));
  const numberToIndex = new Map(reses.map((r, i) => [r.number, i]));

  const selection =
    reactionSelectMode() === "llm" ? await selectReactionReses(llmClient, candidate.title, reses) : null;
  // LLM選定を使わない（既定rulesモード）、またはLLM選定が失敗した場合（null）、拡張E43以前は
  // 「全レス無制限」にフォールバックしており、話題バラバラの無関係レスが全部出てしまっていた。
  // 拡張E43 F-E43-2で、代わりに>>Nアンカーで連結した会話クラスタのうち最大のもの（＝そのスレで
  // 最も会話が集まっている中心的な議論）だけを採用するようにする（selectMajorConversationCluster）。
  const baseIndices = selection
    ? reses.map((_, i) => i).filter((i) => selection.keepLines.has(i))
    : selectMajorConversationCluster(reses);

  // 表示レスが実際に表示する行から>>Nアンカーを集め、参照先Nが存在し未選択なら文脈として追加する
  // （1階層のみ＝baseIndicesの行だけを見る。追加した文脈レス自体の参照先は辿らない）。
  const baseIndexSet = new Set(baseIndices);
  const contextIndices = new Set<number>();
  for (const i of baseIndices) {
    const res = reses[i];
    const lineIndices = selection?.keepLines.get(i) ?? null;
    const displayedLines = lineIndices ? lineIndices.map((li) => res.lines[li]) : res.lines;
    for (const anchorNumber of extractAnchors(displayedLines)) {
      const anchorIndex = numberToIndex.get(anchorNumber);
      if (anchorIndex === undefined || baseIndexSet.has(anchorIndex)) continue;
      contextIndices.add(anchorIndex);
    }
  }
  const selectedIndices = [...baseIndices, ...contextIndices].sort((a, b) => a - b);

  // 表示対象レスの実表示行（keepLines適用後、英語のまま）を先に確定しておく（翻訳バッチ・強調判定・
  // NG削除のいずれもこの行配列を起点にする）。
  const extractedLinesByIndex = new Map<number, string[]>(
    selectedIndices.map((i) => {
      const lineIndices = selection?.keepLines.get(i) ?? null;
      return [i, lineIndices ? lineIndices.map((li) => reses[i].lines[li]) : reses[i].lines];
    }),
  );

  // 拡張E47 F-E47-1/F-E47-2、拡張E49 F-E49-1、拡張E51 F-E51-1: reddit のときだけ、表示対象レスの
  // 全文（行を改行結合したtext）をバッチ分割して日本語訳する（1記事分をまとめて1回で送ると出力JSON
  // が途中で切れやすいため。行単位ではなくレス全体を渡すことで文脈を保った自然な訳にする）。
  // 5ch では呼ばない（追加LLM呼び出しゼロ・逐語不変）。あるバッチの翻訳が失敗した場合、そのバッチの
  // レスだけ英語原文フォールバックになる（他バッチの訳は活かす。本体を止めない）。
  let translations: Map<number, string> | null = null;
  if (sourceType === "reddit" && selectedIndices.length > 0) {
    const toTranslate = selectedIndices.map((i) => ({ index: i, text: extractedLinesByIndex.get(i)!.join("\n") }));
    translations = await translateReactionLines(llmClient, toTranslate);
  }

  const blocks = selectedIndices
    .map((i): ArticleBodyReactionBlock | null => {
      const res = reses[i];
      // 行indexの指定があれば元 res.lines からその行だけを逐語のまま抽出する（拡張E28 F-E28-2）。
      // 指定なし（null＝全行採用、または選定自体が無いフォールバック）はres.linesをそのまま使う。
      const extractedLines = extractedLinesByIndex.get(i)!;
      const translatedText = translations?.get(i) ?? null;
      const anchors = extractAnchors(extractedLines).filter((n) => n !== res.number && knownNumbers.has(n));
      const isEmphasized = selection ? selection.emphasize.has(i) : false;
      const emphasisColor = isEmphasized ? (selection!.emphasize.get(i) ?? null) : null;

      // 拡張E51 F-E51-3: 訳（自然な日本語の全文）があればその改行区切りを行として採用する
      // （行数一致は問わない）。訳が全く無いレスのみ抽出行そのまま（英語原文フォールバック）。
      // NG削除・強調は表示テキスト（訳があれば日本語）に適用する（buildReactionDisplayLines内）。
      const cleanedLines = buildReactionDisplayLines(extractedLines, translatedText);
      if (cleanedLines.length === 0) return null;

      return {
        type: "reaction",
        number: res.number,
        name,
        lines: cleanedLines,
        ...(anchors.length > 0 ? { anchors } : {}),
        ...(isEmphasized ? { emphasis: true } : {}),
        ...(emphasisColor ? { emphasisColor } : {}),
      };
    })
    .filter((b): b is ArticleBodyReactionBlock => b !== null);

  return applyMinColorFallback(blocks);
}

/** 1記事あたりの検出クリップembedの上限（過剰な埋め込みを防ぐ、拡張E22）。 */
const MAX_DETECTED_EMBEDS = 3;

/** 本文テキスト中のURLらしき部分を検出する簡易正規表現（空白・全角句読点・閉じ括弧類までを1URLとみなす）。 */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'）】」』、。！？]+/g;

/** 文末に紛れ込みがちな半角句読点を取り除く（例: "https://youtu.be/ID." → "https://youtu.be/ID"）。 */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,!?;:]+$/, "");
}

/**
 * 反応記事（5ch/reddit）の本文テキストから、埋め込み許可URL（YouTube/Twitchクリップ）を検出し
 * embedブロックを組み立てる（F-E22-1）。provider判定・許可URL検証は embedProviderForUrl +
 * isAllowedEmbedUrl を必ず経由する（新たにホスト判定は書かない）。twitter(X)は本スプリントの
 * 実iframe対象外のため検出しない。重複排除・最大 MAX_DETECTED_EMBEDS 件まで。0件なら空配列。
 */
function detectClipEmbedBlocks(content: string): ArticleBodyEmbedBlock[] {
  const found = content.match(URL_IN_TEXT_RE) ?? [];
  const seen = new Set<string>();
  const blocks: ArticleBodyEmbedBlock[] = [];
  for (const raw of found) {
    if (blocks.length >= MAX_DETECTED_EMBEDS) break;
    const url = stripTrailingPunctuation(raw);
    if (seen.has(url)) continue;
    const provider = embedProviderForUrl(url);
    if (provider !== "youtube" && provider !== "clip") continue;
    if (!isAllowedEmbedUrl(provider, url)) continue;
    seen.add(url);
    blocks.push({ type: "embed", provider, url });
  }
  return blocks;
}

/** 引用ブロックの出典ラベル（ArticleSourceのlabelとは別に、本文中の引用元表記に使う）。 */
const QUOTE_SOURCE_LABEL: Record<SourceType, string> = {
  "5ch": "5chの反応",
  reddit: "Redditの反応",
  riot: "Riot公式",
  // riot-newsは引用(quote)ブロックを使わない構成のため未使用だが、型充足のため用意する。
  "riot-news": "Riot公式",
  // 成長G7（F-G7-4）: xの引用フォールバック（tweet status URLが無効/取得不可時）の出典ラベル。
  x: "Xの反応",
};

async function askLLM(llmClient: LLMClient, task: GenerationTask): Promise<string> {
  const text = await llmClient.generate([
    {
      role: "system",
      content: "あなたはLoLまとめサイトのリライト担当です。出力は日本語の1〜2文のみにしてください。",
    },
    { role: "user", content: JSON.stringify(task) },
  ]);
  return text.trim();
}

/**
 * LLMに要約させる「公式パッチノートまとめ」の正規化結果（拡張E34 F-E34-2）。
 * buffed: 主な強化チャンピオン、nerfed: 主な弱体チャンピオン、other: アイテム・その他の変更。
 * 各要素は本文に実在する変更点の要約文字列（捏造禁止はsystemプロンプトで担保する）。
 */
type PatchSummary = { buffed: string[]; nerfed: string[]; other: string[] };

/**
 * パッチノート要約LLMへのsystem指示。捏造禁止・出力形式(JSON)をここで固定する。
 * 拡張E35 F-E35-2: 渡す本文がページ全体のダンプ（ナビ・日付・eスポーツ告知・関連記事・Wiki導線等の
 * ノイズを多く含む）であることを明示し、それらを無視してチャンピオン/アイテムの数値変更だけを
 * 拾わせることでノイズ断片の誤要約・破綻を防ぐ。
 */
const PATCH_SUMMARY_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトの編集者です。次に渡す本文は公式パッチノートページ全体のテキストダンプで、" +
  "ナビゲーションメニュー・見出しメタ情報・日付やタイムスタンプ・eスポーツ大会の告知・関連記事へのリンク・" +
  "Wikiへの導線など、パッチの変更内容とは無関係なノイズを多く含みます。それらのノイズは無視し、" +
  "チャンピオン名や能力・ステータスの数値変更（強化・弱体化・アイテム調整）だけを本文中から拾って" +
  "日本語で簡潔に要約してください。本文に記載の無い数値・調整・チャンピオン名を作ってはいけません" +
  "(捏造禁止)。可能な場合は「チャンピオン名: 変更前 ⇒ 変更後」のように簡潔にまとめてください。" +
  "出力はJSONのみとし、" +
  '{"buffed": ["強化されたチャンピオンの要約", ...], "nerfed": ["弱体化されたチャンピオンの要約", ...], ' +
  '"other": ["アイテムやその他の変更の要約", ...]} の形式にしてください。' +
  "変更内容が明確に読み取れないカテゴリは無理に埋めず空配列にしてください" +
  "（ノイズの断片を変更点として拾わないこと。捏造禁止）。" +
  "説明文・前置き・コードブロックは付けないでください。";

/** LLMが返した配列値を検証済みの文字列配列に正規化する（空文字・非文字列は除く）。 */
function normalizePatchSummaryItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
}

/** LLMの生出力（JSON、コードフェンス付きの可能性あり）をPatchSummaryに検証・正規化する。 */
function parsePatchSummary(raw: string): PatchSummary | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const summary: PatchSummary = {
      buffed: normalizePatchSummaryItems(parsed.buffed),
      nerfed: normalizePatchSummaryItems(parsed.nerfed),
      other: normalizePatchSummaryItems(parsed.other),
    };
    if (summary.buffed.length === 0 && summary.nerfed.length === 0 && summary.other.length === 0) {
      return null;
    }
    return summary;
  } catch {
    return null;
  }
}

/**
 * riot由来のcontentが実パッチノート本文（PATCH_NOTES_MIN_LENGTH以上）のとき、LLMに要約させて
 * 「主な強化/弱体チャンピオン」「アイテム・その他の変更」の見出し＋要約段落からなる本文ブロックを
 * 組み立てる（拡張E34 F-E34-2）。LLMが使えない（mock・APIエラー・空応答）・JSON解析失敗・
 * 全カテゴリ空（＝要約できなかった）場合は例外を投げず null を返し、呼び出し側が従来の
 * 汎用パッチ記事（composeFactBody）にフォールバックする（本体を止めない）。
 */
async function composePatchSummaryBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[] | null> {
  try {
    const raw = await llmClient.generate([
      { role: "system", content: PATCH_SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ title: candidate.title, content: candidate.content }) },
    ]);
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    const summary = parsePatchSummary(raw);
    if (!summary) return null;

    const blocks: ArticleBodyBlock[] = [];
    if (summary.buffed.length > 0) {
      blocks.push({ type: "heading", text: "主な強化チャンピオン" });
      for (const item of summary.buffed) blocks.push({ type: "paragraph", text: item });
    }
    if (summary.nerfed.length > 0) {
      blocks.push({ type: "heading", text: "主な弱体チャンピオン" });
      for (const item of summary.nerfed) blocks.push({ type: "paragraph", text: item });
    }
    if (summary.other.length > 0) {
      blocks.push({ type: "heading", text: "アイテム・その他の変更" });
      for (const item of summary.other) blocks.push({ type: "paragraph", text: item });
    }
    return blocks;
  } catch {
    return null;
  }
}

/**
 * candidate の title / sourceUrl から表示用のパッチ番号（例 "26.14"）らしき文字列を抽出する
 * （拡張E35 F-E35-3）。buildPatchItem のタイトルは「【パッチ】26.14 の主な変更点まとめ」のように
 * 常に "数字.数字" 形式の番号を含むためそれを優先し、見つからなければ出典URL（buildPatchNoteUrl形式:
 * .../league-of-legends-patch-26-14-notes）からも抽出を試みる。どちらからも取れない場合は null
 * （呼び出し側が汎用ラベルにフォールバックする）。
 */
function extractPatchNumberLabel(candidate: GenerationCandidateInput): string | null {
  const fromTitle = candidate.title.match(/\d+\.\d+/);
  if (fromTitle) return fromTitle[0];
  const fromUrl = candidate.sourceUrl?.match(/patch-(\d+)-(\d+)-notes/);
  if (fromUrl) return `${fromUrl[1]}.${fromUrl[2]}`;
  return null;
}

/** 出典URLがボタンリンクに使える安全なhttps URLか（javascript:等の危険スキームを弾く）。 */
function isHttpsUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/**
 * riot（パッチ）記事を「事実速報」として組み立てる（拡張E41 F-E41-2、既定モード）。
 * LLMを使わず（factモードはLLM非依存・呼び出し増なし）、次の構成にする（拡張E42 F-E42-4）:
 * 1. `candidate.imageUrl` が安全なhttps画像URLなら先頭に公式パッチノートのメイン画像ブロック
 *    （出典クレジット併記＝hotlink表示、ローカル保存はしない）。
 * 2. 見出し「パッチ<番号>が公開」。
 * 3. 一般的な事実段落（具体的な数値・チャンピオン名は書かない＝捏造禁止）。
 * 4. 出典URLが安全なhttpsなら大きく目立つ公式リンクボタン（linkButton）。
 * 謝罪文言（「自動要約では抽出できなかった」等）は入れない。
 */
function composePatchFactFlashBody(candidate: GenerationCandidateInput): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "新しいパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();
  const blocks: ArticleBodyBlock[] = [];

  if (isSafeImageUrl(candidate.imageUrl)) {
    blocks.push({
      type: "image",
      url: candidate.imageUrl,
      alt: `${label} 公式パッチノートのメイン画像`,
      credit: "画像: Riot Games 公式パッチノートより",
    });
  }

  blocks.push({ type: "heading", text: `${label}が公開` });
  blocks.push({
    type: "paragraph",
    text:
      `リーグ・オブ・レジェンドの${label}が公開されました。チャンピオンやアイテムのバランス調整が` +
      "行われています。詳しい変更内容は公式パッチノートをご確認ください。",
  });
  blocks.push({
    type: "paragraph",
    text:
      "パッチノートでは、チャンピオンやアイテムの数値調整のほか、必要に応じてバグ修正や新機能・" +
      "イベントの告知が行われることもあります。対戦に影響のある変更を見逃さないよう、プレイ前に" +
      "公式サイトの発表内容へ一度目を通しておくとよいでしょう。",
  });
  blocks.push({
    type: "paragraph",
    text:
      "パッチの適用によって環境（メタ）が変化することもあるため、ランク戦などの対戦に挑む前に、" +
      "今回のアップデート内容を把握しておくことをおすすめします。",
  });

  if (sourceUrl && isHttpsUrl(sourceUrl)) {
    blocks.push({ type: "linkButton", url: sourceUrl, label: `▶ ${label} 公式パッチノートを読む` });
  } else {
    blocks.push({
      type: "paragraph",
      text: "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    });
  }

  return blocks;
}

/**
 * composePatchSummaryBody が要約できなかった（LLM要約失敗）ときの、ノイズ断片・逐文リライトを
 * 含まないクリーンな簡易パッチ記事（拡張E35 F-E35-3）。パッチノート本文（ページ全体ダンプでノイズ込み）
 * を composeFactBody に渡すと "14 Notes" 等のページ内ノイズ断片や「情報が不足…」等のLLM破綻文が
 * 引用として並んでしまうため、composeFactBodyへは一切フォールバックせず、見出し＋定型段落＋出典URLの
 * みで構成する（本文に無い具体的な変更点は書かない＝捏造禁止）。
 */
function composeCleanPatchFallbackBody(candidate: GenerationCandidateInput): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "今回のパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();
  return [
    { type: "heading", text: `${label}の変更点` },
    {
      type: "paragraph",
      text:
        `${label}が公開されました。今回のアップデートでは、複数のチャンピオンやアイテムの` +
        "バランス調整が行われています。強化・弱体化された具体的なチャンピオン名や数値の変更内容は、" +
        "自動要約では正確に抽出できなかったため、詳細は下記の公式パッチノートで直接ご確認ください。",
    },
    {
      type: "paragraph",
      text:
        "パッチノートには対戦バランスに関わるチャンピオンの能力値やコストの調整に加え、必要に応じて" +
        "バグ修正や新機能・イベントの告知が含まれることもあります。プレイに影響する変更を見逃さないよう、" +
        "対戦前に公式サイトの発表内容へ一度目を通しておくことをおすすめします。",
    },
    {
      type: "paragraph",
      text: sourceUrl
        ? `出典: ${sourceUrl}`
        : "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    },
  ];
}

/**
 * 決定的（逐語）抽出したチャンピオン別の変更点（拡張E40 F-E40-2）。
 * `changes` は本文の部分文字列そのもの（新規に文字列を組み立てない＝捏造しない）。
 */
export type PatchChampionChanges = { champion: string; changes: string[] };

/**
 * 決定的（逐語）抽出した「チャンピオン以外」の変更点セクション（拡張E54 F-E54-1）。
 * アイテム/ルーン/アリーナ/システム/バグ修正等、チャンピオン節に属さない `⇒` 変更行を、
 * 直前のセクション見出しらしい行でグルーピングしたもの。`heading` は本文中の実在する行
 * （またはどの見出しにも紐づけられない場合の総称見出し）、`changes` は本文の部分文字列そのもの。
 */
export type PatchOtherSection = { heading: string; changes: string[] };

/** `extractPatchSectionsDeterministic` の戻り値（拡張E54 F-E54-1）。 */
export type PatchChangesSections = { champions: PatchChampionChanges[]; other: PatchOtherSection[] };

/**
 * バフ/ナーフ/調整の3分類（成長G3 F-G3-1）。数値が「低いほど強い」ステータス
 * （クールダウン/マナ/コスト等）を表す語を含む変更行は増減の解釈を反転する。
 */
const LOWER_IS_BETTER_TERMS = ["クールダウン", "CD", "再使用", "マナ", "コスト", "消費", "詠唱時間"];

/**
 * 文字列内の数値（スラッシュ区切りの複数値含む）の並びをすべて抽出する（純関数、成長G3 F-G3-1）。
 * 例: "確定ダメージ: 150/250/350" → ["150/250/350"]。マッチが複数ある場合は呼び出し側が
 * 前後どちらの並びを使うか（先頭/末尾）を選ぶ。
 */
const NUMBER_LIST_RE = /-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)*/g;
function extractNumberLists(s: string): number[][] {
  const matches = s.match(NUMBER_LIST_RE);
  if (!matches) return [];
  return matches.map((m) => m.split("/").map(Number));
}

/**
 * 逐語の変更行1件を「強化(buff)/弱体化(nerf)/調整(adjust)/判定不能(unknown)」に機械分類する
 * 純関数（成長G3 F-G3-1）。`⇒` の前後にある数値（末尾/先頭の数値の並び。単値・スラッシュ区切りの
 * 複数値の両方に対応）を比較する。個数が揃わない・数値が無い場合は `unknown`。同値は `adjust`。
 * クールダウン/マナ/コスト等（`LOWER_IS_BETTER_TERMS`）を含む行は「減る=強化・増える=弱体」に
 * 解釈を反転する。曖昧なケースはすべて `adjust`/`unknown` 側（＝断定しない）に倒す。
 * 逐語のテキスト自体は一切書き換えない（判定のみ）。
 */
export function classifyChange(change: string): "buff" | "nerf" | "adjust" | "unknown" {
  const arrowIndex = change.indexOf("⇒");
  if (arrowIndex === -1) return "unknown";
  const before = change.slice(0, arrowIndex);
  const after = change.slice(arrowIndex + 1);

  const beforeLists = extractNumberLists(before);
  const afterLists = extractNumberLists(after);
  if (beforeLists.length === 0 || afterLists.length === 0) return "unknown";
  const beforeNums = beforeLists[beforeLists.length - 1]; // 矢印直前（末尾）の数値並び
  const afterNums = afterLists[0]; // 矢印直後（先頭）の数値並び
  if (beforeNums.length !== afterNums.length || beforeNums.some(Number.isNaN) || afterNums.some(Number.isNaN)) {
    return "unknown";
  }

  const beforeSum = beforeNums.reduce((a, b) => a + b, 0);
  const afterSum = afterNums.reduce((a, b) => a + b, 0);
  if (beforeSum === afterSum) return "adjust";

  const increased = afterSum > beforeSum;
  const isLowerIsBetter = LOWER_IS_BETTER_TERMS.some((term) => change.includes(term));
  if (isLowerIsBetter) return increased ? "nerf" : "buff";
  return increased ? "buff" : "nerf";
}

/**
 * チャンピオン1体分の変更点群を集約して「主な強化/主な弱体化/その他の調整」を判定する
 * 純関数（成長G3 F-G3-1）。全変更がbuffのみ→buff、全変更がnerfのみ→nerf、buff/nerfが混在する、
 * または判定できるものが1つも無い（全てunknown/adjust）→adjust（安全側に倒す。断定的な
 * 「強化/弱体化」の誤表示を避ける）。
 */
export function classifyChampion(changes: string[]): "buff" | "nerf" | "adjust" {
  const classifications = changes.map(classifyChange);
  const hasBuff = classifications.includes("buff");
  const hasNerf = classifications.includes("nerf");
  if (hasBuff && hasNerf) return "adjust";
  if (hasBuff) return "buff";
  if (hasNerf) return "nerf";
  return "adjust";
}

/**
 * DOM抽出（`PatchChangeTarget`）向けのdirection算出（パッチ記事刷新S2 F-S2-3）。
 * 既存 `classifyChange`/`classifyChampion`（テキスト行"stat：before ⇒ after"を正規表現で
 * 数値並び抽出する方式、G3のテストはそのまま維持）とは別に、DOM抽出済みの構造化された
 * `{ stat, before, after }` を直接受け取り「代表数値」を比較する新ロジックを用意する。
 * 公式HTML表記（範囲"2秒～4秒"、括弧内の付随数値、スペース入りスラッシュ複数値）に頑健にするため。
 *
 * - 括弧内（`（...）`/`(...)`）の付随数値は比較対象から除外する（例: "150 / 250 / 350（+対象の
 *   減少体力の25 / 30 / 35%）"の括弧部分は無視する）。
 * - 範囲表記（"2秒～4秒"/"2秒~4秒"）は最大値を代表値にする。
 * - スラッシュ複数値（"150 / 250 / 350"、スペース有無問わず）は合計値を代表値にする
 *   （ランクごとの数値をまとめて捉える、既存classifyChangeと同じ思想）。
 * - 単一値はその値をそのまま使う。
 * - 代表数値を抽出できない、またはスラッシュ値の個数が前後で食い違う（比較の前提が崩れる）場合は
 *   nullを返し、呼び出し側が安全側（adjust/判定不能）に倒す。
 */
type PatchRepresentativeValue = { value: number; kind: "single" | "range" | "slash"; slashCount?: number };

function stripParentheticalNumbers(s: string): string {
  return s.replace(/[（(][^）)]*[）)]/g, "");
}

/**
 * 値テキストから代表数値を抽出する。範囲(`kind:"range"`)は最大値、スラッシュ複数値
 * (`kind:"slash"`)は合計値、単一値(`kind:"single"`)はその値そのものを代表値とする。
 * 単一値の候補が文中に2件以上見つかる場合（例: "魔力100ごとに10%" の "100" と "10"）は、
 * どちらが本来の対象値か機械的に判別できず誤判定の危険があるため、あえて抽出不能（null）にする
 * （安全側。brief方針「曖昧はadjustに安全に倒す」）。
 */
function extractPatchRepresentativeValue(raw: string): PatchRepresentativeValue | null {
  const cleaned = stripParentheticalNumbers(raw);

  // 範囲表記("2秒～4秒"/"2秒~4秒"/"200～300"): 全角/半角チルダのみを範囲区切りとみなす
  // （負数とのハイフン混同を避ける）。数値とチルダの間には「秒」「%」等の短い単位が挟まることがあるため、
  // 数字以外の短い文字列（最大6文字）を許容する（無関係な数値をまたいで誤マッチしないよう数字自体は除外）。
  const rangeMatch = cleaned.match(/(-?\d+(?:\.\d+)?)[^\d～~]{0,6}[～~][^\d]{0,6}(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return { value: Math.max(Number(rangeMatch[1]), Number(rangeMatch[2])), kind: "range" };
  }

  // スラッシュ複数値("150/250/350"、スペース有無問わず): 合計値を代表値にする。
  const slashMatch = cleaned.match(/-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)+/);
  if (slashMatch) {
    const nums = slashMatch[0].split("/").map((part) => Number(part.trim()));
    if (nums.every((n) => !Number.isNaN(n))) {
      return { value: nums.reduce((a, b) => a + b, 0), kind: "slash", slashCount: nums.length };
    }
  }

  // 単一値。文中に数値候補が複数ある場合はどれが対象値か機械的に判別できないため抽出不能にする。
  const singleMatches = cleaned.match(/-?\d+(?:\.\d+)?/g);
  if (singleMatches && singleMatches.length === 1) {
    return { value: Number(singleMatches[0]), kind: "single" };
  }

  return null;
}

/**
 * DOM抽出した1変更点（`{ stat, before, after }`）を「強化(buff)/弱体化(nerf)/調整(adjust)」に
 * 機械分類する純関数（パッチ記事刷新S2 F-S2-3）。代表数値を抽出できない・種別(単一/範囲/スラッシュ)が
 * 前後で食い違う・スラッシュ値の個数が前後で食い違う・同値の場合は判定不能として`adjust`
 * （断定しない・安全側）を返す。
 * `LOWER_IS_BETTER_TERMS`（クールダウン/マナ/コスト等）を含むstatは「減る=強化」に解釈を反転するが、
 * 「短縮量」「軽減量」のように"量"自体が増えることが強化を意味する語（statに"量"を含む場合）は
 * 反転しない（brief記載の安全側方針。曖昧な場合でも数値自体の増減で素直に判定する）。
 */
export function classifyPatchChange(change: { stat: string; before: string; after: string }): "buff" | "nerf" | "adjust" {
  const beforeVal = extractPatchRepresentativeValue(change.before);
  const afterVal = extractPatchRepresentativeValue(change.after);
  if (!beforeVal || !afterVal) return "adjust";
  if (beforeVal.kind !== afterVal.kind) return "adjust"; // 表記の種類が違う比較は前提が崩れるため安全側に倒す
  if (beforeVal.kind === "slash" && beforeVal.slashCount !== afterVal.slashCount) {
    return "adjust"; // 個数が食い違い比較の前提が崩れているため安全側に倒す
  }
  if (beforeVal.value === afterVal.value) return "adjust";

  const increased = afterVal.value > beforeVal.value;
  const isAmountTerm = change.stat.includes("量"); // "短縮量"「軽減量」等、量自体が増える=強化の語
  const isLowerIsBetter = !isAmountTerm && LOWER_IS_BETTER_TERMS.some((term) => change.stat.includes(term));
  if (isLowerIsBetter) return increased ? "nerf" : "buff";
  return increased ? "buff" : "nerf";
}

/**
 * DOM抽出した対象（`PatchChangeTarget`）1件分の全変更点を集約し、対象単位のdirectionを判定する
 * （パッチ記事刷新S2 F-S2-3、S6で記述式変更を考慮）。direction算出は数値変更（`⇒`ありでstat/before/after
 * を持つもの）からのみ行う。全groupの全changeを`classifyPatchChange`で分類し、全てbuff→buff、
 * 全てnerf→nerf、混在・数値変更が1つも無い（記述式のみ含め）・全て判定不能→adjust（安全側。
 * `classifyChampion`と同じ思想）。
 */
export function classifyPatchTargetDirection(target: PatchChangeTarget): "buff" | "nerf" | "adjust" {
  const numericChanges = target.groups
    .flatMap((g) => g.changes)
    .filter(
      (c): c is { stat: string; before: string; after: string } =>
        c.stat !== undefined && c.before !== undefined && c.after !== undefined,
    );
  if (numericChanges.length === 0) return "adjust";
  const classifications = numericChanges.map(classifyPatchChange);
  const hasBuff = classifications.includes("buff");
  const hasNerf = classifications.includes("nerf");
  if (hasBuff && hasNerf) return "adjust";
  if (hasBuff) return "buff";
  if (hasNerf) return "nerf";
  return "adjust";
}

/** チャンピオン節・変更行の有界化（読みやすさ・トークン節約）。 */
const MAX_PATCH_CHAMPIONS = 12;
const MAX_CHANGES_PER_CHAMPION = 5;

/** チャンピオン以外のセクション・変更行の有界化（拡張E54 F-E54-1）。 */
const MAX_OTHER_SECTIONS = 8;
const MAX_CHANGES_PER_OTHER_SECTION = 8;

/**
 * セクション見出しらしい行の最大文字数（best-effort。長い文（intro/クレジット等）を誤って
 * 見出し扱いしないための上限）。
 */
const OTHER_HEADING_MAX_LENGTH = 20;

/**
 * パッチノートの上位見出しに使われがちなキーワード（拡張E54 F-E54-1、best-effort。E54修正で
 * アドホック見出し推定を廃止し、明示的なキーワードを含む行のみを見出しとみなす方式に一本化）。
 * これらを含む短い行は、以降の `⇒` 変更行をグルーピングする新しいセクション見出しとみなす
 * （チャンピオン節の途中でも、これに当たる行が来たらチャンピオン節を終えて非チャンピオン
 * セクションへ切り替える）。スキル記号(Q/W/E/R/固有スキル/パッシブ)や「〜のダメージ/反映率/
 * 移動距離/生成量」等の項目ラベルはここに含めない（見出し化しない）。
 */
const SECTION_KEYWORD_HEADING_TERMS = [
  "アイテム",
  "ルーン",
  "アリーナ",
  "メイヘム",
  "システム",
  "バグ修正",
  "その他",
];

/** どの見出しキーワードにも該当しない変更点をまとめる総称見出し。 */
const GENERIC_OTHER_HEADING = "その他の変更点";

/** 行がセクション見出しキーワードを含む短い行か（大文字/表記ゆれの厳密一致は狙わないbest-effort）。 */
function isSectionKeywordHeadingLine(line: string): boolean {
  return line.length <= OTHER_HEADING_MAX_LENGTH && SECTION_KEYWORD_HEADING_TERMS.some((k) => line.includes(k));
}

/**
 * 指定した見出しの非チャンピオンセクションを取得し、無ければ新規作成する（拡張E54修正:
 * 同一見出し（例「バグ修正」が本文中に複数回現れる）はマージ/重複排除し、別々のセクションを
 * 作らない）。上限 `MAX_OTHER_SECTIONS` に達していて新規作成できない場合は null を返す。
 */
function getOrCreateOtherSection(otherSections: PatchOtherSection[], heading: string): PatchOtherSection | null {
  const existing = otherSections.find((s) => s.heading === heading);
  if (existing) return existing;
  if (otherSections.length >= MAX_OTHER_SECTIONS) return null;
  const created: PatchOtherSection = { heading, changes: [] };
  otherSections.push(created);
  return created;
}

/**
 * 変更後の値が次行に割れた場合に連結してよい最大行数（拡張E40b）。
 * 実データの `stripHtmlToText` 出力では「：2 ⇒」で行が終わり、変更後の値（例「2.5」）が
 * 次の1行に単独で来るケースが多い。稀に値がさらに割れる場合に備えて2行まで許容する。
 */
const MAX_VALUE_CONTINUATION_LINES = 2;

/** 行が「⇒」を含み、かつ矢印の直後（行末まで）が空白のみ＝変更後の値がその行に無いか判定する。 */
function arrowTrailingIsEmpty(line: string): boolean {
  const idx = line.lastIndexOf("⇒");
  if (idx === -1) return false;
  return line.slice(idx + 1).trim().length === 0;
}

/**
 * 「⇒」で終わった行の続き（変更後の値）とみなせる行か判定する。実データでは変更後の値は
 * 数値・スラッシュ区切りの複数値・小数点・%等の短い断片であることが多く、新しいチャンピオン名や
 * 項目ラベル（漢字・カタカナ主体の文）とは区別できる。行内に「⇒」を含む（＝別の新しい変更行）場合は
 * 続きとみなさない。
 */
const VALUE_CONTINUATION_RE = /^[0-9][0-9./%\-+\s]*$/;
function looksLikeValueContinuation(line: string): boolean {
  return line.length <= 20 && VALUE_CONTINUATION_RE.test(line);
}

/**
 * 「⇒」を含む変更行（と、値が次行以降に割れた場合の継続行）を、指定の変更点リストへ逐語で追加する
 * 共通処理（拡張E40b、拡張E54 F-E54-1でチャンピオン節・非チャンピオン節の双方から共用できるよう
 * 切り出した）。矢印の直後（行末まで）が空なら、後続の非空行のうち「値の続きらしい短い行」を最大
 * `MAX_VALUE_CONTINUATION_LINES` 行まで連結して復元する（次のチャンピオン名に達したらそこで止める）。
 * 連結後も値が空のまま（＝本当に値が無い異常系）の場合は、矢印だけの不完全な行を残さずその変更点
 * 自体を捨てる。`headingLabel`（チャンピオン名 or セクション見出し）と同一の `prevLine` は前置しない
 * （見出し自身の重複防止）。連結はすべて本文の行をそのまま繋ぐだけで、新しい数値・文言を作らない
 * （逐語維持・捏造禁止）。戻り値は次に処理すべき行indexと、次のprevLineとして使う値。
 */
function consumeChangeLine(
  lines: string[],
  index: number,
  headingLabel: string,
  prevLine: string,
  changesOut: string[],
): { nextIndex: number; nextPrevLine: string } {
  const line = lines[index];
  let combined = line;
  let consumed = 0;
  while (arrowTrailingIsEmpty(combined) && consumed < MAX_VALUE_CONTINUATION_LINES) {
    const nextLine = lines[index + 1 + consumed];
    if (nextLine === undefined) break;
    if ((CHAMPIONS as readonly string[]).includes(nextLine)) break; // 次のチャンピオン節に到達
    if (!looksLikeValueContinuation(nextLine)) break; // 次の項目ラベル等が来たらそこで止める
    combined = `${combined} ${nextLine}`;
    consumed++;
  }

  if (!arrowTrailingIsEmpty(combined)) {
    const hasUsableContext = prevLine.length > 0 && prevLine !== headingLabel && !prevLine.includes("⇒");
    changesOut.push(hasUsableContext ? `${prevLine} ${combined}` : combined);
  }

  return { nextIndex: index + 1 + consumed, nextPrevLine: lines[index + consumed] };
}

/**
 * 公式パッチノート本文（テキストダンプ）から、チャンピオン別の変更点と、チャンピオン以外
 * （アイテム/ルーン/アリーナ/システム/バグ修正等）の変更点の両方をLLMを使わず決定的・逐語で
 * 抽出する純関数（拡張E40 F-E40-2の一般化、拡張E54 F-E54-1。実データ検証(パッチ26.14)で
 * スキル/ステータスのラベルが見出しに誤昇格する不具合が見つかったため修正: アドホック見出し
 * ヒューリスティックは廃止し、非チャンピオンの見出しは `SECTION_KEYWORD_HEADING_TERMS` を
 * 含む行のみに限定した）。
 * - チャンピオン節: 従来どおり（単独行がチャンピオン名〈`title.ts` の `CHAMPIONS`〉と完全一致する行を
 *   節の開始とみなし、節内で「⇒」を含む行を変更点として集める。直前の非空行をスキル名/項目名として
 *   前置する。チャンピオン最大 `MAX_PATCH_CHAMPIONS` 体・1体あたり変更行最大 `MAX_CHANGES_PER_CHAMPION`
 *   行に有界化）。
 * - チャンピオン以外の節: チャンピオン節に属さない「⇒」変更行を、直前のセクション見出しらしい行
 *   （`SECTION_KEYWORD_HEADING_TERMS` を含む短い行のみ。チャンピオン節の途中でこれに当たる行が来たら
 *   チャンピオン節を終えて切り替える）でグルーピングする。それ以外の短い行（スキル記号Q/W/E/R/
 *   固有スキル/パッシブや「〜のダメージ/反映率/移動距離/生成量」等の項目ラベル、リスト外
 *   チャンピオンの見出しらしき行）は見出しにせず、単に文脈行（`prevLine`）として扱う。
 *   どのキーワード見出しにも属さない「⇒」変更（リスト外チャンピオン分・章見出し外の変更）は、
 *   個別に見出し化せず単一の総称見出し（`GENERIC_OTHER_HEADING`＝「その他の変更点」）にまとめる。
 *   **同一見出し（例「バグ修正」が本文中に複数回現れる場合）は `getOrCreateOtherSection` で
 *   マージ/重複排除**する（別々のセクションを作らない）。非チャンピオンのセクション最大
 *   `MAX_OTHER_SECTIONS` 個・1セクションあたり変更行最大 `MAX_CHANGES_PER_OTHER_SECTION` 行に
 *   有界化する。
 * どちらの節も、その回のパッチに存在するものだけを返す（無ければ空配列＝出さない）。連結・前置は
 * すべて本文の行をそのまま繋ぐだけで、新しい数値・文言を作らない（逐語維持・捏造禁止）。「⇒」を
 * 含まないノイズ行（intro/クレジット/TFT導線等）は変更点として拾わない。
 */
function extractPatchSectionsInternal(text: string): PatchChangesSections {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const champions: PatchChampionChanges[] = [];
  const otherSections: PatchOtherSection[] = [];
  let currentChampion: PatchChampionChanges | null = null;
  let currentOther: PatchOtherSection | null = null;
  let prevLine = "";

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if ((CHAMPIONS as readonly string[]).includes(line)) {
      currentChampion = champions.length < MAX_PATCH_CHAMPIONS ? { champion: line, changes: [] } : null;
      if (currentChampion) champions.push(currentChampion);
      currentOther = null; // チャンピオン節に入ったら非チャンピオンのグルーピング先はリセットする
      prevLine = line;
      i++;
      continue;
    }

    if (currentChampion) {
      if (line.includes("⇒")) {
        if (currentChampion.changes.length < MAX_CHANGES_PER_CHAMPION) {
          const { nextIndex, nextPrevLine } = consumeChangeLine(
            lines,
            i,
            currentChampion.champion,
            prevLine,
            currentChampion.changes,
          );
          prevLine = nextPrevLine;
          i = nextIndex;
          continue;
        }
        prevLine = line;
        i++;
        continue;
      }
      // セクション見出しキーワードに当たる行が来たら、チャンピオン節を終えて非チャンピオン節へ切り替える。
      if (isSectionKeywordHeadingLine(line)) {
        currentChampion = null;
        currentOther = getOrCreateOtherSection(otherSections, line);
        prevLine = line;
        i++;
        continue;
      }
      // それ以外の短い行（スキル記号・項目ラベル・リスト外チャンピオン名等）は見出し化せず、
      // 文脈行として次の「⇒」行に前置されるだけに留める（アドホック見出し推定は廃止）。
      prevLine = line;
      i++;
      continue;
    }

    // ここに来るのは「チャンピオン節の外」（currentChampionがnull）。
    if (line.includes("⇒")) {
      if (!currentOther) {
        currentOther = getOrCreateOtherSection(otherSections, GENERIC_OTHER_HEADING);
      }
      if (currentOther && currentOther.changes.length < MAX_CHANGES_PER_OTHER_SECTION) {
        const { nextIndex, nextPrevLine } = consumeChangeLine(
          lines,
          i,
          currentOther.heading,
          prevLine,
          currentOther.changes,
        );
        prevLine = nextPrevLine;
        i = nextIndex;
        continue;
      }
      prevLine = line;
      i++;
      continue;
    }

    if (isSectionKeywordHeadingLine(line)) {
      currentOther = getOrCreateOtherSection(otherSections, line);
      prevLine = line;
      i++;
      continue;
    }

    // キーワード見出しではない短い行（スキル記号・項目ラベル・リスト外チャンピオン名等）は見出しに
    // 昇格しない（アドホック見出し推定を廃止）。文脈行としてのみ保持する。
    prevLine = line;
    i++;
  }

  return {
    champions: champions.filter((c) => c.changes.length > 0),
    other: otherSections.filter((s) => s.changes.length > 0),
  };
}

/**
 * 公式パッチノート本文からチャンピオン別の変更点のみを決定的・逐語で抽出する（拡張E40 F-E40-2）。
 * 拡張E54 F-E54-1で内部実装は `extractPatchSectionsInternal`（チャンピオン以外の変更も併せて
 * 抽出する一般化版）の薄いラッパーになったが、戻り値・挙動は従来どおり（チャンピオン配列のみ、
 * 1件も無ければnull）。"summary"モード（`composeDeterministicPatchChangesBody`）はこちらを使い続ける。
 */
export function extractPatchChangesDeterministic(text: string): PatchChampionChanges[] | null {
  const { champions } = extractPatchSectionsInternal(text);
  return champions.length > 0 ? champions : null;
}

/**
 * 公式パッチノート本文からチャンピオン別の変更点と、チャンピオン以外（アイテム/システム等）の
 * 変更点セクションの両方を決定的・逐語で抽出する（拡張E54 F-E54-1、"detailed"モードが使う）。
 * どちらも1件も取れなければ null を返す（呼び出し側が事実速報にフォールバックする）。
 */
export function extractPatchSectionsDeterministic(text: string): PatchChangesSections | null {
  const sections = extractPatchSectionsInternal(text);
  if (sections.champions.length === 0 && sections.other.length === 0) return null;
  return sections;
}

/**
 * extractPatchChangesDeterministic の抽出結果から本文ブロックを組み立てる（拡張E40 F-E40-2）。
 * 見出し「主な変更点（公式パッチノートより）」＋チャンピオンごとの見出し＋変更点段落（逐語）。
 */
function composeDeterministicPatchChangesBody(
  changes: PatchChampionChanges[],
): ArticleBodyBlock[] {
  const blocks: ArticleBodyBlock[] = [{ type: "heading", text: "主な変更点（公式パッチノートより）" }];
  for (const c of changes) {
    blocks.push({ type: "heading", text: c.champion });
    for (const change of c.changes) {
      blocks.push({ type: "paragraph", text: change });
    }
  }
  return blocks;
}

/**
 * 冒頭1文サマリ（成長G3 F-G3-3）。3分類の集計から純テンプレで生成する（AI不使用）。
 * 0体/0件の項目は文から省く。チャンピオンの変更が1つも無いパッチ（システムのみ）では
 * 非チャンピオン件数のみのサマリにする。
 */
function buildPatchIntroSummary(
  label: string,
  buffCount: number,
  nerfCount: number,
  adjustCount: number,
  otherCount: number,
): string {
  const champParts: string[] = [];
  if (buffCount > 0) champParts.push(`${buffCount}体を強化`);
  if (nerfCount > 0) champParts.push(`${nerfCount}体を弱体化`);
  if (adjustCount > 0) champParts.push(`${adjustCount}体を調整`);

  if (champParts.length === 0) {
    return otherCount > 0
      ? `${label}では、アイテム/システムなど${otherCount}件の変更があります。`
      : `${label}の変更点をまとめます。`;
  }

  const champSentence = `${label}では、チャンピオン${champParts.join("・")}。`;
  return otherCount > 0 ? `${champSentence}ほかにアイテム/システムなど${otherCount}件の変更があります。` : champSentence;
}

/**
 * パッチ記事刷新S8 F-S8-2: DOM抽出経路（`composeDetailedPatchBody`）専用の冒頭1文サマリ。
 * champion/itemのみの集計にする（system/arena/bugfix/rune等の除外カテゴリは件数を出さず、
 * `hasOtherExcluded`が真の場合のみ「その他は公式パッチノートで」という定型の誘導文を末尾に添える）。
 * 0体/0件の項目（チャンピオンの内訳・チャンピオン全体・アイテム）は文から省く（純テンプレ・AI不使用）。
 */
function buildPatchIntroSummaryChampionItem(
  label: string,
  buffCount: number,
  nerfCount: number,
  adjustCount: number,
  itemCount: number,
  hasOtherExcluded: boolean,
): string {
  const champTotal = buffCount + nerfCount + adjustCount;
  const champParts: string[] = [];
  if (buffCount > 0) champParts.push(`強化${buffCount}`);
  if (nerfCount > 0) champParts.push(`弱体化${nerfCount}`);
  if (adjustCount > 0) champParts.push(`調整${adjustCount}`);

  const champClause = champTotal > 0 ? `チャンピオン${champTotal}体（${champParts.join("・")}）` : "";
  const itemClause = itemCount > 0 ? `アイテム${itemCount}件` : "";

  let mainSentence: string;
  if (champClause && itemClause) {
    mainSentence = `${label}では、${champClause}と${itemClause}の変更をまとめました。`;
  } else if (champClause) {
    mainSentence = `${label}では、${champClause}の変更をまとめました。`;
  } else if (itemClause) {
    mainSentence = `${label}では、${itemClause}の変更をまとめました。`;
  } else {
    mainSentence = `${label}の変更点をまとめます。`;
  }

  return hasOtherExcluded
    ? `${mainSentence}システム・アリーナ・バグ修正などその他の変更点は公式パッチノートをご覧ください。`
    : mainSentence;
}

/**
 * detailed パッチ本文の平テキスト経路フォールバック（拡張E53 F-E53-1、lol-times風の詳細記事。
 * 拡張E54 F-E54-1でチャンピオン以外の変更点にも対応。成長G3で「バフ/ナーフ/調整」3分類＋
 * 冒頭サマリ＋目次に対応）を組み立てる。
 * パッチ記事刷新S2 F-S2-2: DOM抽出（`composeDetailedPatchBody`）が使えない（`candidate.html`未取得・
 * DOM構造変化で空配列）場合のフォールバックとして温存する（優先順 DOM > 平テキスト > 事実速報）。
 * `extractPatchSectionsDeterministic` が返した逐語の変更点を使い、次の順で本文を構成する:
 * 1. `candidate.imageUrl`（og:image バナー）が安全なhttps画像URLなら先頭に画像ブロック。
 * 2. 冒頭1文サマリ（3分類の集計から純テンプレで生成、F-G3-3）。
 * 3. 目次（toc、F-G3-4。本文中の全ての章見出しへのページ内リンク一覧）。
 * 4. チャンピオンの変更（あれば）: `classifyChampion` で「主な強化」「主な弱体化」「その他の調整」の
 *    3グループに振り分け、グループごとに見出し→各チャンピオン見出し→画像ブロック
 *    （`championNameToId` で解決できた場合のみ・省略時はテキストのみ）→ 変更点の段落
 *    （本文の部分文字列そのまま、逐語維持）。空グループは出さない。グループ内のチャンピオン順は
 *    抽出順（本文出現順）を維持する。
 * 5. チャンピオン以外の変更（あれば）: セクションごとに見出し（アイテム/システム等の見出し）
 *    → 変更点の段落（画像は付けない・テキストのみ）。
 * 6. 出典URLが安全なhttpsなら公式リンクボタン（linkButton）。
 * 4・5はその回のパッチに存在するものだけを出す（臨機応変。無い種類の節は出さない）。
 * 各章見出しには決定論的な連番anchor（`sec-1`等）を付与し、toc の items から全見出しへ
 * ページ内リンクできるようにする（F-G3-4）。AIは使わない（決定的抽出・分類・集計・公式画像URLの
 * 組み立てのみ）。
 */
function composeDetailedPatchBodyFromText(
  candidate: GenerationCandidateInput,
  sections: PatchChangesSections,
): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "今回のパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();

  // バフ/ナーフ/調整の3分類（成長G3 F-G3-1）。抽出順（本文出現順）を維持して振り分ける。
  const buffChampions: PatchChampionChanges[] = [];
  const nerfChampions: PatchChampionChanges[] = [];
  const adjustChampions: PatchChampionChanges[] = [];
  for (const c of sections.champions) {
    const cls = classifyChampion(c.changes);
    if (cls === "buff") buffChampions.push(c);
    else if (cls === "nerf") nerfChampions.push(c);
    else adjustChampions.push(c);
  }
  const groups: { heading: string; champions: PatchChampionChanges[] }[] = [
    { heading: "チャンピオンの強化", champions: buffChampions },
    { heading: "チャンピオンの弱体化", champions: nerfChampions },
    { heading: "チャンピオンの調整", champions: adjustChampions },
  ].filter((g) => g.champions.length > 0);

  // 本文ブロック（見出し以外の中身）を組み立てつつ、各見出しに連番anchorを付与する（F-G3-4）。
  const contentBlocks: ArticleBodyBlock[] = [];
  let anchorSeq = 0;
  function pushHeading(text: string): void {
    anchorSeq++;
    contentBlocks.push({ type: "heading", text, anchor: `sec-${anchorSeq}` });
  }

  for (const g of groups) {
    pushHeading(g.heading);
    for (const c of g.champions) {
      pushHeading(c.champion);
      const championId = championNameToId(c.champion);
      if (championId) {
        contentBlocks.push({
          type: "image",
          url: buildChampionSplashUrl(championId),
          alt: `${c.champion}のスプラッシュアート`,
          credit: "画像: Riot Games 公式(Data Dragon)より",
        });
      }
      for (const change of c.changes) {
        contentBlocks.push({ type: "paragraph", text: change });
      }
    }
  }

  // チャンピオン以外の変更（アイテム/ルーン/アリーナ/システム/バグ修正等、拡張E54 F-E54-1）。
  // 3分類の対象外（画像は付けずテキストのみ）。存在するセクションだけを臨機応変に出す。
  for (const s of sections.other) {
    pushHeading(s.heading);
    for (const change of s.changes) {
      contentBlocks.push({ type: "paragraph", text: change });
    }
  }

  const tocItems = contentBlocks
    .filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading")
    .map((h) => ({ label: h.text, anchor: h.anchor as string }));

  const blocks: ArticleBodyBlock[] = [];

  if (isSafeImageUrl(candidate.imageUrl)) {
    blocks.push({
      type: "image",
      url: candidate.imageUrl,
      alt: `${label} 公式パッチノートのメイン画像`,
      credit: "画像: Riot Games 公式パッチノートより",
    });
  }

  blocks.push({
    type: "paragraph",
    text: buildPatchIntroSummary(label, buffChampions.length, nerfChampions.length, adjustChampions.length, sections.other.length),
  });

  if (tocItems.length > 0) {
    blocks.push({ type: "toc", items: tocItems });
  }

  blocks.push(...contentBlocks);

  if (sourceUrl && isHttpsUrl(sourceUrl)) {
    blocks.push({ type: "linkButton", url: sourceUrl, label: `▶ ${label} 公式パッチノートを読む` });
  } else {
    blocks.push({
      type: "paragraph",
      text: "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    });
  }

  return blocks;
}

/**
 * 対象アイコン(targetIconUrl)がDOM抽出で取れなかった場合のフォールバック（パッチ記事刷新S3 F-S3-3、
 * 軽量・任意）。champion対象は id（アイコンURLファイル名解決）または名前（`championNameToId`、
 * champion-splash.tsの既存ID解決を再利用）からDDragon champion square URLを、item対象は
 * id（数値）からDDragonアイテムアイコンURLを組み立てる。ddragonVersionが取れない（同一パッチの
 * どのアイコンからもバージョンを推定できない）場合や解決不能な場合はundefined（画像を省略するだけで
 * 記事は壊れない・過剰実装しない）。スキルアイコンの補完は困難なため対象外（brief F-S3-3どおり）。
 */
function resolveFallbackTargetIconUrl(
  target: PatchChangeTarget,
  ddragonVersion: string | undefined,
): string | undefined {
  if (target.iconUrl || !ddragonVersion) return undefined;
  if (target.kind === "champion") {
    const championId = target.id || championNameToId(target.name) || undefined;
    return championId ? buildChampionSquareIconUrl(championId, ddragonVersion) : undefined;
  }
  if (target.kind === "item" && target.id) {
    return buildItemIconUrl(target.id, ddragonVersion);
  }
  return undefined;
}

/** DOM抽出した1対象（`PatchChangeTarget`）を`patchChange`ブロックへ変換する（パッチ記事刷新S2 F-S2-2、
 * S3 F-S3-2/F-S3-3で画像表示・フォールバックに対応）。
 * 対象名(h3)・スキルキー・変更前後・意図は本文の文字そのまま（逐語維持・捏造禁止）。画像URLは
 * DOM抽出済みの正規化URL（`patch-notes-parser.ts`のnormalizePatchIconUrl適用済み）を優先し、
 * 欠落時のみフォールバックで補完する。 */
function buildPatchChangeBlock(
  target: PatchChangeTarget,
  direction: "buff" | "nerf" | "adjust",
  ddragonVersion: string | undefined,
): ArticleBodyPatchChangeBlock {
  const targetIconUrl = target.iconUrl ?? resolveFallbackTargetIconUrl(target, ddragonVersion);
  return {
    type: "patchChange",
    targetName: target.name,
    ...(targetIconUrl ? { targetIconUrl } : {}),
    targetKind: target.kind,
    direction,
    ...(target.intent ? { intent: target.intent } : {}),
    groups: target.groups.map((g) => ({
      ...(g.abilityKey ? { abilityKey: g.abilityKey } : {}),
      ...(g.abilityName ? { abilityName: g.abilityName } : {}),
      ...(g.abilityIconUrl ? { abilityIconUrl: g.abilityIconUrl } : {}),
      changes: g.changes,
    })),
  };
}

/**
 * detailed パッチ本文（パッチ記事刷新S2 F-S2-2、DOM抽出ベース）を組み立てる。S1の
 * `parsePatchNotesHtml(html)` が返した `PatchChangeTarget[]`（誤帰属ゼロ）から、G3の構造を
 * 踏襲して本文を組み立てる:
 * 1. `candidate.imageUrl`（og:image バナー）が安全なhttps画像URLなら先頭に画像ブロック。
 * 2. 冒頭1文サマリ（champion/itemの集計から純テンプレで生成、パッチ記事刷新S8 F-S8-2）。
 * 3. 目次（toc、本文中の全ての章見出しへのページ内リンク一覧。champion 3グループ＋
 *    「アイテムの変更」のみ、パッチ記事刷新S8 F-S8-2）。
 * 4. チャンピオン対象（あれば）: `classifyPatchTargetDirection`（F-S2-3）で「チャンピオンの強化」
 *    「チャンピオンの弱体化」「チャンピオンの調整」の3グループに振り分け、グループごとに見出し→
 *    各対象を`patchChange`ブロックで出力する（対象名(h3)は各ブロックのtargetNameに個別のまま
 *    残る＝総称に潰さない。パッチ記事刷新S9で見出し文言を「主な〜」から変更）。
 * 5. アイテム対象（あれば）: 独立の「アイテムの変更」章にまとめ、対象名付きで`patchChange`ブロックを列挙する
 *    （パッチ記事刷新S8 F-S8-1）。
 * 6. system/arena/bugfix/rune/augment/other等の非champion/item対象は本文に出さない
 *    （パッチ記事刷新S8 F-S8-1。フィルタは`bodyTargets`算出の1箇所に集約し、絞りは可逆）。
 *    除外があれば「その他の変更点は公式で」誘導セクション（見出し＋短文）を末尾近くに出す（F-S8-3）。
 * 7. 出典URLが安全なhttpsなら公式リンクボタン（linkButton）。
 * 4・5はその回のパッチに実在する対象だけを出す（臨機応変）。各章見出しには決定論的な連番anchor
 * （`sec-1`等）を付与し、tocのitemsから全見出しへページ内リンクできるようにする。
 * AIは使わない（DOM抽出・分類・集計はすべて純ルール）。S1〜S7の抽出ロジック(`targets`自体)は不変。
 */
function composeDetailedPatchBody(
  candidate: GenerationCandidateInput,
  targets: PatchChangeTarget[],
): ArticleBodyBlock[] {
  const patchNumber = extractPatchNumberLabel(candidate);
  const label = patchNumber ? `パッチ${patchNumber}` : "今回のパッチ";
  const sourceUrl = candidate.sourceUrl?.trim();

  // パッチ記事刷新S8 F-S8-1: 本文化の対象をchampion/itemのみに絞る唯一の箇所（1箇所に集約・可逆）。
  // system/arena/bugfix/rune/augment/other は抽出(targets)には残るが本文には出さない。
  const bodyTargets = targets.filter((t) => t.kind === "champion" || t.kind === "item");
  const excludedCount = targets.length - bodyTargets.length;

  const directionByTarget = new Map<PatchChangeTarget, "buff" | "nerf" | "adjust">(
    bodyTargets.map((t) => [t, classifyPatchTargetDirection(t)]),
  );

  // バフ/ナーフ/調整の3分類（F-S2-3）。抽出順（本文出現順）を維持して振り分ける。チャンピオン対象のみ。
  const championTargets = bodyTargets.filter((t) => t.kind === "champion");
  const buffChampions = championTargets.filter((t) => directionByTarget.get(t) === "buff");
  const nerfChampions = championTargets.filter((t) => directionByTarget.get(t) === "nerf");
  const adjustChampions = championTargets.filter((t) => directionByTarget.get(t) === "adjust");
  const championGroups: { heading: string; items: PatchChangeTarget[] }[] = [
    { heading: "チャンピオンの強化", items: buffChampions },
    { heading: "チャンピオンの弱体化", items: nerfChampions },
    { heading: "チャンピオンの調整", items: adjustChampions },
  ].filter((g) => g.items.length > 0);

  // アイテム対象（あれば）: 3分類はせず、独立の「アイテムの変更」章に対象名付きで列挙する（F-S8-1）。
  const itemTargets = bodyTargets.filter((t) => t.kind === "item");

  // 同一パッチ内の他アイコンURLからDDragonバージョンを推定する（S3 F-S3-3のフォールバック画像組み立てに使う）。
  // 除外された対象(system/arena等)のアイコンも推定材料に使えるよう、targets全体を渡す（抽出は不変）。
  const ddragonVersion = inferDdragonVersionFromTargets(targets);

  // 本文ブロック（見出し以外の中身）を組み立てつつ、各見出しに連番anchorを付与する。
  const contentBlocks: ArticleBodyBlock[] = [];
  let anchorSeq = 0;
  function pushHeading(text: string): void {
    anchorSeq++;
    contentBlocks.push({ type: "heading", text, anchor: `sec-${anchorSeq}` });
  }

  for (const g of championGroups) {
    pushHeading(g.heading);
    for (const t of g.items) {
      contentBlocks.push(buildPatchChangeBlock(t, directionByTarget.get(t)!, ddragonVersion));
    }
  }

  if (itemTargets.length > 0) {
    pushHeading("アイテムの変更");
    for (const t of itemTargets) {
      contentBlocks.push(buildPatchChangeBlock(t, directionByTarget.get(t)!, ddragonVersion));
    }
  }

  const tocItems = contentBlocks
    .filter((b): b is Extract<ArticleBodyBlock, { type: "heading" }> => b.type === "heading")
    .map((h) => ({ label: h.text, anchor: h.anchor as string }));

  const blocks: ArticleBodyBlock[] = [];

  if (isSafeImageUrl(candidate.imageUrl)) {
    blocks.push({
      type: "image",
      url: candidate.imageUrl,
      alt: `${label} 公式パッチノートのメイン画像`,
      credit: "画像: Riot Games 公式パッチノートより",
    });
  }

  blocks.push({
    type: "paragraph",
    text: buildPatchIntroSummaryChampionItem(
      label,
      buffChampions.length,
      nerfChampions.length,
      adjustChampions.length,
      itemTargets.length,
      excludedCount > 0,
    ),
  });

  if (tocItems.length > 0) {
    blocks.push({ type: "toc", items: tocItems });
  }

  blocks.push(...contentBlocks);

  // パッチ記事刷新S8 F-S8-3: 除外(system/arena/bugfix/rune等)があれば、情報を隠さず公式へ誘導する
  // 見出し＋短文を出す（除外0件なら誘導文は出さず、公式リンクボタンのみ従来どおり出す）。
  if (excludedCount > 0) {
    blocks.push({ type: "heading", text: "その他の変更点は公式で" });
    blocks.push({
      type: "paragraph",
      text: "システム・アリーナ・バグ修正・ルーン等、チャンピオン/アイテム以外の変更点は公式パッチノートでご確認ください。",
    });
  }

  if (sourceUrl && isHttpsUrl(sourceUrl)) {
    blocks.push({ type: "linkButton", url: sourceUrl, label: `▶ ${label} 公式パッチノートを読む` });
  } else {
    blocks.push({
      type: "paragraph",
      text: "出典: Riot Games 公式サイトのパッチノートページをご確認ください。",
    });
  }

  return blocks;
}

/** Riot公式（riot）由来: 「速報＋要点整理」構成（従来どおり）。 */
const FACT_PROFILE = {
  introHeading: "速報",
  itemsHeading: "要点整理",
  summaryTask: (sentence: string, index: number): GenerationTask => ({ kind: "fact-summary", sentence, index }),
};

/** Riot公式向けの共通骨格（導入→要点整理ループ→context→まとめ）で本文ブロックを組み立てる。 */
async function composeFactBody(
  candidate: GenerationCandidateInput,
  sentences: string[],
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const { sourceType, title } = candidate;
  const blocks: ArticleBodyBlock[] = [];
  const citationLabel = QUOTE_SOURCE_LABEL[sourceType];

  blocks.push({ type: "heading", text: FACT_PROFILE.introHeading });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "intro", sourceType, title }) });

  blocks.push({ type: "heading", text: FACT_PROFILE.itemsHeading });
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    blocks.push({ type: "paragraph", text: await askLLM(llmClient, FACT_PROFILE.summaryTask(sentence, i)) });
    blocks.push({ type: "quote", text: excerptForQuote(sentence), source: citationLabel });
  }

  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "context", sourceType, title }) });

  blocks.push({ type: "heading", text: "まとめ" });
  blocks.push({ type: "paragraph", text: await askLLM(llmClient, { kind: "closing", sourceType, title }) });

  return blocks;
}

/**
 * 掲示板/Reddit（5ch/reddit）由来: 「まとめ速報レス形式」で本文ブロックを組み立てる。
 * AI要約段落は付けず、「反応まとめ」見出し＋スレッドのレス群を逐語のまま並べた reaction ブロックのみで
 * 構成する（2026-07-25 ユーザー決定: レスの羅列中心のシンプルなまとめ構成への改修）。
 * さらにレス本文中に埋め込み許可URL（YouTube/Twitchクリップ）があれば、逐語テキストはそのまま保持しつつ
 * embedブロックを加算する（拡張E22 F-E22-1。0件なら従来どおり何も足さない）。
 */
async function composeReactionBody(
  candidate: GenerationCandidateInput,
  sourceType: "5ch" | "reddit",
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const blocks: ArticleBodyBlock[] = [];

  blocks.push({ type: "heading", text: "反応まとめ" });
  blocks.push(...(await buildReactionBlocks(candidate, sourceType, llmClient)));
  blocks.push(...detectClipEmbedBlocks(candidate.content));

  return blocks;
}

/**
 * env `PATCH_ARTICLE_MODE` によるriot（パッチ）記事の構成モード切替（拡張E41 F-E41-2、拡張E53 F-E53-1で
 * "detailed" を追加し既定にした）。
 * - "fact": 事実速報のみ（LLM不使用、拡張E41）。
 * - "summary": 従来のE40 3段（LLM要約→決定的抽出→クリーン定型）。後でLLMまとめに戻す可能性があるため
 *   コード・テストは削除せず残す。
 * - それ以外（未設定含む、既定）: "detailed"（チャンピオンごとの画像＋変更前後の詳細記事、拡張E53）。
 */
function patchArticleMode(): "detailed" | "fact" | "summary" {
  if (process.env.PATCH_ARTICLE_MODE === "fact") return "fact";
  if (process.env.PATCH_ARTICLE_MODE === "summary") return "summary";
  return "detailed";
}

/**
 * riot-newsの要約LLMへのsystem指示（リファクタリングS7b F-S7b-3）。捏造禁止・出力形式(JSON)・
 * 2〜4文の短い要約に固定する。composePatchSummaryBodyと同様に、失敗（APIエラー・空応答・解析不能）
 * 時は呼び出し側がクリーンな定型文にフォールバックする。渡す本文はページ全体のテキストダンプで
 * ナビ・著作権表記・関連リンク等のノイズを含みうるため、composePatchSummaryBody同様それらを
 * 無視するよう明示する（実データ確認: lolesports.com記事は著作権/規約フッターを含む）。
 */
const NEWS_SUMMARY_SYSTEM_PROMPT =
  "あなたはLoLまとめサイトの編集者です。次に渡す本文はRiot Games公式ニュース記事ページ全体のテキスト" +
  "ダンプで、ナビゲーションメニュー・著作権表記・利用規約リンク・関連記事へのリンクなど、記事内容とは" +
  "無関係なノイズを含むことがあります。それらのノイズは無視し、記事本文の内容を日本語で2〜4文の" +
  "簡潔な要約にしてください。本文に書かれていない事実・数値・固有名詞を作ってはいけません(捏造禁止)。" +
  "本文の趣旨を忠実に伝える要約にしてください。" +
  '出力はJSONのみとし、{"summary": "2〜4文の要約"} の形式にしてください' +
  "（説明文・前置き・コードブロックは付けない）。";

/** LLMの生出力（JSON、コードフェンス付きの可能性あり）を要約文字列に検証・正規化する。失敗時はnull。 */
function parseNewsSummary(raw: string): string | null {
  const jsonStr = extractJsonObject(raw);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
      return parsed.summary.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * riot-newsの本文からLLMに2〜4文の忠実な要約を生成させる（リファクタリングS7b F-S7b-3）。
 * APIエラー・空応答・JSON解析失敗など、うまく要約できない場合は例外を投げずnullを返し、
 * 呼び出し側（composeRiotNewsBody）がクリーンな定型文にフォールバックする（本体を止めない）。
 */
async function composeNewsSummaryText(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<string | null> {
  try {
    const raw = await llmClient.generate([
      { role: "system", content: NEWS_SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ title: candidate.title, content: candidate.content }) },
    ]);
    if (typeof raw !== "string" || raw.trim().length === 0) return null;
    return parseNewsSummary(raw);
  } catch {
    return null;
  }
}

/**
 * Riot公式ニュース（riot-news）記事を組み立てる（リファクタリングS7b F-S7b-3）。
 * 1. `candidate.imageUrl`（og:image）が安全なhttps画像URLなら先頭に画像ブロック
 *    （alt=タイトル、credit「画像: Riot Games 公式サイトより」）。
 * 2. 見出し（記事タイトル＝og:title、事実そのまま。generate-article.ts側で煽りLLMは通さない）。
 * 3. 短い要約（AI・2〜4文、composeNewsSummaryText）。失敗時はクリーンな定型文にフォールバック
 *    （捏造せず壊れない）。
 * 4. 出典URLが安全なhttpsなら公式リンクボタン（linkButton）。
 */
async function composeRiotNewsBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const blocks: ArticleBodyBlock[] = [];

  if (isSafeImageUrl(candidate.imageUrl)) {
    blocks.push({
      type: "image",
      url: candidate.imageUrl,
      alt: candidate.title,
      credit: "画像: Riot Games 公式サイトより",
    });
  }

  blocks.push({ type: "heading", text: candidate.title });

  const summary = await composeNewsSummaryText(candidate, llmClient);
  blocks.push({
    type: "paragraph",
    text:
      summary ??
      `Riot Games 公式より「${candidate.title}」に関するニュースが公開されました。詳しくは公式サイトをご覧ください。`,
  });

  const sourceUrl = candidate.sourceUrl?.trim();
  if (sourceUrl && isHttpsUrl(sourceUrl)) {
    blocks.push({ type: "linkButton", url: sourceUrl, label: "▶ 公式サイトで読む" });
  }

  return blocks;
}

/** テキストに日本語（ひらがな・カタカナ・常用漢字域）が含まれるか判定する簡易純関数（lang:ja判定の補助）。 */
function containsJapaneseText(text: string): boolean {
  return /[぀-ヿ一-龯]/.test(text);
}

/**
 * lang:en相当（日本語を含まない）のX投稿本文を、既存reddit経路のレス翻訳バッチ
 * （`translateReactionBatch`）に合流させて日本語化する（成長G7 F-G7-4「翻訳は既存reddit経路に合流」。
 * 追加のAI呼び出し種別は増やさない）。日本語を含む場合（lang:ja）は翻訳不要のためそのまま返す。
 * 翻訳失敗（APIエラー・空応答・mock等）時は原文をそのまま返す（本体を止めない）。
 */
async function translateXContentIfNeeded(llmClient: LLMClient, text: string): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length === 0 || containsJapaneseText(trimmed)) return trimmed;
  const translated = await translateReactionBatch(llmClient, [{ index: 0, text: trimmed }]);
  const result = translated?.get(0);
  return result && result.trim().length > 0 ? result.trim() : trimmed;
}

/**
 * X（旧Twitter）投稿を「独自の見出し・導入・要約が主、tweet埋め込み/短い引用＋出典が従」の構成で
 * 組み立てる（成長G7 F-G7-4）。著作権法32条の適法引用（明瞭区別・主従関係・出典明記）に配慮し、
 * tweet全文コピペ・スクショ多用はしない。
 * 1. 見出し「Xでの反応」。
 * 2. 独自の導入段落（LLM、既存の`intro`タスクに合流。riot以外の汎用テンプレをそのまま使う）。
 * 3. tweet URLが有効なステータスURL（`isValidTweetStatusUrl`）なら twitter provider の embedブロック
 *    （公式の埋め込み表示。原文そのまま・翻訳不要）。無効/取得できない場合のみ、短い引用
 *    （`excerptForQuote`でtweet全文コピペを避ける。日本語を含まない本文はreddit経路の翻訳に合流してから
 *    抜粋する）＋出典（カテゴリラベル＋作者名）。
 * 4. 独自の結び段落（LLM、既存の`context`タスクに合流）。
 */
async function composeXBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const blocks: ArticleBodyBlock[] = [];
  blocks.push({ type: "heading", text: "Xでの反応" });
  blocks.push({
    type: "paragraph",
    text: await askLLM(llmClient, { kind: "intro", sourceType: "x", title: candidate.title }),
  });

  const sourceUrl = candidate.sourceUrl?.trim();
  if (sourceUrl && isValidTweetStatusUrl(sourceUrl)) {
    blocks.push({ type: "embed", provider: "twitter", url: sourceUrl });
  } else {
    const displayText = await translateXContentIfNeeded(llmClient, candidate.content);
    const citation = candidate.author
      ? `${QUOTE_SOURCE_LABEL.x}（${candidate.author}）`
      : QUOTE_SOURCE_LABEL.x;
    blocks.push({ type: "quote", text: excerptForQuote(displayText || candidate.content), source: citation });
  }

  blocks.push({
    type: "paragraph",
    text: await askLLM(llmClient, { kind: "context", sourceType: "x", title: candidate.title }),
  });

  return blocks;
}

/** 本文の先頭に速報バッジ段落を追加する（S5 F-S5-2、バッジ本文の定義は`article-body.ts`）。 */
function prependPatchPreviewBadge(body: ArticleBodyBlock[]): ArticleBodyBlock[] {
  return [{ type: "paragraph", text: PATCH_PREVIEW_BADGE_TEXT }, ...body];
}

/**
 * riot（Riot公式データ/パッチノート）由来の本文組み立て（速報バッジを除く本体部分）。
 * 既定(env `PATCH_ARTICLE_MODE`未設定/"detailed")では、実パッチノート本文
 * （PATCH_NOTES_MIN_LENGTH以上）からチャンピオンごとの変更点が決定的抽出できればlol-times風の詳細記事
 * （画像＋変更前後、拡張E53 F-E53-1）にし、抽出できない／本文が無い場合は事実速報にフォールバックする。
 * "fact" では本文の長短に関わらず常に事実速報（拡張E41 F-E41-2）。"summary" なら従来のE40の3段
 * （LLM要約のまとめ記事→決定的抽出→クリーン定型フォールバック、contentが短い汎用文なら速報＋要点整理）。
 */
async function composeRiotArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  const mode = patchArticleMode();
  if (mode === "fact") {
    return composePatchFactFlashBody(candidate);
  }
  if (mode === "detailed") {
    // パッチ記事刷新S2 F-S2-2: 優先順は DOM抽出 > 平テキスト抽出 > 事実速報。
    // 生HTML（candidate.html、riot-datadragon.tsが保持・post-pipeline.tsが配線）があれば、
    // まずDOM構造パーサ（誤帰属ゼロ）を試みる。DOM構造変化・未取得等で空配列の場合のみ
    // 平テキスト経路（フォールバック、S1以前の既存ロジック）に落ちる。
    if (candidate.html) {
      const targets = parsePatchNotesHtml(candidate.html);
      if (targets.length > 0) return composeDetailedPatchBody(candidate, targets);
    }
    // 実パッチノート本文（汎用の短いcontentではない）と見なせるときのみ、決定的（逐語）抽出を試みる。
    // 拡張E54 F-E54-1: チャンピオン節に加え、チャンピオン以外（アイテム/システム等）の変更点も
    // その回のパッチに存在するものだけ臨機応変に抽出する。
    if (candidate.content.length >= PATCH_NOTES_MIN_LENGTH) {
      const sections = extractPatchSectionsDeterministic(candidate.content);
      if (sections) return composeDetailedPatchBodyFromText(candidate, sections);
    }
    // 変更点が抽出できない、または本文が無い（mock等）場合は事実速報にフォールバックする
    // （壊れない・捏造しない、拡張E53 F-E53-1）。
    return composePatchFactFlashBody(candidate);
  }
  // "summary"モード: 従来どおり、content が実パッチノート本文（汎用の短いcontentではない）と
  // みなせるときのみLLM要約を試みる。
  if (candidate.content.length >= PATCH_NOTES_MIN_LENGTH) {
    const patchSummaryBody = await composePatchSummaryBody(candidate, llmClient);
    if (patchSummaryBody) return patchSummaryBody;
    // 要約失敗（mock・APIエラー・解析失敗・全カテゴリ空等）時は、まずLLM非依存の決定的（逐語）抽出
    // （拡張E40 F-E40-2）を試みる。「⇒」を含む変更行がチャンピオン節から取れれば、ノイズ断片・
    // 破綻文を含まない「主な変更点」本文をそのまま採用する（捏造無しの実用的な本文になる）。
    const deterministicChanges = extractPatchChangesDeterministic(candidate.content);
    console.log(`[patch] deterministic changes champions=${deterministicChanges?.length ?? 0}`);
    if (deterministicChanges) return composeDeterministicPatchChangesBody(deterministicChanges);
    // 決定的抽出も空（本文が取れていない可能性）の場合のみ、パッチノート本文
    // （ページ全体ダンプでノイズ込み）を composeFactBody（逐文リライト）には渡さず、
    // ノイズ断片・破綻文を含まないクリーンな簡易パッチ記事にする（拡張E35 F-E35-3）。
    return composeCleanPatchFallbackBody(candidate);
  }
  // 本文が無い（短い汎用content）の場合は従来どおり速報＋要点整理（composeFactBody）でよい。
  const sentences = splitIntoSentences(candidate.content);
  return composeFactBody(candidate, sentences, llmClient);
}

/**
 * 記事化候補から構造化された本文ブロック配列を組み立てる（F7）。
 * sourceType が "riot" なら上記 `composeRiotArticleBody` を使う（S5 F-S5-2で速報バッジを付与）。
 * "riot-news"（リファクタリングS7b）なら image→見出し→短い要約→公式リンクの定型構成
 * （composeRiotNewsBody）。"x"（成長G7）なら見出し→独自導入→tweet埋め込み/短い引用＋出典→独自結び
 * の構成（composeXBody、著作権法32条の適法引用に配慮）。それ以外（5ch/reddit）ならまとめ速報レス形式にする。
 */
export async function composeArticleBody(
  candidate: GenerationCandidateInput,
  llmClient: LLMClient,
): Promise<ArticleBodyBlock[]> {
  if (candidate.sourceType === "riot") {
    const body = await composeRiotArticleBody(candidate, llmClient);
    // パッチ記事刷新S5 F-S5-2（opt-in）: 未適用パッチの先行速報アイテム（post-pipeline.tsが
    // Post.mediaのpatchPreviewフラグから渡す）のときだけ、本文の先頭に速報バッジ段落を追加する。
    // 通常（isPatchPreview未設定/false）は従来と完全同一（回帰ゼロ）。
    return candidate.isPatchPreview ? prependPatchPreviewBadge(body) : body;
  }
  if (candidate.sourceType === "riot-news") {
    return composeRiotNewsBody(candidate, llmClient);
  }
  if (candidate.sourceType === "x") {
    return composeXBody(candidate, llmClient);
  }
  return composeReactionBody(candidate, candidate.sourceType, llmClient);
}
