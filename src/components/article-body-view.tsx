import { Fragment } from "react";
import {
  groupArticleBodyBlocksForDisplay,
  type ArticleBodyBlock,
  type ArticleBodyReactionBlock,
} from "@/lib/article-body";
import { AdSlot } from "@/components/ad-slot";
import { isAsciiArtLine } from "@/lib/aa";
import { isAllowedEmbedUrl, embedIframeSrc, EMBED_PROVIDER_LABELS, type EmbedProvider } from "@/lib/embed";
import { getSiteUrl } from "@/lib/site";

/** 強調(赤/オレンジ)を持つレス本文行のテキストカラー。未指定は通常色。 */
const LINE_EMPHASIS_CLASS: Record<"red" | "orange", string> = {
  red: "font-bold text-red-600",
  orange: "font-bold text-orange-600",
};

/** レス単位の強調色（拡張E32、おばにゅー流、拡張E36で緑を廃止し紫を追加）のテキストカラー。
 * 名前見出し（ResHeader）の緑と被らないよう、ここでは緑を使わない。ダーク/ライト両対応。 */
const RES_EMPHASIS_COLOR_CLASS: Record<"red" | "blue" | "purple" | "orange", string> = {
  red: "text-red-600 dark:text-red-400",
  blue: "text-blue-600 dark:text-blue-400",
  purple: "text-purple-600 dark:text-purple-400",
  orange: "text-orange-600 dark:text-orange-400",
};

/** レスの「番号: 名前」見出し行（名前は緑）。まとめ本文の reaction ブロック描画でのみ使う
 * （拡張E12でコメント欄は専用ヘッダーに差別化したため、このファイル内ローカル関数に降格）。 */
function ResHeader({ number, name }: { number: number; name: string }) {
  return (
    <div className="mb-1 font-bold">
      <span className="text-neutral-700 dark:text-neutral-300">{number}: </span>
      <span className="text-green-700 dark:text-green-400">{name}</span>
    </div>
  );
}

/**
 * レス本文の複数行。重要行は赤、">>N"アンカー行はオレンジで強調する。記事本文・コメント欄で共用する。
 * AA（アスキーアート）らしい行（拡張E3・`isAsciiArtLine`で判定）は等幅フォント＋空白保持で
 * 崩れないように表示する。単純な顔文字（"(^^)/" 等）はAAと判定されず通常テキストのまま表示される。
 * `original`（拡張E3・海外の反応の原文併記）がある行は、日本語訳の前に「原文: ...（英語）」を表示する。
 * `emphasisColor`（拡張E32、拡張E36で緑を廃止し紫を追加）が指定されているレスのみ、行単位の
 * emphasis(red/orange)が無い行を「大きく＋太字＋色（赤/青/紫/オレンジ）」で目立たせる
 * （拡張E36 F-E36-2: 色付き強調と黒字を区別するため、黒字（無色、emphasisColor無し）は常に
 * 通常サイズ・非太字にする。レス単位の`emphasis`フラグ自体は`data-res-emphasis`属性の付与にのみ
 * 使い、色が無ければ見た目には影響しない）。行単位のemphasis(red/orange)がある行はそちらの色を
 * 優先する（役割が違うため上書きしない）。
 */
