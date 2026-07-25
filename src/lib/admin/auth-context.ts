/**
 * 運営CMS（拡張E7）の各ライブラリ関数が受け取る認可コンテキスト。
 * middleware.ts が /admin へのアクセス自体を既にBasic認証で守っているが、
 * 「UIを隠すだけにしない」ため、DBを書き換える各関数の入口でも独立に再チェックする(defense in depth)。
 * next/headers に直接依存させず authorizationHeader を明示的な引数にすることで、
 * Next のリクエストコンテキスト無しでも（Vitestから直接呼び出して）テストできるようにしている。
 */
import { assertAuthorizedHeader } from "@/lib/auth/basic-auth";

export type AdminAuthContext = { authorizationHeader: string | null };

/** 認証済みでなければ例外を投げる。管理系の各ミューテーション関数は必ず最初にこれを呼ぶ。 */
export function requireAuthorized(auth: AdminAuthContext): void {
  assertAuthorizedHeader(auth.authorizationHeader);
}
