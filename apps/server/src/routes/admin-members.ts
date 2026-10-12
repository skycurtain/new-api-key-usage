import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ERR, generateToken, toUnixSec } from "@new-api-key-usage/core";
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
    token_issued_at: toUnixSec(row.token_issued_at),
    created_at: toUnixSec(row.created_at)!,
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
      summary: "档案修改 / 停用 / 启用",
      description: "部分更新 name/remark/status；审计按实际变更字段各落一行",
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
        409: err409,
        422: err422,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const body = await c.req.json().catch(() => null);
      const repos = c.get("repos");
      const before = await repos.members.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());

      const profile: { name?: string; remark?: string } = {};
      const actions: Array<{ action: string; summary: string }> = [];

      if (typeof body?.name === "string") {
        const name = body.name.trim();
        if (!name || name.length > 64) {
          return jsonError(
            c,
            422,
            ERR.validation_failed({ name: "名称无效" }),
          );
        }
        if (name !== before.name) {
          const taken = await repos.members.findByName(name);
          if (taken && taken.id !== id) {
            return jsonError(c, 409, ERR.member_name_taken());
          }
          profile.name = name;
          actions.push({
            action: "member.update",
            summary: `成员 ${before.name} · 改名为 ${name}`,
          });
        }
      }
      if (typeof body?.remark === "string") {
        if (body.remark !== before.remark) {
          profile.remark = body.remark;
          actions.push({
            action: "member.update",
            summary: `成员 ${before.name} · 修改备注`,
          });
        }
      }
      let nextStatus: "active" | "disabled" | null = null;
      if (body?.status === "active" || body?.status === "disabled") {
        if (body.status !== before.status) {
          nextStatus = body.status;
          actions.push({
            action: body.status === "active" ? "member.enable" : "member.disable",
            summary: `成员 ${before.name} · ${body.status === "active" ? "启用" : "停用"}`,
          });
        }
      }

      if (Object.keys(profile).length === 0 && !nextStatus) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ body: "没有需要更新的字段" }),
        );
      }

      let row = before;
      if (Object.keys(profile).length > 0) {
        row = await repos.members.updateProfile(id, profile);
      }
      if (nextStatus) {
        row = await repos.members.updateStatus(id, nextStatus);
      }
      for (const a of actions) {
        await repos.audit.insert({
          operator: c.get("adminUsername") ?? null,
          domain: "member",
          action: a.action,
          summary: a.summary,
        });
      }
      return c.json(toMemberItem(row, await repos.members.countKeys(id)), 200);
    },
  );

  r.openapi(
    createRoute({
      method: "delete",
      path: "/members/{id}",
      summary: "空壳删除",
      description: "仅 key_count = 0 可硬删；名下有 key 返回 409 member_has_keys",
      tags: ["成员管理"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        204: { description: "已删除" },
        401: err401,
        404: err404,
        409: err409,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const repos = c.get("repos");
      const before = await repos.members.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      const keyCount = await repos.members.countKeys(id);
      if (keyCount > 0) {
        return jsonError(c, 409, ERR.member_has_keys(keyCount));
      }
      await repos.members.deleteById(id);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "member",
        action: "member.delete",
        summary: `删除成员 ${before.name}`,
      });
      return c.body(null, 204);
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
