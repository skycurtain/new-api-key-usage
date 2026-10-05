import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** bytea：AES-GCM 打包密文（nonce||ct||tag） */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

export const members = pgTable("members", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(),
  remark: text("remark").notNull().default(""),
  status: text("status").notNull().default("active"),
  token_hash: text("token_hash").notNull().unique(),
  token_issued_at: timestamp("token_issued_at", {
    withTimezone: true,
    mode: "date",
  }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    key_hash: text("key_hash").notNull().unique(),
    key_ciphertext: bytea("key_ciphertext").notNull(),
    status: text("status").notNull().default("active"),
    member_id: bigint("member_id", { mode: "number" }).references(
      () => members.id,
    ),
    registered_at: timestamp("registered_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    log_synced_at: timestamp("log_synced_at", {
      withTimezone: true,
      mode: "date",
    }),
    usage_synced_at: timestamp("usage_synced_at", {
      withTimezone: true,
      mode: "date",
    }),
    token_name: text("token_name").notNull().default(""),
    total_granted: bigint("total_granted", { mode: "number" })
      .notNull()
      .default(0),
    total_used: bigint("total_used", { mode: "number" }).notNull().default(0),
    total_available: bigint("total_available", { mode: "number" })
      .notNull()
      .default(0),
    unlimited_quota: boolean("unlimited_quota").notNull().default(false),
    model_limits: jsonb("model_limits"),
    model_limits_enabled: boolean("model_limits_enabled")
      .notNull()
      .default(false),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("api_keys_member_id_idx").on(t.member_id)],
);

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    api_key_id: bigint("api_key_id", { mode: "number" })
      .notNull()
      .references(() => apiKeys.id),
    dedupe_key: text("dedupe_key").notNull().unique(),
    billing_source: text("billing_source"),
    subscription_id: bigint("subscription_id", { mode: "number" }),
    user_id: bigint("user_id", { mode: "number" }).notNull().default(0),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    type: smallint("type").notNull().default(2),
    content: text("content").notNull().default(""),
    username: text("username").notNull().default(""),
    token_name: text("token_name").notNull().default(""),
    model_name: text("model_name").notNull().default(""),
    quota: bigint("quota", { mode: "number" }).notNull().default(0),
    prompt_tokens: integer("prompt_tokens").notNull().default(0),
    completion_tokens: integer("completion_tokens").notNull().default(0),
    use_time: integer("use_time").notNull().default(0),
    is_stream: boolean("is_stream").notNull().default(false),
    channel: integer("channel").notNull().default(0),
    channel_name: text("channel_name").notNull().default(""),
    token_id: bigint("token_id", { mode: "number" }).notNull().default(0),
    group_name: text("group_name").notNull().default(""),
    ip: text("ip").notNull().default(""),
    request_id: text("request_id").notNull().default(""),
    upstream_request_id: text("upstream_request_id"),
    other: jsonb("other"),
  },
  (t) => [
    index("usage_logs_created_at_idx").on(t.created_at),
    index("usage_logs_api_key_created_idx").on(t.api_key_id, t.created_at),
    index("usage_logs_subscription_idx").on(t.subscription_id),
  ],
);

export const payments = pgTable("payments", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text("kind").notNull(),
  paid_at: timestamp("paid_at", { withTimezone: true, mode: "date" }).notNull(),
  paid_amount: numeric("paid_amount", {
    precision: 18,
    scale: 2,
    mode: "number",
  }).notNull(),
  remark: text("remark").notNull().default(""),
  period_start: timestamp("period_start", { withTimezone: true, mode: "date" }),
  period_end: timestamp("period_end", { withTimezone: true, mode: "date" }),
  subscription_id: bigint("subscription_id", { mode: "number" }),
  quota_granted: bigint("quota_granted", { mode: "number" }),
});

export const qpuHistory = pgTable("qpu_history", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  qpu: numeric("qpu", { precision: 18, scale: 6, mode: "number" }).notNull(),
  effective_from: timestamp("effective_from", {
    withTimezone: true,
    mode: "date",
  })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    user_id: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id),
    token_hash: text("token_hash").notNull().unique(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.user_id)],
);

/** 审计日志（管理面写操作留痕）——结构对齐 API契约-管理面 §9 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    operator: text("operator"),
    domain: text("domain").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull().default(""),
  },
  (t) => [index("audit_logs_created_at_idx").on(t.created_at)],
);

export type MemberRow = typeof members.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type UsageLogRow = typeof usageLogs.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type QpuHistoryRow = typeof qpuHistory.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
