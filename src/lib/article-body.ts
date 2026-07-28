/**
 * 記事本文を「見出し＋段落＋引用＋レス（まとめ速報形式）＋画像＋埋め込み」のブロック配列として
 * 構造化するための型と検証ロジック。DB には JSON として保存し（prisma/schema.prisma の Article.body）、
 * 表示前に必ずここでパース・検証してから使う（LLM 非依存の純関数）。
 *
 * ⚠ 記事フォーマット改修（2026-07-25・ユーザー決定）: 掲示板/SNS由来（5ch/reddit）の記事は、
 * 「AI要約段落＋短い引用」から「番号付きレスを逐語のまま羅列する、まとめ速報レス形式」に変更した。
 * その中核ブロックが `reaction` 型。旧来の heading/paragraph/quote 型は Riot公式由来の
 * 「速報＋要点整理」構成で引き続き使うため、両方を許容する（後方互換）。
 *
 * ⚠ コンテンツ表現拡張（拡張E3）: `image`（記事内画像）・`embed`（SNS/動画埋め込み）ブロックを追加。
 * どちらも「実際の著作物を取り込まない」方針で、画像はローカルSVG/データURI/自サイト作成の
 * モック画像のみ許可し、埋め込みは実iframeを読み込まずプレースホルダーカードのみを表示する
 * （URLは provider ごとの正規ドメインのホワイトリストで検証、dangerouslySetInnerHTML は使わない）。
 *
 * ⚠ 拡張E42: `linkButton`（大きく目立つボタン風の外部リンク）ブロックを追加。パッチ記事で
 * 公式パッチノートへ誘導するために使う。url は https のみ許可する。
 */
import { isAllowedEmbedUrl, isEmbedProvider, type EmbedProvider } from "@/lib/embed";
import { isSafeLocalAssetPath } from "@/lib/image-url";

/** レス本文の1行。重要・面白い行は決定論ヒューリスティックで赤/オレンジに強調する（compose.ts参照）。
 * `original` は海外の反応（reddit由来）で原文（英語）を併記する場合のオリジナル創作テキスト
 * （`text` 側が日本語訳）。 */
export type ArticleBodyReactionLine = { text: string; emphasis?: "red" | "orange"; original?: string };

/** レス単位の強調色（拡張E32、拡張E36で緑を廃止し紫を追加）。おばにゅー流に赤/青/紫/オレンジで
 * 色分けする（名前見出し（ResHeader）の緑と被って見えづらくなるため緑は使わない）。 */
export type ArticleBodyEmphasisColor = "red" | "blue" | "purple" | "orange";

/** 掲示板/SNSの1書き込み（レス）をまとめ速報形式で表すブロック。逐語表示が前提。 */
export type ArticleBodyReactionBlock = {
  type: "reaction";
  /** レス番号（例: 1）。表示は「1: 名前」の形式にする。 */
  number: number;
  /** 匿名化ハンドル名（例: 国内プレイヤーさん／海外プレイヤーさん）。実名は使わない。 */
  name: string;
  lines: ArticleBodyReactionLine[];
  /** `>>N` 形式で他レスに返信している場合の参照先番号（同一記事内に存在する番号のみ）。 */
  anchors?: number[];
  /**
   * レス単位の強調フラグ（拡張E25 F-E25-2）。LLMが「話題に関係する重要なレス」として選んだ
   * レスのうち、特に強調すべきと判定したレスに立つ。行単位の emphasis(red/orange) とは役割が違い、
   * レス全体を大きく＋太字で目立たせる。任意フラグで未設定時は従来表示（後方互換）。
   */
  emphasis?: boolean;
  /**
   * 強調レスの色（拡張E32 F-E32-1、拡張E36で緑を廃止し紫を追加）。`emphasis:true` のときのみ
   * 意味を持ち、LLMが割り当てた場合に赤/青/紫/オレンジの色付きで強調する。未指定（`emphasis:true`のみ）は
   * 色無し・通常サイズ・非太字の黒字表示になる（拡張E36 F-E36-2: 黒字は統一表示にする）。
   */
  emphasisColor?: ArticleBodyEmphasisColor;
};

/** 記事内画像ブロック（拡張E3）。url はローカルSVG/データURI/自サイト作成のモック画像のみを想定
 * （`isSafeImageUrl` で検証）。credit は出典・提供元クレジット（任意、キャプションとして表示）。 */
export type ArticleBodyImageBlock = { type: "image"; url: string; alt: string; credit?: string };

