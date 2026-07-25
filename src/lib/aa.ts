/**
 * AA（アスキーアート）行の検出（拡張E3）。レス本文・コメント本文の1行がAAらしいかを
 * 決定論ヒューリスティックで判定する純関数。単純な顔文字（"(^^)/" 等）は誤検出せず、
 * 通常のプロポーショナルフォントのまま崩れず表示できる（等幅化はAAと判定した行のみに限定する）。
 */

/** AA描画に頻出する記号（顔・体のパーツ描画で使われやすいもの）。この一覧に基づく判定のため、
 * 単純な顔文字（丸括弧＋^や・等の少数記号のみ）は該当せず誤検出しない。 */
const AA_INDICATOR_CHARS = [
  "∧",
  "∀",
  "⌒",
  "∩",
  "⊃",
  "⊂",
  "╯",
  "┻",
  "━",
  "─",
  "│",
  "┌",
  "┐",
  "└",
  "┘",
  "ﾟ",
  "∵",
  "∴",
];

function countIndicatorChars(text: string): number {
  let count = 0;
  for (const ch of AA_INDICATOR_CHARS) {
    if (text.includes(ch)) count++;
  }
  return count;
}

/** 連続する半角/全角スペース(2文字以上)を含むか（AAの位置合わせに使われやすい）。 */
function hasAlignmentSpacing(text: string): boolean {
  return /[ 　]{2,}/.test(text);
}

/** 同一の記号（英数字・日本語の一般的な句読点を除く。アンダースコアや罫線記号は対象に含む）が
 * 3回以上連続するか（罫線・枠の表現に使われやすい）。 */
function hasRepeatedSymbolRun(text: string): boolean {
  return /([^a-zA-Z0-9\s、。！？ぁ-んァ-ヶ一-龠ー])\1{2,}/u.test(text);
}

/**
 * 行がAA（アスキーアート）らしいかを判定する。以下のいずれかを満たせば true:
 * - AA用記号を2種類以上含む
 * - AA用記号を1種類以上含み、かつ位置合わせの連続スペースがある
 * - 同一記号の3連続以上（罫線・枠）がある
 * - "|" のような縦棒記号と、連続スペースによる位置合わせを併せ持つ（簡易な箱型AA）
 */
export function isAsciiArtLine(text: string): boolean {
  const indicatorCount = countIndicatorChars(text);
  if (indicatorCount >= 2) return true;
  if (indicatorCount >= 1 && hasAlignmentSpacing(text)) return true;
  if (hasRepeatedSymbolRun(text)) return true;
  if (text.includes("|") && hasAlignmentSpacing(text)) return true;
  return false;
}
