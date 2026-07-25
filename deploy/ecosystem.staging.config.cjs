/**
 * pm2 プロセス定義（ステージング＝予行テスト用・本番と同一VPS内で分離運用）。
 * 本番(deploy/ecosystem.config.cjs)とは別ディレクトリ・別DB・別ポート(3001)で動かし、
 * 本番に適用する前の動作確認に使う（DEPLOY.md「予行テスト（ステージング）環境」参照）。
 */
module.exports = {
  apps: [
    {
      name: "lol-matome-staging",
      cwd: "/var/www/lol-matome-staging",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        // 本番(3000)と別ポート。nginxのstaging用server_blockからここへプロキシする。
        PORT: "3001",
      },
      max_memory_restart: "500M",
      autorestart: true,
    },
  ],
};
