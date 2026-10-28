CREATE TABLE "outbox_recovery_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"consumer" text NOT NULL,
	"operator_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"previous_attempts" integer NOT NULL,
	"previous_retry_attempt_base" integer NOT NULL,
	"previous_error" text,
	"audit_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_reason_code" CHECK ("outbox_recovery_actions"."reason_code" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' and length("outbox_recovery_actions"."reason_code") <= 96),
	CONSTRAINT "recovery_attempts" CHECK ("outbox_recovery_actions"."previous_retry_attempt_base" >= 0 and "outbox_recovery_actions"."previous_retry_attempt_base" <= "outbox_recovery_actions"."previous_attempts"),
	CONSTRAINT "recovery_error_length" CHECK (length("outbox_recovery_actions"."previous_error") <= 512)
);
--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD COLUMN "retry_attempt_base" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_recovery_actions" ADD CONSTRAINT "outbox_recovery_actions_audit_id_audit_entries_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_recovery_actions" ADD CONSTRAINT "outbox_recovery_actions_event_id_consumer_outbox_deliveries_event_id_destination_fk" FOREIGN KEY ("event_id","consumer") REFERENCES "public"."outbox_deliveries"("event_id","destination") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_retry_attempt_base" CHECK ("outbox_deliveries"."retry_attempt_base" >= 0 and "outbox_deliveries"."retry_attempt_base" <= "outbox_deliveries"."attempts");