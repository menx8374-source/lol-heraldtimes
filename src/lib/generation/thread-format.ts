/**
 * 掲示板/SNSスレッドのレス群テキスト（収集した content の生テキスト）を、
 * まとめ速報のレス配列にパースする純関数群（LLM 非依存・決定論）。
 *
 * 想定フォーマット（fixture／将来の live 収集アダプタ双方が出力する共通の「スレッドダンプ」表記）:
 *   "1: 本文1行目\n本文2行目\n\n2: >>1\n本文...\n\n3: ...\n"
 * - 行頭が `<数字>: ` で始まる行が新しいレスの開始。
 * - 空行はレスの区切り（無くても次の "N: " 行が来れば区切れる）。
 * - `>>N` はレス番号 N への返信アンカー。
 * この形式に一致しない content（fixtureが未更新の単発文など）は、全体を1件のレス（番号1）として
 * フォールバックする（後方互換）。
 */

export type ThreadRes = { number: number; lines: string[] };

const RES_START = /^(\d+)\s*:\s*(.*)$/;

/** レス本文中の重要・面白い行を判定するキーワード（1レスあたり最大1行を赤で強調する）。 */
const EMPHASIS_KEYWORDS = [
  "ワロタ",
  "www",
  "笑",
  "草",
  "神",
  "衝撃",
  "悲報",
  "涙目",
  "驚愕",
  "炎上",
  "阿鼻叫喚",
  "マジ",
  "ヤバ",
  "やば",
];

/** スレッドダンプ形式のテキストをレス配列にパースする。形式に一致しなければ全体を1件のレスとして返す。 */
export function parseThreadReses(rawContent: string): ThreadRes[] {
  const rawLines = rawContent.split(/\r?\n/);
  const reses: ThreadRes[] = [];
  let current: ThreadRes | null = null;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    const startMatch = line.match(RES_START);
    if (startMatch) {
      if (current && current.lines.length > 0) reses.push(current);
      current = { number: Number(startMatch[1]), lines: startMatch[2] ? [startMatch[2]] : [] };
      continue;
    }
    if (!line) continue; // 空行はレスの区切り
    if (current) current.lines.push(line);
  }
  if (current && current.lines.length > 0) reses.push(current);

  if (reses.length > 0) return reses;

  // フォールバック: "N: " 形式に一致しない content は全体を1件のレスとして扱う（分割済みの rawLines を再利用）。
  const fallbackLines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  return fallbackLines.length > 0 ? [{ number: 1, lines: fallbackLines }] : [];
}

/**
 * タイトル生成の入力用に、スレッドダンプからレス番号プレフィックス（`N: `）とアンカーだけの行（`>>N`）を
 * 取り除いたレス本文テキストを連結して返す。これを使わず生の content を渡すと、タイトルに「1: 」等の
 * レス番号が混入する。riot 等の非スレッド content でもフォールバックで本文そのままを返すため無害。
 */
export function threadBodyText(rawContent: string): string {
  return parseThreadReses(rawContent)
    .flatMap((res) => res.lines)
    .filter((line) => !/^>>\d+$/.test(line.trim()))
    .join(" ");
}

/** レス本文行から `>>N` 形式のアンカー番号を抽出する（出現順・重複排除）。 */
export function extractAnchors(lines: string[]): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    for (const m of line.matchAll(/>>(\d+)/g)) {
      const n = Number(m[1]);
      if (!seen.has(n)) {
        seen.add(n);
        found.push(n);
      }
    }
  }
  return found;
}

/**
 * レス本文の各行に強調(赤/オレンジ)を割り当てる。
 * 赤: EMPHASIS_KEYWORDS に一致する最初の1行のみ（1レス0〜1行）。
 * オレンジ: `>>N` アンカーを含む行（赤指定済みの行は除く）。
 */
export function computeLineEmphasis(lines: string[]): (("red" | "orange") | undefined)[] {
  const result: (("red" | "orange") | undefined)[] = lines.map(() => undefined);
  const redIndex = lines.findIndex((l) => EMPHASIS_KEYWORDS.some((k) => l.includes(k)));
  if (redIndex >= 0) result[redIndex] = "red";
  lines.forEach((l, i) => {
    if (result[i]) return;
    if (/>>\d+/.test(l)) result[i] = "orange";
  });
  return result;
}
