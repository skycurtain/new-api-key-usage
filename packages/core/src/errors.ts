export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    key_id?: number;
  };
}

export function errorBody(
  code: string,
  message: string,
  extra?: { fields?: Record<string, string>; key_id?: number },
): ErrorBody {
  return {
    error: {
      code,
      message,
      ...(extra?.fields ? { fields: extra.fields } : {}),
      ...(extra?.key_id !== undefined ? { key_id: extra.key_id } : {}),
    },
  };
}

export const ERR = {
  invalid_credentials: () =>
    errorBody("invalid_credentials", "用户名或密码错误"),
  session_expired: () =>
    errorBody("session_expired", "会话已过期，请重新登录"),
  already_initialized: () =>
    errorBody("already_initialized", "系统已初始化，无法重复引导"),
  key_already_registered: (key_id: number) =>
    errorBody("key_already_registered", "这枚 key 已经登记过", { key_id }),
  member_name_taken: () =>
    errorBody("member_name_taken", "成员名称已被占用"),
  upstream_unreachable: () =>
    errorBody("upstream_unreachable", "上游站点暂时不可达，请稍后重试"),
  not_found: () => errorBody("not_found", "请求的资源不存在"),
  bad_request: () => errorBody("bad_request", "请求格式错误"),
  validation_failed: (fields: Record<string, string>) =>
    errorBody("validation_failed", "请检查表单填写", { fields }),
  internal: () =>
    errorBody("internal", "服务暂时不可用，请稍后重试"),
  too_many_requests: () =>
    errorBody("too_many_requests", "操作过于频繁，请稍后再试"),
} as const;
