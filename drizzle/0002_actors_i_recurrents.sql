CREATE TABLE "actor_aliases" (
	"id" serial NOT NULL,
	"actor_id" integer NOT NULL,
	"ledger_id" integer NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_actor_aliases" PRIMARY KEY("id"),
	CONSTRAINT "uq_actor_alias_ledger_name" UNIQUE("ledger_id","normalized_name")
);
--> statement-breakpoint
CREATE TABLE "actors" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"is_confirmed" boolean NOT NULL,
	"user_id" integer,
	"transaction_count" integer NOT NULL,
	"last_seen_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_actors" PRIMARY KEY("id"),
	CONSTRAINT "uq_actor_ledger_name" UNIQUE("ledger_id","normalized_name")
);
--> statement-breakpoint
ALTER TABLE "recurring_series" DROP CONSTRAINT "fk_recurring_series_category_id_categories";
--> statement-breakpoint
-- La recurrencia passa a dependre de la categoria, no del comerç: les series
-- que ja hi ha no es poden reaprofitar (no en sabem la categoria d'origen ni
-- la contrapart amb el nou format de `signature`). Es buiden i es refan des
-- de zero la propera vegada que corri `detectaRecurrents` sobre una
-- categoria marcada com a recurrent.
DELETE FROM "recurring_occurrences";--> statement-breakpoint
DELETE FROM "recurring_series";--> statement-breakpoint
ALTER TABLE "recurring_series" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD COLUMN "actor_id" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_recurrent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "recurrent_cadence" varchar(32);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "actor_id" integer;--> statement-breakpoint
ALTER TABLE "actor_aliases" ADD CONSTRAINT "fk_actor_aliases_actor_id_actors" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_aliases" ADD CONSTRAINT "fk_actor_aliases_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "fk_actors_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "fk_actors_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_actor_aliases_actor_id" ON "actor_aliases" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ix_actors_ledger_id" ON "actors" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_actors_user_id" ON "actors" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "fk_recurring_series_actor_id_actors" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "fk_recurring_series_category_id_categories" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "fk_transactions_actor_id_actors" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_transactions_actor_id" ON "transactions" USING btree ("actor_id");--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "is_recurrent";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "recurrent_cadence";