import type { NextConfig } from "next";

/**
 * 記事内埋め込み（拡張E22、X-embedでtwitterを追加）の実iframe許可ドメインのみを指定した frame-src CSP。
 * 逐語転載した投稿本文に不正なURLが紛れても、許可ドメイン以外はiframe化されないようにする
 * 多層防御（`src/lib/embed.ts` のURL許可検証と合わせた二重防御）。`https://platform.twitter.com` は
 * Twitter公式のサンドボックス化ツイート埋め込み（widgets.js等の外部スクリプトは読み込まない）専用。
 * script-src は指定しない（widgets.jsを読み込まないため広げる必要がない）。
 */
const FRAME_SRC_CSP =
  "frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv https://platform.twitter.com";

/**
 * img-src CSP（X-embed で新規追加）。記事本文の画像ブロックは `isSafeImageUrl`（article-body.ts）で
 * 「ローカルパス／データURI／任意のhttps」を既に許可しており、収集元（Data Dragon・Reddit等）ごとの
 * 画像ホストを個別に列挙していない。ここで img-src を新設するにあたり、既存の任意httpsホスト（例:
 * ddragon.leagueoflegends.com 等）を回帰させないよう `https:` を維持しつつ、Twitter公式CDN
 * （pbs.twimg.com / abs.twimg.com、ツイート埋め込み内の画像用）を明記する。
 */
const IMG_SRC_CSP = "img-src 'self' data: https: https://pbs.twimg.com https://abs.twimg.com";

const nextConfig: NextConfig = {
  /* config options here */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `${FRAME_SRC_CSP}; ${IMG_SRC_CSP}` },
        ],
      },
    ];
  },
};

export default nextConfig;
