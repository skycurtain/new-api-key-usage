/**
 * 401 分流出口：由 main.ts 接到 router，避免 http ↔ router 循环依赖。
 * 管理面任意 401 → /admin/login；成员视图任意 401 → /member/login（契约公共约定 §2）。
 */
export type AuthWorld = "admin" | "member";

type AuthRedirectHandler = (world: AuthWorld, reason: "expired" | "unauthorized") => void;

const fallback: AuthRedirectHandler = (world) => {
  window.location.href = world === "admin" ? "/admin/login" : "/member/login";
};

let handler: AuthRedirectHandler = fallback;

export function setAuthRedirect(fn: AuthRedirectHandler): void {
  handler = fn;
}

export function redirectAuth(
  world: AuthWorld,
  reason: "expired" | "unauthorized" = "unauthorized",
): void {
  handler(world, reason);
}
