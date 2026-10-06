import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  KeyCrypto,
  normalizeExpiresAt,
  unixToIso,
  type KeyItem,
} from "@new-api-key-usage/core";
import type { ApiKeyRow } from "@new-api-key-usage/db";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import {
  err401,
  err404,
  err409,
  err422,
  keyItemSchema,
  patchKeyBodySchema,
  registerKeyBodySchema,
} from "../api-schemas.ts";
import { z } from "zod";

function toKeyItem(row: ApiKeyRow & { member_name?: string | null }): KeyItem {
  return {
    id: row.id,
    token_name: row.token_name,
    status: row.status as "active" | "disabled",
    member_id: row.member_id,
    member_name: row.member_name ?? null,
    registered_at: unixToIso(row.registered_at)!,
    log_synced_at: unixToIso(row.log_synced_at),
    usage_synced_at: unixToIso(row.usage_synced_at),
    total_used: row.total_used,
    total_available: row.total_available,
    total_granted: row.total_granted,
    unlimited_quota: row.unlimited_quota,
    expires_at: unixToIso(row.expires_at),
  };
}

export function adminKeyRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  // 鉴权优先于请求体校验（未登录恒 401）
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/keys",
      summary: "key 清单",
      description:
        "全量直返（基数 10–25，不分页）。key_hash / key_ciphertext 永不出 API。",
      tags: ["Key 管理"],
      security: [{ adminSession: [] }],
      request: {
        query: z.object({
          member_id: z.string().optional(),
          status: z.enum(["active", "disabled"]).optional(),
          recent_failed: z.enum(["true", "false"]).optional(),
        }),
      },
      responses: {
        200: {
          description: "key 数组",
          content: {
            "application/json": { schema: z.array(keyItemSchema) },
          },
        },
        401: err401,
      },
    }),
    async (c) => {
      const q = c.req.query();
      const filter: {
        member_id?: number | "unassigned";
        status?: string;
      } = {};
      if (q.member_id === "unassigned") filter.member_id = "unassigned";
      else if (q.member_id) filter.member_id = Number(q.member_id);
      if (q.status === "active" || q.status === "disabled") {
        filter.status = q.status;
      }
      let rows = await c.get("repos").keys.listAll(filter);
      if (q.recent_failed === "true") {
        const { getEngineStatus } = await import("./admin-engine.ts");
        const failed = new Set(getEngineStatus().last_round?.failed_api_key_ids ?? []);
        rows = rows.filter((r) => failed.has(r.id));
      }
      return c.json(rows.map(toKeyItem), 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/keys",
      summary: "登记 key",
      description:
        "四态：201 成功 / 409 已登记（附 key_id）/ 422 上游拒绝 / 502 上游不可达。查库优先于上游验证。",
      tags: ["Key 管理"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: registerKeyBodySchema } },
          required: true,
        },
      },
      responses: {
        201: {
          description: "key 实体",
          content: { "application/json": { schema: keyItemSchema } },
        },
        401: err401,
        409: err409,
        422: err422,
        502: {
          description: "上游不可达",
          content: {
            "application/json": {
              schema: err422.content["application/json"].schema,
            },
          },
        },
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const sk_key = typeof body?.sk_key === "string" ? body.sk_key.trim() : "";
      let member_id: number | null = null;
      if (body?.member_id !== undefined && body?.member_id !== null) {
        const n = Number(body.member_id);
        if (!Number.isInteger(n) || n <= 0) {
          return jsonError(
            c,
            422,
            ERR.validation_failed({ member_id: "成员 id 无效" }),
          );
        }
        member_id = n;
      }
      if (!sk_key || !sk_key.startsWith("sk-")) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({
            sk_key: "请粘贴有效的 sk- 开头的 key",
          }),
        );
      }
      const repos = c.get("repos");
      const crypto = await KeyCrypto.fromEncryptionSecret(
        c.get("skKeyEncryptionSecret"),
      );
      const key_hash = await crypto.hashKey(sk_key);

      const existing = await repos.keys.findByHash(key_hash);
      if (existing) {
        return jsonError(c, 409, ERR.key_already_registered(existing.id));
      }

      if (member_id != null) {
        const m = await repos.members.findById(member_id);
        if (!m) {
          return jsonError(
            c,
            422,
            ERR.validation_failed({ member_id: "成员不存在" }),
          );
        }
      }

      const key_ciphertext = await crypto.sealKey(sk_key);

      // 上游验证（登记四态：422 拒绝 / 502 不可达）
      const fetchUsage =
        c.get("fetchTokenUsage") ??
        (async (key: string) => {
          const { createUpstreamClient } = await import(
            "@new-api-key-usage/core"
          );
          const client = createUpstreamClient({
            baseUrl: c.get("newapiBase"),
          });
          return client.fetchTokenUsage(key);
        });
      const upstream = await fetchUsage(sk_key);
      if (!upstream.ok) {
        if (upstream.kind === "rejected") {
          return jsonError(
            c,
            422,
            ERR.validation_failed({
              sk_key: "上游拒绝了这枚 key——可能不存在或已被禁用",
            }),
          );
        }
        return jsonError(c, 502, ERR.upstream_unreachable());
      }

      const usage = upstream.data;
      const row = await repos.keys.insert({
        key_hash,
        key_ciphertext,
        member_id,
        token_name: usage.name ?? "",
      });
      // 首次登记即写入上游额度字段（表设计 §4：首轮日志同步异步补）
      if (row.id) {
        await repos.keys.update(row.id, {
          token_name: usage.name ?? "",
          total_granted: usage.total_granted,
          total_used: usage.total_used,
          total_available: usage.total_available,
          unlimited_quota: usage.unlimited_quota,
          model_limits: usage.model_limits,
          model_limits_enabled: usage.model_limits_enabled,
          expires_at: normalizeExpiresAt(usage.expires_at),
          usage_synced_at: new Date(),
        });
      }

      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "key",
        action: "key.register",
        summary: `登记 key #${row.id}${row.token_name ? ` ${row.token_name}` : ""}`,
      });

      const fresh = (await repos.keys.findById(row.id)) ?? row;
      return c.json(toKeyItem({ ...fresh, member_name: null }), 201);
    },
  );

  r.openapi(
    createRoute({
      method: "patch",
      path: "/keys/{id}",
      summary: "启停 / 归属变更",
      description: "部分更新；审计按实际变更字段各落一行",
      tags: ["Key 管理"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { "application/json": { schema: patchKeyBodySchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "key 实体",
          content: { "application/json": { schema: keyItemSchema } },
        },
        401: err401,
        404: err404,
        422: err422,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const body = await c.req.json().catch(() => null);
      const repos = c.get("repos");
      const before = await repos.keys.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());

      const patch: Partial<ApiKeyRow> = {};
      const actions: Array<{ action: string; summary: string }> = [];
      if (body?.status === "active" || body?.status === "disabled") {
        if (body.status !== before.status) {
          patch.status = body.status;
          actions.push({
            action: body.status === "active" ? "key.enable" : "key.disable",
            summary: `key #${before.id} · ${body.status === "active" ? "启用" : "停用"}`,
          });
        }
      }
      if (body && "member_id" in body) {
        let nextMember: number | null = null;
        if (body.member_id != null) {
          const n = Number(body.member_id);
          if (!Number.isInteger(n) || n <= 0) {
            return jsonError(
              c,
              422,
              ERR.validation_failed({ member_id: "成员 id 无效" }),
            );
          }
          nextMember = n;
        }
        if (nextMember !== before.member_id) {
          patch.member_id = nextMember;
          actions.push({
            action: "key.reassign",
            summary: `key #${before.id} · 归属变更`,
          });
        }
      }
      if (Object.keys(patch).length === 0) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ body: "没有需要更新的字段" }),
        );
      }
      const after = await repos.keys.update(id, patch);
      for (const a of actions) {
        await repos.audit.insert({
          operator: c.get("adminUsername") ?? null,
          domain: "key",
          action: a.action,
          summary: a.summary,
        });
      }
      return c.json(toKeyItem({ ...after, member_name: null }), 200);
    },
  );

  return r;
}
