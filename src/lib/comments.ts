/**
 * 記事への匿名コメント（拡張E2）の純関数群（DB非依存）。ここに置くのはクライアント
 * コンポーネント（コメント投稿フォーム・表示）からも安全にimportできる部分のみで、
 * Prisma を使う永続化ロジックは lib/comments-db.ts（サーバー専用）に分離する
 * （クライアントバンドルに Prisma を巻き込まないため）。
 */
import { findNgWord } from "@/lib/moderation/ng-words";
import { detectPersonalAttack } from "@/lib/moderation/personal-attack";
import { extractAnchors } from "@/lib/generation/thread-format";
import { isValidToggleOp, type ToggleOp } from "@/lib/toggle-selection";

export const COMMENT_BODY_MAX_LENGTH = 1000;
export const COMMENT_NAME_MAX_LENGTH = 30;
export const DEFAULT_COMMENT_NAME = "名無しさん";
/** 直前と同一本文の連投をスパムとみなす時間窓（簡易スパム対策）。 */
export const COMMENT_SPAM_WINDOW_MS = 10_000;

export type CommentValidationError = "empty_body" | "body_too_long" | "name_too_long";

export type ValidatedCommentInput = { name: string; body: string };

/**
 * コメント投稿の入力検証（純関数）。本文は必須・最大長以内。名前は任意（未入力は既定名）で
 * 入力された場合のみ最大長を検査する。
 */
export function validateCommentInput(input: {
  name?: string;
  body: string;
}): { ok: true; value: ValidatedCommentInput } | { ok: false; error: CommentValidationError } {
  const body = input.body.trim();
  if (body.length === 0) {
    return { ok: false, error: "empty_body" };
  }
  if (body.length > COMMENT_BODY_MAX_LENGTH) {
    return { ok: false, error: "body_too_long" };
  }

  const rawName = (input.name ?? "").trim();
  if (rawName.length > COMMENT_NAME_MAX_LENGTH) {
    return { ok: false, error: "name_too_long" };
  }

  return { ok: true, value: { name: rawName.length > 0 ? rawName : DEFAULT_COMMENT_NAME, body } };
}

/** 検証エラーコードをユーザー向けの穏当な日本語メッセージに変換する。 */
export function commentValidationMessage(error: CommentValidationError): string {
  switch (error) {
    case "empty_body":
      return "コメント本文を入力してください。";
    case "body_too_long":
      return `コメント本文は${COMMENT_BODY_MAX_LENGTH}文字以内で入力してください。`;
    case "name_too_long":
      return `名前は${COMMENT_NAME_MAX_LENGTH}文字以内で入力してください。`;
  }
}

export type CommentVoteType = "good" | "bad";

/** 値が投票種別("good"/"bad")のいずれかであるかを判定する型ガード（拡張E8）。 */
export function isValidCommentVoteType(value: string): value is CommentVoteType {
  return value === "good" || value === "bad";
}

/** コメント投票APIの操作種別（拡張E13: 加算/減算）。共通の ToggleOp を単一ソースとして用いる。 */
export type CommentVoteOp = ToggleOp;

/** 値がコメント投票操作種別("add"/"remove")のいずれかであるかを判定する型ガード（ToggleOp 共用）。 */
export const isValidCommentVoteOp = isValidToggleOp;

export type CommentModerationResult =
  | { status: "published" }
  | { status: "held"; reason: "ng_word" | "personal_attack" };

/**
 * コメントの安全判定（F9の安全フィルタを再利用）。名前＋本文を対象にNGワード・個人中傷/晒しを
 * 検出する。記事の安全フィルタ（moderateArticleContent）と異なり、コメントには
 * 出典・重複チェックの概念が無いためこの2種のみを適用する。
 */
export function moderateCommentContent(name: string, body: string): CommentModerationResult {
  const combined = `${name}\n${body}`;
  if (findNgWord(combined)) {
    return { status: "held", reason: "ng_word" };
  }
  if (detectPersonalAttack(combined).detected) {
    return { status: "held", reason: "personal_attack" };
  }
  return { status: "published" };
}

/** 本文から ">>N" 形式のアンカー参照先番号を抽出する（既存のレス本文解析ロジックを再利用）。 */
export function extractCommentAnchors(body: string): number[] {
  return extractAnchors(body.split(/\r?\n/));
}

export type CommentLine = { text: string; emphasis?: "orange" };

/**
 * コメント本文（改行区切りの生テキスト）を、まとめ速報のレス表示（ResLines）に渡す行配列に
 * 変換する（純関数）。">>N" を含む行はアンカー参照としてオレンジ強調する（表示のみの用途で、
 * anchors 列の値とは独立に本文から都度算出する）。空行は除去する。
 */
export function commentBodyToLines(body: string): CommentLine[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => (/>>\d+/.test(text) ? { text, emphasis: "orange" as const } : { text }));
}

/** ハニーポット隠しフィールドが埋まっているか（bot投稿の簡易検出）。 */
export function isHoneypotFilled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 直前のコメントと本文が完全一致し、かつ短時間内の投稿であれば連投スパムとみなす（純関数）。
 * ログイン無し方針のため、ユーザー単位ではなく「同一記事への直近投稿」を対象にした簡易対策。
 */
export function isRapidDuplicate(
  body: string,
  last: { body: string; createdAt: Date } | null,
  now: Date,
  windowMs: number = COMMENT_SPAM_WINDOW_MS,
): boolean {
  if (!last) return false;
  if (last.body.trim() !== body.trim()) return false;
  return now.getTime() - last.createdAt.getTime() < windowMs;
}

/** コメント1件（返信含む）が共通で持つ表示用フィールド（拡張E8: 賛否件数を含む）。 */
export type CommentBase = {
  number: number;
  name: string;
  body: string;
  createdAt: Date;
  anchors: number[];
  goodCount: number;
  badCount: number;
};

/** 返信（拡張E8）。1階層スレッドのため、返信自身はさらなる返信を持たない。 */
export type CommentReplyView = CommentBase;

/** トップレベルコメント。公開済みの返信を発生順（number昇順）に持つ（拡張E8）。 */
export type CommentView = CommentBase & {
  replies: CommentReplyView[];
};

const RECENT_COMMENT_EXCERPT_LENGTH = 40;

/** コメント本文を新着コメントウィジェット用に1行・短く整形する（純関数）。 */
export function buildCommentExcerpt(body: string): string {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (singleLine.length <= RECENT_COMMENT_EXCERPT_LENGTH) return singleLine;
  return `${singleLine.slice(0, RECENT_COMMENT_EXCERPT_LENGTH)}…`;
}

export type CreateCommentResult =
  | { outcome: "published"; comment: CommentBase; parentNumber?: number }
  | { outcome: "held" }
  | { outcome: "rejected"; reason: "validation"; error: CommentValidationError }
  | { outcome: "rejected"; reason: "spam" }
  | { outcome: "rejected"; reason: "invalid_parent" };
