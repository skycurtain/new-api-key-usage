ALTER TABLE "api_keys" ADD COLUMN "billing_domain" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_domain" text;--> statement-breakpoint
ALTER TABLE "topups" ADD COLUMN "billing_domain" text;