export function ResLines({
  lines,
  emphasisColor,
}: {
  lines: { text: string; emphasis?: "red" | "orange"; original?: string }[];
  emphasisColor?: "red" | "blue" | "purple" | "orange";
}) {
  // 「大きく＋太字」は色付き強調（emphasisColor有り）のときだけ（拡張E36 F-E36-2）。
  // emphasisのみ（色無し）は黒字・通常サイズ・非太字に統一する。
  const sizeClass = emphasisColor ? " text-base sm:text-lg font-bold" : "";
  const baseColorClass = emphasisColor
    ? RES_EMPHASIS_COLOR_CLASS[emphasisColor]
    : "text-neutral-800 dark:text-neutral-200";
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => {
        const aaClass = isAsciiArtLine(line.text) ? " whitespace-pre-wrap font-mono text-xs sm:text-sm" : "";
        return (
          <div key={i}>
            {line.original && (
              <p className="text-xs italic text-neutral-500 dark:text-neutral-400">
                原文: {line.original}（英語）
              </p>
            )}
            <p
              className={(line.emphasis ? LINE_EMPHASIS_CLASS[line.emphasis] : baseColorClass) + sizeClass + aaClass}
            >
              {line.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** 記事内画像ブロック（拡張E3）。遅延読み込み・レスポンシブ表示＋出典クレジットのキャプション。
 * url はローカルSVG/データURI等のモック画像のみを想定（parseArticleBodyで検証済み）。 */
function ImageBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "image" }> }) {
  return (
    <figure className="my-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- ローカルSVG/データURIのモック画像のみ（parseArticleBodyで検証済み） */}
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        className="block max-w-full rounded border border-neutral-200 dark:border-neutral-700"
        style={{ maxWidth: "100%", height: "auto" }}
      />
      {block.credit && (
        <figcaption className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{block.credit}</figcaption>
      )}
    </figure>
  );
}

/** 大きく目立つボタン風の外部リンクブロック（拡張E42）。パッチ記事の公式パッチノートリンク等に使う。
 * ラベルのみを表示しURL文字列は出さない（すっきりした見た目にする）。ダーク/ライト両対応、
 * ホバーで少し暗くなる程度。外部リンクのため target="_blank" + rel="noopener noreferrer"。 */
function LinkButtonBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "linkButton" }> }) {
  return (
    <div className="my-1 flex justify-center">
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-lg bg-sky-700 px-8 py-3 text-center text-base font-bold text-white shadow transition-colors hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-500"
      >
        {block.label}
      </a>
    </div>
  );
}

const EMBED_PROVIDER_ICON: Record<EmbedProvider, string> = { twitter: "X", youtube: "▶", clip: "🎬" };

/**
 * SNS/動画の埋め込みブロック（拡張E3、拡張E22で実再生対応）。
 * provider が youtube/clip のときは、embed.ts の厳格なID/slug抽出関数で組み立てた src
 * （youtube-nocookie.com / clips.twitch.tv の許可ドメインのみ）で実際に再生可能なiframeを描画する。
 * 生URLをそのままsrcに使うことはなく、抽出に失敗した場合（不正なID等）は従来の
 * プレースホルダーカードにフォールバックする。twitter は実iframe対象外のため常にカード表示のまま
 * （著作権・CSP・SSRF回避のため。dangerouslySetInnerHTMLは使わない）。
 * parseArticleBody時点でホワイトリスト検証済みだが、表示前にも再検証し不正値は描画しない（二重防御）。
 */
