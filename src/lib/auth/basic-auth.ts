/**
 * 運営ダッシュボード（/admin, 拡張E7）向けの Basic 認証・純関数群。
 * middleware.ts（Edge/Node どちらでも動く必要がある）と、サーバーアクション側の
 * 二重チェック（lib/admin/auth-context.ts）の両方から利用する共通実装。
 *
 * 認証情報は env（ADMIN_USER / ADMIN_PASSWORD）から読む。ハードコードしない。
 * 未設定時は「管理機能自体を無効化（常に拒否）」という安全側の挙動にする。
 */

export type AdminCredentials = { user: string; password: string };

/** env から管理者資格情報を読む。ADMIN_USER・ADMIN_PASSWORD のいずれかが未設定なら null（=未設定）。 */
export function getAdminCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): AdminCredentials | null {
  const user = env.ADMIN_USER;
  const password = env.ADMIN_PASSWORD;
  if (!user || !password) return null;
  return { user, password };
}

export function isAdminAuthConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getAdminCredentialsFromEnv(env) != null;
}

/**
 * タイミング攻撃を避けるための定数時間文字列比較。
 * Node の `crypto.timingSafeEqual` はEdgeランタイムで使えず、かつ長さ不一致で例外を投げるため、
 * どちらのランタイムでも動く自前実装にする（早期returnをせず、長さ不一致でも常に同じ回数比較する）。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  const compareLength = Math.max(bufA.length, bufB.length, 32);

  let diff = bufA.length === bufB.length ? 0 : 1;
  for (let i = 0; i < compareLength; i++) {
    const x = i < bufA.length ? bufA[i] : 0;
    const y = i < bufB.length ? bufB[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

function decodeBase64(value: string): string | null {
  try {
    if (typeof atob === "function") return atob(value);
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** `Authorization: Basic base64(user:password)` ヘッダーをパースする。不正な形式は null。 */
export function parseBasicAuthHeader(header: string | null): { user: string; password: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  const decoded = decodeBase64(header.slice("Basic ".length).trim());
  if (decoded == null) return null;
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;
  return { user: decoded.slice(0, separatorIndex), password: decoded.slice(separatorIndex + 1) };
}

/** 提供された資格情報が期待値と一致するか（timing-safe）。expected が null（未設定）なら常に false。 */
export function verifyCredentials(
  provided: { user: string; password: string } | null,
  expected: AdminCredentials | null,
): boolean {
  if (!expected || !provided) return false;
  const userOk = timingSafeEqual(provided.user, expected.user);
  const passwordOk = timingSafeEqual(provided.password, expected.password);
  return userOk && passwordOk;
}

/** Authorization ヘッダー値から、env の管理者資格情報と一致するかを判定する。 */
export function verifyBasicAuthHeader(
  header: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return verifyCredentials(parseBasicAuthHeader(header), getAdminCredentialsFromEnv(env));
}

export class UnauthorizedError extends Error {
  constructor(message = "管理者認証が必要です") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** 認証済みでなければ例外を投げる（サーバーアクション/ライブラリ関数の入口ガード）。 */
export function assertAuthorizedHeader(
  authorizationHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!verifyBasicAuthHeader(authorizationHeader, env)) {
    throw new UnauthorizedError();
  }
}
