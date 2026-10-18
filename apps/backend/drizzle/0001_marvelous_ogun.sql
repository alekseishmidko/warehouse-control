CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"has_redacted_changes" boolean DEFAULT false NOT NULL,
	CONSTRAINT "audit_actor_type" CHECK ("audit_entries"."actor_type" in ('user', 'system')),
	CONSTRAINT "audit_action_code" CHECK ("audit_entries"."action" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length("audit_entries"."action") <= 96),
	CONSTRAINT "audit_entity_type_code" CHECK ("audit_entries"."entity_type" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length("audit_entries"."entity_type") <= 96),
	CONSTRAINT "audit_reason_code" CHECK ("audit_entries"."reason_code" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length("audit_entries"."reason_code") <= 96),
	CONSTRAINT "audit_changes_object" CHECK (jsonb_typeof("audit_entries"."changes") = 'object')
);
--> statement-breakpoint
CREATE INDEX "audit_entity_time_idx" ON "audit_entries" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_correlation_idx" ON "audit_entries" USING btree ("correlation_id");