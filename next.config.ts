import type { NextConfig } from "next";

/**
 * 記事内埋め込み（拡張E22）の実iframe許可ドメインのみを指定した frame-src CSP。
 * 逐語転載した投稿本文に不正なURLが紛れても、許可ドメイン以外はiframe化されないようにする
 * 多層防御（`src/lib/embed.ts` のURL許可検証と合わせた二重防御）。frame-src のみを指定し、
 * 既存挙動に影響する他ディレクティブ（default-src等）は指定しない。
 */
const FRAME_SRC_CSP =
  "frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://clips.twitch.tv";

const nextConfig: NextConfig = {
  /* config options here */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: FRAME_SRC_CSP }],
      },
    ];
  },
};

export default nextConfig;
