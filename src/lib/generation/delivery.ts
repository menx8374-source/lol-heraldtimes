/**
 * 配信導線 — Discord Webhook通知（成長G6 F-G6-3、opt-in・失敗は握りつぶす）。
 * env `DISCORD_WEBHOOK_URL` が設定されているときのみ、公開された記事のタイトル＋URL(＋カテゴリ)を
 * Discord Webhookへ `fetch` でPOSTする。未設定なら完全no-op（fetch自体を呼ばない）。
 *
 * 「補助処理は本体を絶対に止めない」原則: 送信失敗・タイムアウト・非2xxはすべてtry/catchで
 * 握りつぶし、ログ1行だけ残す。リトライはしない（最大1回・短いタイムアウト）。
 * 通知対象は呼び出し側が「このパイプライン実行で新規に公開された記事」だけを渡すことで、
 * 二重通知を避ける（実行単位の新規公開のみを対象にすれば十分、永続的な通知済みフラグは持たない）。
 */
import { articleUrl } from "@/lib/site";

/** 送信失敗を早めに諦めるための短いタイムアウト（リトライ地獄にしないため最大1回のみ送信）。 */
const FETCH_TIMEOUT_MS = 5000;

export type DeliveryArticle = {
  title: string;
  slug: string;
  /** 任意。指定時はメッセージ本文の見出しに含める。 */
  category?: string | null;
};

/** env `DISCORD_WEBHOOK_URL` を読む。未設定・空文字はnull（=no-op）。 */
function getWebhookUrl(): string | null {
  const raw = process.env.DISCORD_WEBHOOK_URL?.trim();
  return raw ? raw : null;
}

function buildContent(article: DeliveryArticle): string {
  const url = articleUrl(article.slug);
  return article.category ? `【${article.category}】${article.title}\n${url}` : `${article.title}\n${url}`;
}

/** 1件分のDiscord Webhook POST。失敗は例外を投げず、呼び出し元へは何も伝播させない。 */
async function postToDiscord(webhookUrl: string, article: DeliveryArticle): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // allowed_mentions.parse:[] でメンション(@everyone等)の暴発を防ぐ（本文はユーザー入力由来の記事タイトルを含むため）。
      body: JSON.stringify({ content: buildContent(article), allowed_mentions: { parse: [] } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Discord通知が失敗しました（status=${res.status}, slug=${article.slug}）`);
    }
  } catch (err) {
    console.error(
      `Discord通知の送信に失敗しました（slug=${article.slug}）:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 新規公開記事群をDiscordへ通知する。`DISCORD_WEBHOOK_URL` 未設定時は何もしない(fetchを一切呼ばない)。
 * 1件の送信失敗が他記事への通知を止めることはない。呼び出し元（パイプライン本体）は
 * この関数の失敗によって一切影響を受けない（内部で全ての例外を握りつぶすため）。
 */
export async function notifyPublishedArticles(articles: DeliveryArticle[]): Promise<void> {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl || articles.length === 0) return;

  for (const article of articles) {
    await postToDiscord(webhookUrl, article);
  }
}