/** SNS/動画の埋め込みブロック（拡張E3）。実iframeは読み込まず、provider が分かる
 * プレースホルダーカード＋元URLへのリンクのみを表示する。url は `isAllowedEmbedUrl` で
 * provider ごとの正規ドメインのホワイトリスト検証を行う。 */
export type ArticleBodyEmbedBlock = { type: "embed"; provider: EmbedProvider; url: string; caption?: string };

/** 大きく目立つボタン風の外部リンクブロック（拡張E42）。パッチ記事の公式パッチノートリンク等に使う。
 * `url` は https のみ許可（`javascript:` 等は弾く）。`label` を表示しURL文字列自体は出さない。 */
export type ArticleBodyLinkButtonBlock = { type: "linkButton"; url: string; label: string };

/** 章見出しブロック。`anchor`（成長G3）は目次からページ内リンクするための任意のid。
 * 未指定の既存見出し（旧記事・fact/summaryモード等）は従来どおり anchor なしで表示される（後方互換）。 */
export type ArticleBodyHeadingBlock = { type: "heading"; text: string; anchor?: string };

/**
 * 目次（TOC）ブロック（成長G3 F-G3-4）。記事内の章見出しへページ内リンクする一覧。
 * `items` の `anchor` は同じ記事内に存在する heading ブロックの `anchor` と対応する。
 */
export type ArticleBodyTocBlock = { type: "toc"; items: { label: string; anchor: string }[] };

export type ArticleBodyBlock =
  | ArticleBodyHeadingBlock
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; source?: string }
  | ArticleBodyReactionBlock
  | ArticleBodyImageBlock
  | ArticleBodyEmbedBlock
  | ArticleBodyLinkButtonBlock
  | ArticleBodyTocBlock;

export class InvalidArticleBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArticleBodyError";
  }
}

const TEXT_TYPES = new Set(["heading", "paragraph", "quote"]);

function parseReactionBlock(b: Record<string, unknown>, index: number): ArticleBodyReactionBlock {
  if (typeof b.number !== "number" || !Number.isInteger(b.number) || b.number <= 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の number が不正です: ${String(b.number)}`);
  }
  if (typeof b.name !== "string" || b.name.trim().length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の name が空です`);
  }
  if (!Array.isArray(b.lines) || b.lines.length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の lines が空です`);
  }
  const lines: ArticleBodyReactionLine[] = b.lines.map((line, lineIndex) => {
    if (typeof line !== "object" || line === null) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]がオブジェクトではありません`);
    }
    const l = line as Record<string, unknown>;
    if (typeof l.text !== "string" || l.text.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]のtextが空です`);
    }
    if (l.emphasis !== undefined && l.emphasis !== "red" && l.emphasis !== "orange") {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]のemphasisが不正です`);
    }
    if (l.original !== undefined && (typeof l.original !== "string" || l.original.trim().length === 0)) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のlines[${lineIndex}]のoriginalが不正です`);
    }
    return {
      text: l.text,
      ...(l.emphasis ? { emphasis: l.emphasis } : {}),
      ...(l.original ? { original: l.original as string } : {}),
    };
  });
  let anchors: number[] | undefined;
  if (b.anchors !== undefined) {
    if (!Array.isArray(b.anchors) || b.anchors.some((n) => typeof n !== "number" || !Number.isInteger(n) || n <= 0)) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のanchorsが不正です`);
    }
    anchors = b.anchors as number[];
  }
  let emphasis: boolean | undefined;
  if (b.emphasis !== undefined) {
    if (typeof b.emphasis !== "boolean") {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のemphasisが不正です`);
    }
    emphasis = b.emphasis;
  }
  let emphasisColor: ArticleBodyEmphasisColor | undefined;
  if (b.emphasisColor !== undefined) {
    if (
      b.emphasisColor !== "red" &&
      b.emphasisColor !== "blue" &&
      b.emphasisColor !== "purple" &&
      b.emphasisColor !== "orange"
    ) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のemphasisColorが不正です`);
    }
    emphasisColor = b.emphasisColor;
  }
  return {
    type: "reaction",
    number: b.number,
    name: b.name,
    lines,
    ...(anchors ? { anchors } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(emphasisColor ? { emphasisColor } : {}),
  };
}

/**
 * 画像ブロックの url として許可するスキームか（純関数）。ローカル配信パス（public配下）・
 * データURI（画像のみ）・将来のhttps画像URLのみ許可し、`javascript:` 等の危険スキームを弾く。
 */
