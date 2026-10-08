/** 必须先扩展 zod，再加载 core schema（见 zod-openapi-setup） */
import "./zod-openapi-setup.ts";
import {
  changePasswordBody,
  createMemberBody,
  engineStatus,
  errorEnvelope,
  keyItem,
  logItem,
  logPage,
  memberItem,
  memberMe,
  memberOverview,
  memberWithToken,
  patchKeyBody,
  patchMemberBody,
  paymentItem,
  auditLogItem,
  registerKeyBody,
  setupBody,
  setupState,
  loginBody,
  tokenOnly,
  usernameBody,
} from "@new-api-key-usage/core";

/** OpenAPI 组件命名只在 server 层装饰，core 保持 Web 标准中立 */
function nameSchema<T extends { openapi?: (n: string) => unknown }>(
  schema: T,
  name: string,
): T {
  return typeof schema.openapi === "function"
    ? (schema.openapi(name) as T)
    : schema;
}

export const errorSchema = nameSchema(errorEnvelope, "ErrorEnvelope");
export const setupStateSchema = nameSchema(setupState, "SetupState");
export const engineStatusSchema = nameSchema(engineStatus, "EngineStatus");
export const keyItemSchema = nameSchema(keyItem, "KeyItem");
export const memberItemSchema = nameSchema(memberItem, "MemberItem");
export const memberWithTokenSchema = nameSchema(
  memberWithToken,
  "MemberWithToken",
);
export const memberMeSchema = nameSchema(memberMe, "MemberMe");
export const memberOverviewSchema = nameSchema(
  memberOverview,
  "MemberOverview",
);
export const logItemSchema = nameSchema(logItem, "LogItem");
export const logPageSchema = nameSchema(logPage, "LogPage");
export const paymentItemSchema = nameSchema(paymentItem, "PaymentItem");
export const auditLogItemSchema = nameSchema(auditLogItem, "AuditLogItem");

export {
  changePasswordBody as changePasswordBodySchema,
  createMemberBody as createMemberBodySchema,
  loginBody as loginBodySchema,
  patchKeyBody as patchKeyBodySchema,
  patchMemberBody as patchMemberBodySchema,
  registerKeyBody as registerKeyBodySchema,
  setupBody as setupBodySchema,
  tokenOnly as tokenOnlySchema,
  usernameBody as usernameSchema,
};

export const err401 = {
  description: "凭证无效或过期",
  content: { "application/json": { schema: errorSchema } },
} as const;

export const err404 = {
  description: "资源不存在",
  content: { "application/json": { schema: errorSchema } },
} as const;

export const err409 = {
  description: "冲突",
  content: { "application/json": { schema: errorSchema } },
} as const;

export const err422 = {
  description: "校验失败",
  content: { "application/json": { schema: errorSchema } },
} as const;

export const err502 = {
  description: "上游不可达",
  content: { "application/json": { schema: errorSchema } },
} as const;
