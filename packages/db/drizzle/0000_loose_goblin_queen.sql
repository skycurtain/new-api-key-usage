CREATE TABLE "api_keys" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key_hash" text NOT NULL,
	"key_ciphertext" "bytea" NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"member_id" bigint,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"log_synced_at" timestamp with time zone,
	"usage_synced_at" timestamp with time zone,
	"token_name" text DEFAULT '' NOT NULL,
	"total_granted" bigint DEFAULT 0 NOT NULL,
	"total_used" bigint DEFAULT 0 NOT NULL,
	"total_available" bigint DEFAULT 0 NOT NULL,
	"unlimited_quota" boolean DEFAULT false NOT NULL,
	"model_limits" jsonb,
	"model_limits_enabled" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operator" text,
	"domain" text NOT NULL,
	"action" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"sync_interval_ms" bigint DEFAULT 300000 NOT NULL,
	"last_round" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"token_hash" text NOT NULL,
	"token_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_name_unique" UNIQUE("name"),
	CONSTRAINT "members_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "qpu_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qpu_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"qpu" numeric(18, 6) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscription_id" bigint NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"quota_granted" bigint NOT NULL,
	"paid_amount" numeric(18, 2),
	"paid_at" timestamp with time zone,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "topups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "topups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"upstream_id" bigint,
	"amount" numeric(18, 6) NOT NULL,
	"money" numeric(18, 2) NOT NULL,
	"trade_no" text,
	"payment_method" text,
	"payment_provider" text,
	"status" text,
	"paid_at" timestamp with time zone NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"api_key_id" bigint NOT NULL,
	"dedupe_key" text NOT NULL,
	"billing_source" text,
	"subscription_id" bigint,
	"user_id" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"type" smallint DEFAULT 2 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"token_name" text DEFAULT '' NOT NULL,
	"model_name" text DEFAULT '' NOT NULL,
	"quota" bigint DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"use_time" integer DEFAULT 0 NOT NULL,
	"is_stream" boolean DEFAULT false NOT NULL,
	"channel" integer DEFAULT 0 NOT NULL,
	"channel_name" text DEFAULT '' NOT NULL,
	"token_id" bigint DEFAULT 0 NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"upstream_request_id" text,
	"other" jsonb,
	CONSTRAINT "usage_logs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_member_id_idx" ON "api_keys" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_period_idx" ON "subscriptions" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_api_key_created_idx" ON "usage_logs" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_subscription_idx" ON "usage_logs" USING btree ("subscription_id");