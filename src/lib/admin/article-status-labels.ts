/**
 * 記事状態(status)の日本語表示ラベル。管理ダッシュボード(page.tsx)と構造化エディタ
 * (ArticleEditor.tsx)の双方で使うため共有する（サーバー専用importを持たないクライアント安全な
 * モジュールに置き、状態の追加・改名時に1箇所だけ直せばよいようにする）。
 */
export const ARTICLE_STATUS_LABELS: Record<string, string> = {
  published: "公開中",
  held: "保留中",
  rejected: "却下済み",
  scheduled: "予約公開待ち",
  review: "要レビュー",
};