function isSafeImageUrl(url: string): boolean {
  // ローカル配信パス（public配下・`//`や`/\`の外部誘導は除外）は image-url.ts の共通ヘルパで判定。
  // 加えて記事本文画像では データURI（画像のみ）・https画像も許可する。
  if (isSafeLocalAssetPath(url)) return true;
  if (/^data:image\/(png|jpeg|jpg|gif|svg\+xml|webp);/i.test(url)) return true;
  if (/^https:\/\//i.test(url)) return true;
  return false;
}

function parseImageBlock(b: Record<string, unknown>, index: number): ArticleBodyImageBlock {
  if (typeof b.url !== "string" || b.url.trim().length === 0 || !isSafeImageUrl(b.url)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の画像urlが不正です`);
  }
  if (typeof b.alt !== "string" || b.alt.trim().length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の画像altが空です`);
  }
  if (b.credit !== undefined && (typeof b.credit !== "string" || b.credit.trim().length === 0)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の画像creditが不正です`);
  }
  return { type: "image", url: b.url, alt: b.alt, ...(b.credit ? { credit: b.credit as string } : {}) };
}

/**
 * linkButton ブロックの url として許可するスキームか（純関数、拡張E42）。https のみ許可し、
 * `javascript:` `http:` 等の危険/非セキュアスキームは弾く（画像ブロックの isSafeImageUrl と同様の方針）。
 */
function isSafeLinkButtonUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

function parseLinkButtonBlock(b: Record<string, unknown>, index: number): ArticleBodyLinkButtonBlock {
  if (typeof b.url !== "string" || b.url.trim().length === 0 || !isSafeLinkButtonUrl(b.url)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]のlinkButton urlが不正です（https必須）`);
  }
  if (typeof b.label !== "string" || b.label.trim().length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]のlinkButton labelが空です`);
  }
  return { type: "linkButton", url: b.url, label: b.label };
}

/**
 * toc ブロックの検証（成長G3 F-G3-4）。`items` は1件以上・各要素の `label`/`anchor` が非空文字列。
 */
function parseTocBlock(b: Record<string, unknown>, index: number): ArticleBodyTocBlock {
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]のtoc itemsが空です`);
  }
  const items = b.items.map((item, itemIndex) => {
    if (typeof item !== "object" || item === null) {
      throw new InvalidArticleBodyError(
        `本文ブロック[${index}]のtoc items[${itemIndex}]がオブジェクトではありません`,
      );
    }
    const it = item as Record<string, unknown>;
    if (typeof it.label !== "string" || it.label.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のtoc items[${itemIndex}]のlabelが空です`);
    }
    if (typeof it.anchor !== "string" || it.anchor.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]のtoc items[${itemIndex}]のanchorが空です`);
    }
    return { label: it.label, anchor: it.anchor };
  });
  return { type: "toc", items };
}

function parseEmbedBlock(b: Record<string, unknown>, index: number): ArticleBodyEmbedBlock {
  if (!isEmbedProvider(b.provider)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の埋め込みproviderが不正です: ${String(b.provider)}`);
  }
  const provider = b.provider;
  if (typeof b.url !== "string" || b.url.trim().length === 0 || !isAllowedEmbedUrl(provider, b.url)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の埋め込みurlがホワイトリスト外、または不正です`);
  }
  if (b.caption !== undefined && (typeof b.caption !== "string" || b.caption.trim().length === 0)) {
    throw new InvalidArticleBodyError(`本文ブロック[${index}]の埋め込みcaptionが不正です`);
  }
  return { type: "embed", provider, url: b.url, ...(b.caption ? { caption: b.caption as string } : {}) };
}

/**
 * DB から読み出した未知の値（Prisma の Json 型）を検証済みのブロック配列に変換する。
 * 不正な形式（配列でない・空・text 欠落・未知の type 等）は例外を投げる。
 */
