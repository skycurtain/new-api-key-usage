import { defineStore } from "pinia";

const STORAGE_KEY = "member_token";

function readToken(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等场景忽略
  }
}

/**
 * 成员明文令牌——仅存在于登录壳输入与 sessionStorage（交互登录篇 §4）。
 * 无登出端点：关标签即失效；作者重发令牌后旧令牌下一请求自然 401。
 */
export const useMemberTokenStore = defineStore("member-token", {
  state: () => ({
    token: readToken(),
    memberName: "",
  }),
  getters: {
    hasToken: (s) => s.token.length > 0,
  },
  actions: {
    setToken(token: string) {
      this.token = token;
      writeToken(token);
    },
    setMemberName(name: string) {
      this.memberName = name;
    },
    clearToken() {
      this.token = "";
      this.memberName = "";
      writeToken("");
    },
  },
});
