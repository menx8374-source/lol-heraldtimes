/**
 * pm2 プロセス定義（本番・VPS）。`pm2 start deploy/ecosystem.config.cjs` で起動する。
 * アプリは `next start` を 127.0.0.1:3000 で待ち受け、外部公開は nginx リバースプロキシ経由にする
 * （deploy/nginx.conf.example 参照）。DEPLOY.md の手順に対応。
 */
module.exports = {
  apps: [
    {
      name: "lol-matome",
      cwd: "/var/www/lol-matome",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        // 外部に直接晒さず nginx 経由にするため localhost で待ち受ける。
        HOSTNAME: "127.0.0.1",
        PORT: "3000",
      },
      // メモリリーク保険（小規模VPS向け）。必要に応じて調整。
      max_memory_restart: "500M",
      autorestart: true,
    },
  ],
};
