/**
 * SNSシェア用URL組み立ての純関数群（拡張E1）。各サービスの共有インテントURLに
 * 記事URL・タイトルを安全にエンコードして埋め込むだけで、外部通信は行わない。
 */

export type ShareTarget = "x" | "line" | "hatena";

/**
 * 対象サービス・記事URL・記事タイトルから共有用URLを組み立てる。
 * `url`/`title` は必ず `encodeURIComponent` を通し、URLとして安全な形にする。
 */
export function buildShareUrl(target: ShareTarget, url: string, title: string): string {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);

  switch (target) {
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`;
    case "line":
      return `https://social-plugins.line.me/lineit/share?url=${encodedUrl}`;
    case "hatena":
      return `https://b.hatena.ne.jp/entry/panel/?url=${encodedUrl}&title=${encodedTitle}`;
    default: {
      const exhaustiveCheck: never = target;
      throw new Error(`未知のシェア対象です: ${String(exhaustiveCheck)}`);
    }
  }
}
