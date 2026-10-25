CREATE TABLE "consumer_streams" (
	"consumer_name" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"last_processed_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "consumer_streams_consumer_name_aggregate_type_aggregate_id_pk" PRIMARY KEY("consumer_name","aggregate_type","aggregate_id"),
	CONSTRAINT "consumer_name" CHECK ("consumer_streams"."consumer_name" ~ '^[a-z][a-z0-9.-]{0,95}$'),
	CONSTRAINT "consumer_cursor_range" CHECK ("consumer_streams"."last_processed_version" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer_name" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_name_event_id_pk" PRIMARY KEY("consumer_name","event_id"),
	CONSTRAINT "processed_consumer_name" CHECK ("processed_events"."consumer_name" ~ '^[a-z][a-z0-9.-]{0,95}$')
);
--> statement-breakpoint
ALTER TABLE "consumer_streams" ADD CONSTRAINT "consumer_streams_aggregate_type_aggregate_id_outbox_aggregate_sequences_aggregate_type_aggregate_id_fk" FOREIGN KEY ("aggregate_type","aggregate_id") REFERENCES "public"."outbox_aggregate_sequences"("aggregate_type","aggregate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE no action ON UPDATE no action;