CREATE TABLE "http_idempotency" (
	"actor_type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"body" jsonb,
	"headers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "http_idempotency_actor_type_actor_id_operation_key_pk" PRIMARY KEY("actor_type","actor_id","operation","key"),
	CONSTRAINT "http_idempotency_actor" CHECK ("http_idempotency"."actor_type" in ('user','system')),
	CONSTRAINT "http_idempotency_operation" CHECK ("http_idempotency"."operation" ~ '^[a-z][a-z0-9.-]{0,95}$'),
	CONSTRAINT "http_idempotency_hash" CHECK ("http_idempotency"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "http_idempotency_result" CHECK (("http_idempotency"."status_code" is null and "http_idempotency"."body" is null and "http_idempotency"."headers" is null and "http_idempotency"."completed_at" is null)
    or ("http_idempotency"."status_code" in (200,201,202) and "http_idempotency"."status_code" is not null and "http_idempotency"."body" is not null
      and "http_idempotency"."headers" is not null and "http_idempotency"."completed_at" is not null))
);
