import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ErrorEnvelope } from "@new-api-key-usage/core";
import { redirectAuth, type AuthWorld } from "./auth-redirect.ts";

const MEMBER_TOKEN_KEY = "member_token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly keyId: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    extra?: { fields?: Record<string, string>; key_id?: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = extra?.fields;
    this.keyId = extra?.key_id;
  }
}

function parseErrorEnvelope(data: unknown): ErrorEnvelope | null {
  if (!data || typeof data !== "object") return null;
  const env = data as Partial<ErrorEnvelope>;
  if (!env.error || typeof env.error !== "object") return null;
  const { code, message } = env.error;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return env as ErrorEnvelope;
}

function toApiError(error: AxiosError, world: AuthWorld): ApiError {
  const envelope = parseErrorEnvelope(error.response?.data);
  if (envelope) {
    return new ApiError(
      error.response?.status ?? 0,
      envelope.error.code,
      envelope.error.message,
      {
        fields: envelope.error.fields,
        key_id: envelope.error.key_id,
      },
    );
  }
  const status = error.response?.status ?? 0;
  if (status === 401) {
    return new ApiError(401, "unauthorized", "凭证无效或已过期");
  }
  if (status === 0 || !error.response) {
    return new ApiError(0, "network", "网络异常，请稍后重试");
  }
  // 中间人非 JSON 错误体（代理 502 页等）回退通用文案
  return new ApiError(status, "internal", "服务暂时不可用，请稍后重试");
}

function attachInterceptors(client: AxiosInstance, world: AuthWorld): void {
  if (world === "member") {
    client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = sessionStorage.getItem(MEMBER_TOKEN_KEY);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      const apiError = toApiError(error, world);
      // 401 仅表示「本世界凭证失效」；上游平台 token 失效是 422 platform_token_invalid
      if (
        apiError.status === 401 &&
        apiError.code !== "platform_token_invalid"
      ) {
        redirectAuth(world, "expired");
      }
      return Promise.reject(apiError);
    },
  );
}

function createClient(world: AuthWorld, baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30_000,
    // 管理面会话 cookie 需跨端口（Vite 5173 → API 18456）携带
    withCredentials: true,
    headers: { Accept: "application/json" },
  });
  attachInterceptors(client, world);
  return client;
}

/** 管理面：`/api/admin/*`，会话 cookie */
export const adminHttp = createClient("admin", "/api/admin");

/** 成员视图：`/api/member/*`，Bearer 令牌 */
export const memberHttp = createClient("member", "/api/member");
