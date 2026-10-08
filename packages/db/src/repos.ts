import type { Db } from "./index.ts";
import {
  apiKeys,
  auditLogs,
  engineStatus,
  members,
  payments,
  qpuHistory,
  sessions,
  usageLogs,
  users,
  type ApiKeyRow,
  type AuditLogRow,
  type EngineStatusRow,
  type MemberRow,
  type PaymentRow,
  type SessionRow,
  type UsageLogRow,
  type UserRow,
} from "./schema.ts";
import { and, asc, count, desc, eq, gt, gte, isNull, lt, ne, or, sql } from "drizzle-orm";

export interface SessionUser {
  user_id: number;
  username: string;
  expires_at: Date;
}

export interface KeyListRow extends ApiKeyRow {
  member_name: string | null;
}

/**
 * 仓储层（R14）：数据访问只出现在 packages/db。
 * apps/server 不 import drizzle-orm / postgres 驱动。
 */
export function createRepos(db: Db) {
  return {
    users: {
      async countAll(): Promise<number> {
        const rows = await db.select({ id: users.id }).from(users).limit(1);
        return rows[0] ? 1 : 0;
      },
      async findByUsername(username: string): Promise<UserRow | null> {
        const rows = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);
        return rows[0] ?? null;
      },
      async findById(id: number): Promise<UserRow | null> {
        const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async insert(username: string, password_hash: string): Promise<UserRow> {
        const [row] = await db
          .insert(users)
          .values({ username, password_hash })
          .returning();
        return row!;
      },
      async updatePassword(id: number, password_hash: string): Promise<void> {
        await db.update(users).set({ password_hash }).where(eq(users.id, id));
      },
    },

    sessions: {
      async findValid(
        token_hash: string,
        now: Date,
      ): Promise<SessionUser | null> {
        const rows = await db
          .select({
            user_id: sessions.user_id,
            username: users.username,
            expires_at: sessions.expires_at,
          })
          .from(sessions)
          .innerJoin(users, eq(sessions.user_id, users.id))
          .where(
            and(eq(sessions.token_hash, token_hash), gt(sessions.expires_at, now)),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(
        user_id: number,
        token_hash: string,
        expires_at: Date,
      ): Promise<SessionRow> {
        const [row] = await db
          .insert(sessions)
          .values({ user_id, token_hash, expires_at })
          .returning();
        return row!;
      },
      async deleteByTokenHash(token_hash: string): Promise<void> {
        await db.delete(sessions).where(eq(sessions.token_hash, token_hash));
      },
      async listByUser(user_id: number) {
        return db
          .select({ id: sessions.id, token_hash: sessions.token_hash })
          .from(sessions)
          .where(eq(sessions.user_id, user_id));
      },
      async deleteById(id: number): Promise<void> {
        await db.delete(sessions).where(eq(sessions.id, id));
      },
    },

    keys: {
      async listAll(filter?: {
        member_id?: number | "unassigned";
        status?: string;
      }): Promise<KeyListRow[]> {
        const conds = [];
        if (filter?.member_id === "unassigned") {
          conds.push(sql`${apiKeys.member_id} is null`);
        } else if (typeof filter?.member_id === "number") {
          conds.push(eq(apiKeys.member_id, filter.member_id));
        }
        if (filter?.status) {
          conds.push(eq(apiKeys.status, filter.status));
        }
        const base = db
          .select({
            id: apiKeys.id,
            key_hash: apiKeys.key_hash,
            key_ciphertext: apiKeys.key_ciphertext,
            status: apiKeys.status,
            member_id: apiKeys.member_id,
            registered_at: apiKeys.registered_at,
            log_synced_at: apiKeys.log_synced_at,
            usage_synced_at: apiKeys.usage_synced_at,
            token_name: apiKeys.token_name,
            total_granted: apiKeys.total_granted,
            total_used: apiKeys.total_used,
            total_available: apiKeys.total_available,
            unlimited_quota: apiKeys.unlimited_quota,
            model_limits: apiKeys.model_limits,
            model_limits_enabled: apiKeys.model_limits_enabled,
            expires_at: apiKeys.expires_at,
            member_name: members.name,
          })
          .from(apiKeys)
          .leftJoin(members, eq(apiKeys.member_id, members.id));
        if (conds.length > 0) {
          return base.where(and(...conds));
        }
        return base;
      },
      async listActive() {
        return db
          .select({
            id: apiKeys.id,
            key_hash: apiKeys.key_hash,
            key_ciphertext: apiKeys.key_ciphertext,
            status: apiKeys.status,
            member_id: apiKeys.member_id,
            token_name: apiKeys.token_name,
          })
          .from(apiKeys)
          .where(eq(apiKeys.status, "active"))
          .orderBy(asc(apiKeys.id));
      },
      async insertLog(values: {
        api_key_id: number;
        dedupe_key: string;
        billing_source: string | null;
        subscription_id: number | null;
        user_id: number;
        created_at: Date;
        type: number;
        content: string;
        username: string;
        token_name: string;
        model_name: string;
        quota: number;
        prompt_tokens: number;
        completion_tokens: number;
        use_time: number;
        is_stream: boolean;
        channel: number;
        channel_name: string;
        token_id: number;
        group_name: string;
        ip: string;
        request_id: string;
        upstream_request_id: string | null;
        other: unknown;
      }): Promise<boolean> {
        const before = await db
          .select({ n: count() })
          .from(usageLogs)
          .where(eq(usageLogs.dedupe_key, values.dedupe_key));
        if ((before[0]?.n ?? 0) > 0) return false;
        await db.insert(usageLogs).values(values).onConflictDoNothing();
        return true;
      },
      async findById(id: number): Promise<ApiKeyRow | null> {
        const rows = await db
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByHash(key_hash: string): Promise<{ id: number } | null> {
        const rows = await db
          .select({ id: apiKeys.id })
          .from(apiKeys)
          .where(eq(apiKeys.key_hash, key_hash))
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(values: {
        key_hash: string;
        key_ciphertext: Uint8Array;
        member_id: number | null;
        token_name?: string;
      }): Promise<ApiKeyRow> {
        const [row] = await db
          .insert(apiKeys)
          .values({
            key_hash: values.key_hash,
            key_ciphertext: values.key_ciphertext,
            member_id: values.member_id,
            token_name: values.token_name ?? "",
          })
          .returning();
        return row!;
      },
      async update(
        id: number,
        patch: Partial<typeof apiKeys.$inferInsert>,
      ): Promise<ApiKeyRow> {
        const [row] = await db
          .update(apiKeys)
          .set(patch)
          .where(eq(apiKeys.id, id))
          .returning();
        return row!;
      },
    },

    members: {
      async listAll(): Promise<MemberRow[]> {
        return db.select().from(members);
      },
      async findById(id: number): Promise<MemberRow | null> {
        const rows = await db
          .select()
          .from(members)
          .where(eq(members.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByName(name: string): Promise<{ id: number } | null> {
        const rows = await db
          .select({ id: members.id })
          .from(members)
          .where(eq(members.name, name))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByTokenHash(token_hash: string): Promise<{
        id: number;
        status: string;
      } | null> {
        const rows = await db
          .select({ id: members.id, status: members.status })
          .from(members)
          .where(eq(members.token_hash, token_hash))
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(values: {
        name: string;
        remark: string;
        token_hash: string;
        token_issued_at: Date;
      }): Promise<MemberRow> {
        const [row] = await db.insert(members).values(values).returning();
        return row!;
      },
      async updateStatus(id: number, status: string): Promise<MemberRow> {
        const [row] = await db
          .update(members)
          .set({ status })
          .where(eq(members.id, id))
          .returning();
        return row!;
      },
      async reissueToken(
        id: number,
        token_hash: string,
        token_issued_at: Date,
      ): Promise<void> {
        await db
          .update(members)
          .set({ token_hash, token_issued_at })
          .where(eq(members.id, id));
      },
      async countKeys(member_id: number): Promise<number> {
        const rows = await db
          .select({ n: count() })
          .from(apiKeys)
          .where(eq(apiKeys.member_id, member_id));
        return rows[0]?.n ?? 0;
      },
    },

    audit: {
      async insert(values: {
        operator: string | null;
        domain: string;
        action: string;
        summary: string;
      }): Promise<AuditLogRow> {
        const [row] = await db.insert(auditLogs).values(values).returning();
        return row!;
      },
      async listPage(params: {
        domain?: string;
        from?: Date;
        to?: Date;
        page: number;
        page_size: number;
      }): Promise<{ rows: AuditLogRow[]; total: number }> {
        const conds = params.domain ? [eq(auditLogs.domain, params.domain)] : [];
        if (params.from) conds.push(gte(auditLogs.created_at, params.from));
        if (params.to) conds.push(lt(auditLogs.created_at, params.to));
        const totalRows = await db
          .select({ n: count() })
          .from(auditLogs)
          .where(conds.length ? and(...conds) : undefined);
        const total = totalRows[0]?.n ?? 0;
        const rows = await db
          .select()
          .from(auditLogs)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(auditLogs.created_at), desc(auditLogs.id))
          .limit(params.page_size)
          .offset((params.page - 1) * params.page_size);
        return { rows, total };
      },
    },

    engine: {
      async upsertSnapshot(values: {
        running: boolean;
        sync_interval_ms: number;
        last_round: unknown;
      }): Promise<EngineStatusRow> {
        const [row] = await db
          .insert(engineStatus)
          .values({
            id: 1,
            running: values.running,
            sync_interval_ms: values.sync_interval_ms,
            last_round: values.last_round,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: engineStatus.id,
            set: {
              running: values.running,
              sync_interval_ms: values.sync_interval_ms,
              last_round: values.last_round,
              updated_at: new Date(),
            },
          })
          .returning();
        return row!;
      },
      async getSnapshot(): Promise<EngineStatusRow | null> {
        const rows = await db
          .select()
          .from(engineStatus)
          .where(eq(engineStatus.id, 1))
          .limit(1);
        return rows[0] ?? null;
      },
    },

    payments: {
      async listAll(): Promise<PaymentRow[]> {
        return db.select().from(payments).orderBy(desc(payments.paid_at));
      },
      async findById(id: number): Promise<PaymentRow | null> {
        const rows = await db
          .select()
          .from(payments)
          .where(eq(payments.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(values: {
        kind: string;
        paid_at: Date;
        paid_amount: number;
        remark: string;
        period_start: Date | null;
        period_end: Date | null;
        subscription_id: number | null;
        quota_granted: number | null;
      }): Promise<PaymentRow> {
        const [row] = await db.insert(payments).values(values).returning();
        return row!;
      },
      async update(id: number, patch: Partial<typeof payments.$inferInsert>) {
        const [row] = await db
          .update(payments)
          .set(patch)
          .where(eq(payments.id, id))
          .returning();
        return row!;
      },
      async remove(id: number): Promise<void> {
        await db.delete(payments).where(eq(payments.id, id));
      },
    },

    qpu: {
      async listTimeline(): Promise<
        Array<{ qpu: number; effective_from: Date }>
      > {
        return db
          .select({
            qpu: qpuHistory.qpu,
            effective_from: qpuHistory.effective_from,
          })
          .from(qpuHistory)
          .orderBy(asc(qpuHistory.effective_from));
      },
      async latest(): Promise<{ qpu: number; effective_from: Date } | null> {
        const rows = await db
          .select({
            qpu: qpuHistory.qpu,
            effective_from: qpuHistory.effective_from,
          })
          .from(qpuHistory)
          .orderBy(desc(qpuHistory.effective_from))
          .limit(1);
        return rows[0] ?? null;
      },
      async insertChange(qpu: number, effective_from: Date): Promise<void> {
        await db.insert(qpuHistory).values({ qpu, effective_from });
      },
    },

    logs: {
      /** 明细分页（时间范围左闭右开） */
      async listPage(params: {
        from: Date;
        to: Date;
        api_key_id?: number;
        member_id?: number | "unassigned";
        billing_source?: string | "none";
        subscription_id?: number;
        type?: number | "error";
        page: number;
        page_size: number;
      }): Promise<{ rows: Array<UsageLogRow & { token_name: string }>; total: number }> {
        const conds = [
          gte(usageLogs.created_at, params.from),
          lt(usageLogs.created_at, params.to),
        ];
        if (params.api_key_id != null) {
          conds.push(eq(usageLogs.api_key_id, params.api_key_id));
        }
        if (params.billing_source === "none") {
          conds.push(isNull(usageLogs.billing_source));
        } else if (params.billing_source) {
          conds.push(eq(usageLogs.billing_source, params.billing_source));
        }
        if (params.subscription_id != null) {
          conds.push(eq(usageLogs.subscription_id, params.subscription_id));
        }
        if (params.type === "error") {
          conds.push(ne(usageLogs.type, 2));
        } else if (typeof params.type === "number") {
          conds.push(eq(usageLogs.type, params.type));
        }
        if (params.member_id === "unassigned") {
          conds.push(isNull(apiKeys.member_id));
        } else if (params.member_id != null) {
          conds.push(eq(apiKeys.member_id, params.member_id));
        }

        const totalRows = await db
          .select({ n: count() })
          .from(usageLogs)
          .leftJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .where(and(...conds));
        const total = totalRows[0]?.n ?? 0;

        const offset = (params.page - 1) * params.page_size;
        const rows = await db
          .select({
            id: usageLogs.id,
            api_key_id: usageLogs.api_key_id,
            dedupe_key: usageLogs.dedupe_key,
            billing_source: usageLogs.billing_source,
            subscription_id: usageLogs.subscription_id,
            user_id: usageLogs.user_id,
            created_at: usageLogs.created_at,
            type: usageLogs.type,
            content: usageLogs.content,
            username: usageLogs.username,
            token_name: apiKeys.token_name,
            model_name: usageLogs.model_name,
            quota: usageLogs.quota,
            prompt_tokens: usageLogs.prompt_tokens,
            completion_tokens: usageLogs.completion_tokens,
            use_time: usageLogs.use_time,
            is_stream: usageLogs.is_stream,
            channel: usageLogs.channel,
            channel_name: usageLogs.channel_name,
            token_id: usageLogs.token_id,
            group_name: usageLogs.group_name,
            ip: usageLogs.ip,
            request_id: usageLogs.request_id,
            upstream_request_id: usageLogs.upstream_request_id,
            other: usageLogs.other,
          })
          .from(usageLogs)
          .leftJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .where(and(...conds))
          .orderBy(desc(usageLogs.created_at), desc(usageLogs.id))
          .limit(params.page_size)
          .offset(offset);

        return {
          rows: rows.map((r) => ({
            ...r,
            token_name: r.token_name ?? "",
          })) as Array<UsageLogRow & { token_name: string }>,
          total,
        };
      },

      /** 总览聚合用：type=2、按维字段 */
      async listForAggregate(from: Date, to: Date, type = 2) {
        return db
          .select({
            api_key_id: usageLogs.api_key_id,
            member_id: apiKeys.member_id,
            billing_source: usageLogs.billing_source,
            subscription_id: usageLogs.subscription_id,
            quota: usageLogs.quota,
            created_at: usageLogs.created_at,
            token_name: apiKeys.token_name,
            status: apiKeys.status,
            log_synced_at: apiKeys.log_synced_at,
            member_name: members.name,
          })
          .from(usageLogs)
          .leftJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .leftJoin(members, eq(apiKeys.member_id, members.id))
          .where(
            and(
              gte(usageLogs.created_at, from),
              lt(usageLogs.created_at, to),
              eq(usageLogs.type, type),
            ),
          );
      },

      /** 成员视图聚合（名下 key、type=2） */
      async listMemberForAggregate(
        member_id: number,
        from: Date,
        to: Date,
        type = 2,
      ) {
        return db
          .select({
            api_key_id: usageLogs.api_key_id,
            billing_source: usageLogs.billing_source,
            subscription_id: usageLogs.subscription_id,
            quota: usageLogs.quota,
            created_at: usageLogs.created_at,
            token_name: apiKeys.token_name,
            log_synced_at: apiKeys.log_synced_at,
          })
          .from(usageLogs)
          .innerJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .where(
            and(
              eq(apiKeys.member_id, member_id),
              gte(usageLogs.created_at, from),
              lt(usageLogs.created_at, to),
              eq(usageLogs.type, type),
            ),
          );
      },

      /** 成员视图明细分页（恒 type=2） */
      async listMemberPage(params: {
        member_id: number;
        from: Date;
        to: Date;
        page: number;
        page_size: number;
      }) {
        const conds = [
          eq(apiKeys.member_id, params.member_id),
          gte(usageLogs.created_at, params.from),
          lt(usageLogs.created_at, params.to),
          eq(usageLogs.type, 2),
        ];
        const totalRows = await db
          .select({ n: count() })
          .from(usageLogs)
          .innerJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .where(and(...conds));
        const total = totalRows[0]?.n ?? 0;
        const rows = await db
          .select({
            id: usageLogs.id,
            api_key_id: usageLogs.api_key_id,
            created_at: usageLogs.created_at,
            token_name: apiKeys.token_name,
            model_name: usageLogs.model_name,
            type: usageLogs.type,
            content: usageLogs.content,
            quota: usageLogs.quota,
            prompt_tokens: usageLogs.prompt_tokens,
            completion_tokens: usageLogs.completion_tokens,
            use_time: usageLogs.use_time,
            is_stream: usageLogs.is_stream,
            billing_source: usageLogs.billing_source,
            subscription_id: usageLogs.subscription_id,
            log_synced_at: apiKeys.log_synced_at,
          })
          .from(usageLogs)
          .innerJoin(apiKeys, eq(usageLogs.api_key_id, apiKeys.id))
          .where(and(...conds))
          .orderBy(desc(usageLogs.created_at), desc(usageLogs.id))
          .limit(params.page_size)
          .offset((params.page - 1) * params.page_size);
        return { rows, total };
      },
    },

    keysExtra: {
      /** 全池数据截止 = 仍会同步的 key 中最慢 log_synced_at（停用 key 不计） */
      async slowestLogSyncedAt(): Promise<Date | null> {
        const rows = await db
          .select({ t: sql<string | null>`min(${apiKeys.log_synced_at})::text` })
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.status, "active"),
              sql`${apiKeys.log_synced_at} is not null`,
            ),
          );
        const raw = rows[0]?.t;
        if (!raw) return null;
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
      },
      async listIdsWithCutoff() {
        return db
          .select({
            id: apiKeys.id,
            member_id: apiKeys.member_id,
            token_name: apiKeys.token_name,
            status: apiKeys.status,
            log_synced_at: apiKeys.log_synced_at,
          })
          .from(apiKeys);
      },
    },
  };
}

export type Repos = ReturnType<typeof createRepos>;
