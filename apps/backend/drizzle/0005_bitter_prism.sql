CREATE TABLE "delivery_streams" (
	"destination" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"last_completed_version" bigint DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	CONSTRAINT "delivery_streams_destination_aggregate_type_aggregate_id_pk" PRIMARY KEY("destination","aggregate_type","aggregate_id"),
	CONSTRAINT "delivery_stream_cursor_range" CHECK ("delivery_streams"."last_completed_version" between 0 and 9007199254740991),
	CONSTRAINT "delivery_stream_destination" CHECK ("delivery_streams"."destination" = 'inventory.putaway'),
	CONSTRAINT "delivery_stream_lease_pair" CHECK (("delivery_streams"."lease_until" is null) = ("delivery_streams"."lease_token" is null))
);
--> statement-breakpoint
CREATE TABLE "outbox_aggregate_sequences" (
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"last_version" bigint NOT NULL,
	CONSTRAINT "outbox_aggregate_sequences_aggregate_type_aggregate_id_pk" PRIMARY KEY("aggregate_type","aggregate_id"),
	CONSTRAINT "outbox_sequence_range" CHECK ("outbox_aggregate_sequences"."last_version" between 1 and 9007199254740991),
	CONSTRAINT "outbox_sequence_aggregate" CHECK ("outbox_aggregate_sequences"."aggregate_type" = 'receipt')
);
--> statement-breakpoint
CREATE TABLE "outbox_deliveries" (
	"event_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" uuid,
	"last_error" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbox_deliveries_event_id_destination_pk" PRIMARY KEY("event_id","destination"),
	CONSTRAINT "outbox_delivery_destination" CHECK ("outbox_deliveries"."destination" = 'inventory.putaway'),
	CONSTRAINT "outbox_delivery_status" CHECK ("outbox_deliveries"."status" in ('pending', 'processing', 'retry', 'completed', 'dead')),
	CONSTRAINT "outbox_delivery_attempts" CHECK ("outbox_deliveries"."attempts" >= 0),
	CONSTRAINT "outbox_delivery_lease_pair" CHECK (("outbox_deliveries"."lease_until" is null) = ("outbox_deliveries"."lease_token" is null)),
	CONSTRAINT "outbox_delivery_completion" CHECK (("outbox_deliveries"."status" = 'completed') = ("outbox_deliveries"."completed_at" is not null)),
	CONSTRAINT "outbox_delivery_error_length" CHECK (length("outbox_deliveries"."last_error") <= 512)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" bigint NOT NULL,
	"envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_event_aggregate_version_unique" UNIQUE("aggregate_type","aggregate_id","aggregate_version"),
	CONSTRAINT "outbox_event_version_range" CHECK ("outbox_events"."aggregate_version" between 1 and 9007199254740991),
	CONSTRAINT "outbox_envelope_identity" CHECK (coalesce(jsonb_typeof("outbox_events"."envelope") = 'object'
    and lower("outbox_events"."envelope"->>'eventId') = "outbox_events"."event_id"::text
    and "outbox_events"."envelope"->>'aggregateType' = "outbox_events"."aggregate_type"
    and lower("outbox_events"."envelope"->>'aggregateId') = "outbox_events"."aggregate_id"::text
    and ("outbox_events"."envelope"->>'aggregateVersion')::bigint = "outbox_events"."aggregate_version", false))
);
--> statement-breakpoint
ALTER TABLE "delivery_streams" ADD CONSTRAINT "delivery_stream_sequence_fk" FOREIGN KEY ("aggregate_type","aggregate_id") REFERENCES "public"."outbox_aggregate_sequences"("aggregate_type","aggregate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_deliveries" ADD CONSTRAINT "outbox_deliveries_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_event_sequence_fk" FOREIGN KEY ("aggregate_type","aggregate_id") REFERENCES "public"."outbox_aggregate_sequences"("aggregate_type","aggregate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_streams_lease_idx" ON "delivery_streams" USING btree ("lease_until");--> statement-breakpoint
CREATE INDEX "outbox_deliveries_available_idx" ON "outbox_deliveries" USING btree ("available_at") WHERE "outbox_deliveries"."status" in ('pending', 'retry', 'processing');--> statement-breakpoint
CREATE INDEX "outbox_events_created_at_idx" ON "outbox_events" USING btree ("created_at");