import { Fragment } from "react";
import type { ArticleBodyBlock, ArticleBodyReactionBlock } from "@/lib/article-body";
import { AdSlot } from "@/components/ad-slot";

/** 強調(赤/オレンジ)を持つレス本文行のテキストカラー。未指定は通常色。 */
const LINE_EMPHASIS_CLASS: Record<"red" | "orange", string> = {
  red: "font-bold text-red-600",
  orange: "font-bold text-orange-600",
};

/** まとめ速報のレス1件（reactionブロック）を描画する（F: 記事フォーマット改修）。
 * 「番号: 名前」(名前は緑)＋本文行(逐語・複数行)＋重要行の赤/オレンジ強調＋">>N"アンカー。 */
function ReactionResView({ block }: { block: ArticleBodyReactionBlock }) {
  return (
    <div className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm sm:text-base dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-1 font-bold">
        <span className="text-neutral-700 dark:text-neutral-300">{block.number}: </span>
        <span className="text-green-700 dark:text-green-400">{block.name}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {block.lines.map((line, i) => (
          <p
            key={i}
            className={line.emphasis ? LINE_EMPHASIS_CLASS[line.emphasis] : "text-neutral-800 dark:text-neutral-200"}
          >
            {line.text}
          </p>
        ))}
      </div>
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

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
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
        if (block.type === "reaction") {
          return <ReactionResView key={index} block={block} />;
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
