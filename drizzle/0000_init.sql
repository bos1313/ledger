CREATE TYPE "public"."account_kind" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."transfer_kind" AS ENUM('transfer', 'deposit');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" "account_kind" DEFAULT 'user' NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner_ck" CHECK (("accounts"."kind" = 'user' AND "accounts"."user_id" IS NOT NULL) OR ("accounts"."kind" = 'system' AND "accounts"."code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transfer_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_nonzero_ck" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "transfer_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"converted_minor" bigint NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"rate_date" text,
	"description" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_amount_positive_ck" CHECK ("transfers"."amount_minor" > 0 AND "transfers"."converted_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_uq" ON "accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_currency_uq" ON "accounts" USING btree ("user_id","currency");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_created_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_transfer_idx" ON "ledger_entries" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_idempotency_uq" ON "transfers" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_external_ref_uq" ON "transfers" USING btree ("external_ref");