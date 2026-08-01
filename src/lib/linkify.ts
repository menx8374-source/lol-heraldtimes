/**
 * レス本文中のURLを安全に自動リンク化するための純関数（reactqual-S2 F-RQ2-1、バグ4修正）。
 *
 * 検出は `https?://` プレフィックス必須の正規表現のみを用いる（compose.ts の `URL_IN_TEXT_RE` と
 * 同方針）。これにより `javascript:`/`data:`/`vbscript:` 等の危険スキームは原理的にhrefへ
 * 混入しない（http/https以外はそもそもマッチしないため）。
 *
 * URL末尾に紛れ込みがちな半角/全角の句読点・閉じ括弧類はURLに含めず、後続のテキストセグメントへ
 * 回す（例: "https://x.com/a。続き" → link.href="https://x.com/a", 後続text="。続き"）。
 *
 * 戻り値はテキストとリンクの交互セグメント配列。全セグメントの value を順に連結すると元の text に
 * 完全一致する（逐語不変・文字改変なし・分割するだけ）。URLを含まない場合は
 * `[{ type: "text", value: text }]` の1件を返す。
 */
export type LinkifySegment = { type: "text" | "link"; value: string; href?: string };

/** URL検出（http/https必須）。末尾の句読点・閉じ括弧類はURLに含めない（compose.tsのURL_IN_TEXT_REと同方針）。 */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'）】「」『』、。！？]+/g;

/** 文末に紛れ込みがちな半角句読点を取り除く（compose.ts の stripTrailingPunctuation と同方針）。 */
function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,!?;:]+$/, "");
}

export function linkifyText(text: string): LinkifySegment[] {
  const segments: LinkifySegment[] = [];
  let lastIndex = 0;
  URL_IN_TEXT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_IN_TEXT_RE.exec(text)) !== null) {
    const rawUrl = match[0];
    const url = stripTrailingPunctuation(rawUrl);
    const matchStart = match.index;
    // stripTrailingPunctuationで取り除いた末尾の句読点分は、次のテキストセグメントに自然に
    // 含まれる（lastIndexをurlの終端に留め、正規表現側のlastIndex=rawUrlの終端とは独立させるため）。
    const urlEnd = matchStart + url.length;
    if (matchStart > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchStart) });
    }
    segments.push({ type: "link", value: url, href: url });
    lastIndex = urlEnd;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
