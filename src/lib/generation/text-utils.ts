/**
 * 文分割・抜粋生成の純関数群（LLM非依存）。compose.ts / llm-client.ts の
 * モック実装から共有で使う。逐語コピー回避（F7）の土台になる部分なので、
 * 「原文を長く連続でそのまま使わない」ことをここで担保する。
 */

/** 日本語(。！？)・英語(.!?)の文区切りで分割する。区切りが無ければ全体を1文として返す。 */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？.!?])\s*/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [trimmed];
}

/**
 * 元文からLLMプロンプト用の短い手がかり(gist)を切り出す。
 * 逐語コピーを避けるため、既定で10文字までという十分短い長さに保つ。
 */
export function gistOf(sentence: string, maxLen = 10): string {
  const trimmed = sentence.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}

/**
 * 引用ブロック用の抜粋を作る。「自サイト生成文が主・引用が従」の主従関係を保つため、
 * 原文1文の半分（最大30文字）までに絞る。
 */
export function excerptForQuote(sentence: string): string {
  const trimmed = sentence.trim();
  const cap = Math.min(30, Math.max(1, Math.ceil(trimmed.length * 0.5)));
  return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}
