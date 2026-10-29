CREATE TABLE "identity_bootstrap" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_bootstrap_key" CHECK ("identity_bootstrap"."key" = 'initial')
);
--> statement-breakpoint
CREATE TABLE "auth_login_windows" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_login_window_attempts" CHECK ("auth_login_windows"."attempts" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "identity_token_hash" CHECK ("sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "identity_deadline_order" CHECK ("sessions"."idle_expires_at" <= "sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"system_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login"),
	CONSTRAINT "identity_login" CHECK ("users"."login" ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
	CONSTRAINT "identity_password_hash" CHECK ("users"."password_hash" ~ '^scrypt[$]131072[$]8[$]1[$][a-f0-9]{32}[$][a-f0-9]{128}$')
);
--> statement-breakpoint
CREATE TABLE "warehouse_roles" (
	"user_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "warehouse_roles_user_id_warehouse_id_role_pk" PRIMARY KEY("user_id","warehouse_id","role"),
	CONSTRAINT "identity_warehouse_role" CHECK ("warehouse_roles"."role" in ('viewer','warehouse_operator','order_manager','warehouse_supervisor'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_roles" ADD CONSTRAINT "warehouse_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_roles" ADD CONSTRAINT "warehouse_roles_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_sessions_user_idx" ON "sessions" USING btree ("user_id");