export function parseArticleBody(value: unknown): ArticleBodyBlock[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidArticleBodyError(
      "記事本文はブロックの配列（1件以上）である必要があります",
    );
  }

  return value.map((block, index) => {
    if (typeof block !== "object" || block === null) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]がオブジェクトではありません`);
    }
    const b = block as Record<string, unknown>;
    if (b.type === "reaction") {
      return parseReactionBlock(b, index);
    }
    if (b.type === "image") {
      return parseImageBlock(b, index);
    }
    if (b.type === "embed") {
      return parseEmbedBlock(b, index);
    }
    if (b.type === "linkButton") {
      return parseLinkButtonBlock(b, index);
    }
    if (b.type === "toc") {
      return parseTocBlock(b, index);
    }
    if (typeof b.type !== "string" || !TEXT_TYPES.has(b.type)) {
      throw new InvalidArticleBodyError(
        `本文ブロック[${index}]の type が不正です: ${String(b.type)}`,
      );
    }
    if (typeof b.text !== "string" || b.text.trim().length === 0) {
      throw new InvalidArticleBodyError(`本文ブロック[${index}]の text が空です`);
    }
    if (b.type === "quote") {
      return {
        type: "quote",
        text: b.text,
        source: typeof b.source === "string" ? b.source : undefined,
      } satisfies ArticleBodyBlock;
    }
    if (b.type === "heading") {
      let anchor: string | undefined;
      if (b.anchor !== undefined) {
        if (typeof b.anchor !== "string" || b.anchor.trim().length === 0) {
          throw new InvalidArticleBodyError(`本文ブロック[${index}]のheading anchorが不正です`);
        }
        anchor = b.anchor;
      }
      return { type: "heading", text: b.text, ...(anchor ? { anchor } : {}) } satisfies ArticleBodyBlock;
    }
    return { type: b.type, text: b.text } as ArticleBodyBlock;
  });
}

/** 本文ブロック配列に見出しが1つ以上含まれるか（「長文ベタ書き」になっていないかの簡易チェック） */
export function hasStructuredHeadings(blocks: ArticleBodyBlock[]): boolean {
  return blocks.some((b) => b.type === "heading");
}

/**
 * 記事冒頭にヒーロー用のサムネイル画像を表示すべきか（拡張E50 F-E50-2）。
 * 本文の先頭ブロックが image（パッチ記事の公式バナー、拡張E42）の場合は、ヒーローと本文冒頭の
 * 画像が二重表示になるため false（表示しない）を返す。それ以外（反応記事等、image で
 * 始まらない記事、本文が空の記事）は true。
 */
export function shouldShowHeroThumbnail(blocks: ArticleBodyBlock[]): boolean {
  return blocks[0]?.type !== "image";
}

/**
 * 表示用のグルーピング結果（拡張E12）。連続する reaction ブロックを1つの枠にまとめて表示するため、
 * `groupArticleBodyBlocksForDisplay` がブロック配列をこの表現に変換する。それ以外のブロックは
 * 従来どおり1件ずつ描画する（`single`）。
 */
export type ArticleBodyDisplayGroup =
  | { kind: "reaction-group"; blocks: ArticleBodyReactionBlock[]; startIndex: number }
  | { kind: "single"; block: Exclude<ArticleBodyBlock, ArticleBodyReactionBlock>; index: number };

/**
 * 記事本文ブロック配列を表示用にグルーピングする純関数（拡張E12: まとめレスの1枠統合）。
 * 連続する reaction ブロックは1つの `reaction-group` にまとめ、heading 等が間に挟まって
 * 非連続になった reaction は別々のグループにする。reaction 以外のブロックは `single` のまま、
 * 元の配列中のインデックス（広告差し込み位置の判定等に使う）を保持する。
 */
export function groupArticleBodyBlocksForDisplay(blocks: ArticleBodyBlock[]): ArticleBodyDisplayGroup[] {
  const groups: ArticleBodyDisplayGroup[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === "reaction") {
      const last = groups[groups.length - 1];
      if (last && last.kind === "reaction-group") {
        last.blocks.push(block);
        continue;
      }
      groups.push({ kind: "reaction-group", blocks: [block], startIndex: index });
      continue;
    }
    groups.push({ kind: "single", block, index });
  }
  return groups;
}

/**
 * ブロック1件分のテキストを取り出す（検索・文字数計算・安全フィルタの対象抽出で共通利用）。
 * heading/paragraph/quote は `text` を、reaction は「名前＋各レス行（原文併記があれば原文も含む）」を、
 * image は「alt＋credit」を、embed は「caption＋url」を連結して返す
 * （画像alt・埋め込みcaption・原文併記テキストも安全フィルタ・検索の対象に含めるため）。
 */
export function blockText(block: ArticleBodyBlock): string {
  if (block.type === "reaction") {
    return [
      block.name,
      ...block.lines.flatMap((l) => (l.original ? [l.original, l.text] : [l.text])),
    ].join("\n");
  }
  if (block.type === "image") {
    return [block.alt, block.credit].filter((s): s is string => Boolean(s)).join("\n");
  }
  if (block.type === "embed") {
    return [block.caption, block.url].filter((s): s is string => Boolean(s)).join("\n");
  }
  if (block.type === "linkButton") {
    return [block.label, block.url].join("\n");
  }
  if (block.type === "toc") {
    return block.items.map((i) => i.label).join("\n");
  }
  return block.text;
}