function EmbedBlockView({ block }: { block: Extract<ArticleBodyBlock, { type: "embed" }> }) {
  if (!isAllowedEmbedUrl(block.provider, block.url)) return null;

  // iframe化可能なproviderの列挙は embedIframeSrc（twitter等は null を返す）に一元化し、
  // ここでは戻り値の有無だけで実iframeとカードを分岐する（真実源を1箇所に保つ）。
  const src = embedIframeSrc(block.provider, block.url, new URL(getSiteUrl()).hostname);
  if (src) {
    return (
      <div className="flex flex-col gap-1">
        <div className="aspect-video w-full overflow-hidden rounded border border-neutral-300 dark:border-neutral-700">
          <iframe
            src={src}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            title={EMBED_PROVIDER_LABELS[block.provider]}
            className="h-full w-full border-0"
          />
        </div>
        {block.caption && <p className="text-sm text-neutral-600 dark:text-neutral-400">{block.caption}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-dashed border-neutral-400 bg-neutral-50 p-3 text-sm dark:border-neutral-600 dark:bg-neutral-900">
      <div className="flex items-center gap-2 font-bold text-neutral-700 dark:text-neutral-300">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded bg-neutral-300 text-[10px] dark:bg-neutral-700"
        >
          {EMBED_PROVIDER_ICON[block.provider]}
        </span>
        <span>{EMBED_PROVIDER_LABELS[block.provider]}</span>
      </div>
      {block.caption && <p className="text-neutral-600 dark:text-neutral-400">{block.caption}</p>}
      <a
        href={block.url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sky-700 underline dark:text-sky-400"
      >
        {block.url}
      </a>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">
        ※埋め込みは本番接続時に表示されます（現在はリンクのみのプレースホルダー表示です）
      </p>
    </div>
  );
}

/** 連続するまとめ速報レス（reactionブロック）群を1つの枠にまとめて描画する（拡張E12）。
 * 各レスは枠内で縦に連続し、レス間は薄い区切り線（divide-y）で仕切る（レスごとの独立ボックスにしない）。
 * 各レスの中身（番号:名前緑＋本文行＋赤/オレンジ強調＋">>N"アンカー）は従来どおり。 */
function ReactionGroupView({ blocks }: { blocks: ArticleBodyReactionBlock[] }) {
  return (
    <div
      data-reaction-group
      className="flex flex-col divide-y divide-neutral-200 rounded border border-neutral-300 bg-white text-sm sm:text-base dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900"
    >
      {blocks.map((block, i) => (
        <div
          key={i}
          className="px-3 py-2"
          {...(block.emphasis ? { "data-res-emphasis": true } : {})}
          {...(block.emphasisColor ? { "data-res-emphasis-color": block.emphasisColor } : {})}
        >
          <ResHeader number={block.number} name={block.name} />
          <ResLines lines={block.lines} emphasisColor={block.emphasisColor} />
        </div>
      ))}
    </div>
  );
}

/** 本文ブロック配列中、見出しブロックが何番目(blocksのindex)にあるかを列挙する純関数。 */
function headingBlockIndices(blocks: ArticleBodyBlock[]): number[] {
  return blocks.flatMap((block, index) => (block.type === "heading" ? [index] : []));
}

export function ArticleBodyView({ blocks }: { blocks: ArticleBodyBlock[] }) {
  // 本文中(見出し間)の広告枠（F12）は中央の見出しの直前に差し込む。見出し数に依存せず
  // 「記事の真ん中あたり」に収まるよう、見出し数の中央インデックスを使う（3見出しなら2番目＝従来と同じ）。
  const headings = headingBlockIndices(blocks);
  const adBeforeBlockIndex = headings.length > 0 ? headings[Math.floor(headings.length / 2)] : -1;
  // 連続する reaction ブロックを1枠にまとめる（拡張E12）。それ以外のブロックは従来どおり1件ずつ描画する。
  const groups = groupArticleBodyBlocksForDisplay(blocks);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        if (group.kind === "reaction-group") {
          return <ReactionGroupView key={`reaction-group-${group.startIndex}`} blocks={group.blocks} />;
        }
        const { block, index } = group;
        if (block.type === "heading") {
          return (
            <Fragment key={index}>
              {index === adBeforeBlockIndex && <AdSlot position="article-in-body" />}
              <h2 className="mt-2 text-base font-bold sm:text-lg">{block.text}</h2>
            </Fragment>
          );
        }
        if (block.type === "quote") {
          // 引用（掲示板/SNSの原文要約）は自サイト生成文（見出し・段落）と視覚的に区別する（F15）:
          // 枠線・背景色・斜体に加え、「引用」ラベルと出典元表記を明示する。
          return (
            <blockquote
              key={index}
              data-article-quote
              className="border-l-4 border-neutral-400 bg-neutral-50 py-2 pl-3 text-sm italic text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            >
              <span className="mb-1 inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold not-italic text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300">
                引用
              </span>
              <p>{block.text}</p>
              {block.source && (
                <footer className="mt-1 text-xs not-italic text-neutral-500 dark:text-neutral-400">
                  — {block.source}
                </footer>
              )}
            </blockquote>
          );
        }
        if (block.type === "image") {
          return <ImageBlockView key={index} block={block} />;
        }
        if (block.type === "embed") {
          return <EmbedBlockView key={index} block={block} />;
        }
        if (block.type === "linkButton") {
          return <LinkButtonBlockView key={index} block={block} />;
        }
        return (
          <p key={index} className="text-sm leading-relaxed sm:text-base">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
