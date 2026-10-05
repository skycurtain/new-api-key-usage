import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ERR, generateToken, unixToIso } from "@new-api-key-usage/core";
import type { MemberRow } from "@new-api-key-usage/db";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import {
  createMemberBodySchema,
  err401,
  err404,
  err409,
  err422,
  memberItemSchema,
  memberWithTokenSchema,
  patchMemberBodySchema,
  tokenOnlySchema,
} from "../api-schemas.ts";
import { z } from "zod";

function toMemberItem(row: MemberRow, key_count: number) {
  return {
    id: row.id,
    name: row.name,
    remark: row.remark,
    status: row.status as "active" | "disabled",
    token_issued_at: unixToIso(row.token_issued_at),
    created_at: unixToIso(row.created_at)!,
    key_count,
  };
}

export function adminMemberRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/members",
      summary: "成员清单",
      tags: ["成员管理"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "成员数组",
          content: {
            "application/json": { schema: z.array(memberItemSchema) },
          },
        },
        401: err401,
      },
    }),
    async (c) => {
      const guard = await requireAdminSession(c, async () => {});
      if (guard) return guard;
      const repos = c.get("repos");
      const rows = await repos.members.listAll();
      const items = [];
      for (const row of rows) {
        items.push(toMemberItem(row, await repos.members.countKeys(row.id)));
      }
      return c.json(items, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/members",
      summary: "开户（自动签发令牌）",
      description: "响应附明文 token——仅此一次；名称冲突 409",
      tags: ["成员管理"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: createMemberBodySchema } },
          required: true,
        },
      },
      responses: {
        201: {
          description: "member + 明文 token",
          content: { "application/json": { schema: memberWithTokenSchema } },
        },
        401: err401,
        409: err409,
        422: err422,
      },
    }),
    async (c) => {
      const guard = await requireAdminSession(c, async () => {});
      if (guard) return guard;
      const body = await c.req.json().catch(() => null);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const remark = typeof body?.remark === "string" ? body.remark : "";
      if (!name) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ name: "请填写成员名称" }),
        );
      }
      const repos = c.get("repos");
      if (await repos.members.findByName(name)) {
        return jsonError(c, 409, ERR.member_name_taken());
      }
      const token = await generateToken();
      const row = await repos.members.insert({
        name,
        remark,
        token_hash: token.hash,
        token_issued_at: new Date(),
      });
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "member",
        action: "member.create",
        summary: `开户 ${name}`,
      });
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "member",
        action: "member.token_issue",
        summary: `签发令牌 ${name}`,
      });
      return c.json(
        {
          member: toMemberItem(row, 0),
          token: token.plaintext,
        },
        201,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "patch",
      path: "/members/{id}",
      summary: "停用 / 启用",
      tags: ["成员管理"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { "application/json": { schema: patchMemberBodySchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "成员实体",
          content: { "application/json": { schema: memberItemSchema } },
        },
        401: err401,
        404: err404,
        422: err422,
      },
    }),
    async (c) => {
      const guard = await requireAdminSession(c, async () => {});
      if (guard) return guard;
      const id = Number(c.req.param("id"));
      const body = await c.req.json().catch(() => null);
      const status = body?.status;
      if (status !== "active" && status !== "disabled") {
        return jsonError(c, 422, ERR.validation_failed({ status: "非法状态" }));
      }
      const repos = c.get("repos");
      const before = await repos.members.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      const row = await repos.members.updateStatus(id, status);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "member",
        action: status === "active" ? "member.enable" : "member.disable",
        summary: `成员 ${row.name} · ${status === "active" ? "启用" : "停用"}`,
      });
      return c.json(toMemberItem(row, 0), 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/members/{id}/token",
      summary: "令牌重发",
      description: "旧令牌即刻失效；明文仅此响应一次",
      tags: ["成员管理"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        201: {
          description: "明文 token",
          content: { "application/json": { schema: tokenOnlySchema } },
        },
        401: err401,
        404: err404,
      },
    }),
    async (c) => {
      const guard = await requireAdminSession(c, async () => {});
      if (guard) return guard;
      const id = Number(c.req.param("id"));
      const repos = c.get("repos");
      const before = await repos.members.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      const token = await generateToken();
      await repos.members.reissueToken(id, token.hash, new Date());
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "member",
        action: "member.token_reissue",
        summary: `重发令牌 ${before.name}`,
      });
      return c.json({ token: token.plaintext }, 201);
    },
  );

  return r;
}
