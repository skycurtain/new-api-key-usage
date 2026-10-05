import { z } from "zod";
import { extendZodWithOpenApi } from "@hono/zod-openapi";
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

// OpenAPI 组件命名只在 server 层装饰，core 保持 Web 标准中立
extendZodWithOpenApi(z);

export const errorSchema = errorEnvelope.openapi("ErrorEnvelope");
export const setupStateSchema = setupState.openapi("SetupState");
export const engineStatusSchema = engineStatus.openapi("EngineStatus");
export const keyItemSchema = keyItem.openapi("KeyItem");
export const memberItemSchema = memberItem.openapi("MemberItem");
export const memberWithTokenSchema = memberWithToken.openapi("MemberWithToken");
export const memberMeSchema = memberMe.openapi("MemberMe");
export const memberOverviewSchema = memberOverview.openapi("MemberOverview");
export const logItemSchema = logItem.openapi("LogItem");
export const logPageSchema = logPage.openapi("LogPage");
export const paymentItemSchema = paymentItem.openapi("PaymentItem");
export const auditLogItemSchema = auditLogItem.openapi("AuditLogItem");

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
