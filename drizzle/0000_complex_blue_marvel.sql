CREATE TABLE "alerts" (
	"id" serial NOT NULL,
	"ledger_id" integer,
	"type" varchar(32) NOT NULL,
	"severity" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"dedup_key" varchar(200) NOT NULL,
	"title" varchar(250) NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_alerts" PRIMARY KEY("id"),
	CONSTRAINT "uq_alert_dedup_key" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial NOT NULL,
	"connection_id" integer NOT NULL,
	"ledger_id" integer,
	"eb_account_uid" varchar(128) NOT NULL,
	"name" varchar(160) NOT NULL,
	"product" varchar(120) NOT NULL,
	"iban" varchar(34) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cash_account_type" varchar(20) NOT NULL,
	"usage" varchar(20) NOT NULL,
	"is_active" boolean NOT NULL,
	"history_start_date" date,
	"last_booked_date" date,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_accounts" PRIMARY KEY("id"),
	CONSTRAINT "uq_accounts_eb_account_uid" UNIQUE("eb_account_uid")
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" serial NOT NULL,
	"account_id" integer NOT NULL,
	"balance_type" varchar(40) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reference_date" date NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_balances" PRIMARY KEY("id"),
	CONSTRAINT "uq_balance_account_type_date" UNIQUE("account_id","balance_type","reference_date")
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" serial NOT NULL,
	"name" varchar(120) NOT NULL,
	"aspsp_name" varchar(120) NOT NULL,
	"aspsp_country" varchar(2) NOT NULL,
	"psu_type" varchar(20) NOT NULL,
	"eb_session_id" varchar(128),
	"eb_auth_state" varchar(128),
	"status" varchar(32) NOT NULL,
	"valid_until" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_bank_connections" PRIMARY KEY("id"),
	CONSTRAINT "uq_bank_connections_eb_session_id" UNIQUE("eb_session_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial NOT NULL,
	"connection_id" integer NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"accounts_synced" integer NOT NULL,
	"transactions_inserted" integer NOT NULL,
	"transactions_updated" integer NOT NULL,
	"error" text NOT NULL,
	CONSTRAINT "pk_sync_runs" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "ledgers" (
	"id" serial NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"color" varchar(9) NOT NULL,
	"overdraft_threshold" numeric(14, 2) NOT NULL,
	"position" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"alert_recipients" varchar(255)[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_ledgers" PRIMARY KEY("id"),
	CONSTRAINT "uq_ledgers_code" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_ledger_permissions" (
	"id" serial NOT NULL,
	"user_id" integer NOT NULL,
	"ledger_id" integer NOT NULL,
	"role" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_ledger_permissions" PRIMARY KEY("id"),
	CONSTRAINT "uq_user_ledger" UNIQUE("user_id","ledger_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_occurrences" (
	"id" serial NOT NULL,
	"series_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "pk_recurring_occurrences" PRIMARY KEY("id"),
	CONSTRAINT "uq_occurrence_series_transaction" UNIQUE("series_id","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_series" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"signature" varchar(220) NOT NULL,
	"label" varchar(200) NOT NULL,
	"merchant_id" integer,
	"category_id" integer,
	"cadence" varchar(32) NOT NULL,
	"expected_amount" numeric(14, 2) NOT NULL,
	"amount_tolerance" numeric(14, 2) NOT NULL,
	"interval_days" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"occurrences_count" integer NOT NULL,
	"first_seen_date" date NOT NULL,
	"last_seen_date" date NOT NULL,
	"next_expected_date" date,
	"is_subscription" boolean NOT NULL,
	"status" varchar(32) NOT NULL,
	"include_in_forecast" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_recurring_series" PRIMARY KEY("id"),
	CONSTRAINT "uq_recurring_ledger_signature" UNIQUE("ledger_id","signature")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"parent_id" integer,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"color" varchar(9) NOT NULL,
	"icon" varchar(40) NOT NULL,
	"is_system" boolean NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_subscription" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pk_categories" PRIMARY KEY("id"),
	CONSTRAINT "uq_category_ledger_slug" UNIQUE("ledger_id","slug")
);
--> statement-breakpoint
CREATE TABLE "llm_suggestions" (
	"id" serial NOT NULL,
	"merchant_id" integer,
	"model" varchar(80) NOT NULL,
	"prompt_version" varchar(20) NOT NULL,
	"input_text" text NOT NULL,
	"suggested_category_id" integer,
	"suggested_display_name" varchar(200) NOT NULL,
	"confidence" double precision,
	"rationale" text NOT NULL,
	"accepted" boolean,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pk_llm_suggestions" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"default_category_id" integer,
	"category_source" varchar(32) NOT NULL,
	"is_confirmed" boolean NOT NULL,
	"transaction_count" integer NOT NULL,
	"last_seen_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_merchants" PRIMARY KEY("id"),
	CONSTRAINT "uq_merchant_ledger_name" UNIQUE("ledger_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" serial NOT NULL,
	"name" varchar(160) NOT NULL,
	"ledger_id" integer NOT NULL,
	"priority" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"conditions" jsonb NOT NULL,
	"set_category_id" integer,
	"set_merchant_id" integer,
	"set_tags" varchar(40)[] NOT NULL,
	"source" varchar(32) NOT NULL,
	"created_by_id" integer,
	"match_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_rules" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial NOT NULL,
	"account_id" integer NOT NULL,
	"ledger_id" integer,
	"entry_reference" varchar(128),
	"transaction_id" varchar(128),
	"dedup_key" varchar(64) NOT NULL,
	"source" varchar(32) NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"normalized_description" varchar(200) NOT NULL,
	"counterparty" varchar(200) NOT NULL,
	"bank_transaction_code" varchar(60) NOT NULL,
	"merchant_id" integer,
	"category_id" integer,
	"category_source" varchar(32) NOT NULL,
	"category_confidence" double precision,
	"needs_review" boolean NOT NULL,
	"applied_rule_id" integer,
	"transfer_group_id" varchar(64),
	"notes" text NOT NULL,
	"tags" varchar(40)[] NOT NULL,
	"is_excluded" boolean NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_description" varchar(200),
	CONSTRAINT "pk_transactions" PRIMARY KEY("id"),
	CONSTRAINT "uq_transaction_account_dedup" UNIQUE("account_id","dedup_key")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(255) NOT NULL,
	CONSTRAINT "pk_user_sessions" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial NOT NULL,
	"email" varchar(255) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"is_admin" boolean NOT NULL,
	"is_active" boolean NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_users" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "fk_alerts_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_connection_id_bank_connections" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "fk_accounts_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "fk_balances_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "fk_bank_connections_created_by_id_users" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "fk_sync_runs_connection_id_bank_connections" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ledger_permissions" ADD CONSTRAINT "fk_user_ledger_permissions_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ledger_permissions" ADD CONSTRAINT "fk_user_ledger_permissions_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "fk_recurring_occurrences_series_id_recurring_series" FOREIGN KEY ("series_id") REFERENCES "public"."recurring_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_occurrences" ADD CONSTRAINT "fk_recurring_occurrences_transaction_id_transactions" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "fk_recurring_series_category_id_categories" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "fk_recurring_series_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "fk_recurring_series_merchant_id_merchants" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "fk_categories_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "fk_categories_parent_id_categories" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_suggestions" ADD CONSTRAINT "fk_llm_suggestions_merchant_id_merchants" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_suggestions" ADD CONSTRAINT "fk_llm_suggestions_suggested_category_id_categories" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "fk_merchants_default_category_id_categories" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "fk_merchants_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "fk_rules_created_by_id_users" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "fk_rules_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "fk_rules_set_category_id_categories" FOREIGN KEY ("set_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "fk_rules_set_merchant_id_merchants" FOREIGN KEY ("set_merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_account_id_accounts" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_applied_rule_id_rules" FOREIGN KEY ("applied_rule_id") REFERENCES "public"."rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_category_id_categories" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_merchant_id_merchants" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_alerts_ledger_id" ON "alerts" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_alerts_status" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_alerts_type" ON "alerts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ix_accounts_connection_id" ON "accounts" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "ix_accounts_ledger_id" ON "accounts" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_balances_account_id" ON "balances" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_bank_connections_eb_auth_state" ON "bank_connections" USING btree ("eb_auth_state");--> statement-breakpoint
CREATE INDEX "ix_sync_runs_connection_id" ON "sync_runs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "ix_sync_runs_started_at" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ix_user_ledger_permissions_ledger_id" ON "user_ledger_permissions" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_user_ledger_permissions_user_id" ON "user_ledger_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_recurring_occurrences_series_id" ON "recurring_occurrences" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "ix_recurring_occurrences_transaction_id" ON "recurring_occurrences" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ix_recurring_series_ledger_id" ON "recurring_series" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_recurring_series_next_expected_date" ON "recurring_series" USING btree ("next_expected_date");--> statement-breakpoint
CREATE INDEX "ix_categories_ledger_id" ON "categories" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_categories_parent_id" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ix_llm_suggestions_merchant_id" ON "llm_suggestions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "ix_merchants_default_category_id" ON "merchants" USING btree ("default_category_id");--> statement-breakpoint
CREATE INDEX "ix_merchants_ledger_id" ON "merchants" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_rules_ledger_id" ON "rules" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_account_id" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_booking_date" ON "transactions" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "ix_transactions_category_id" ON "transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_ledger_booking" ON "transactions" USING btree ("ledger_id","booking_date");--> statement-breakpoint
CREATE INDEX "ix_transactions_ledger_id" ON "transactions" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_merchant_id" ON "transactions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_review" ON "transactions" USING btree ("needs_review","ledger_id");--> statement-breakpoint
CREATE INDEX "ix_transactions_transfer_group_id" ON "transactions" USING btree ("transfer_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_user_sessions_token_hash" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_user_sessions_user_id" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_email" ON "users" USING btree ("email");