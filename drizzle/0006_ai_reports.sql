CREATE TABLE "ai_reports" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"period" varchar(10) NOT NULL,
	"status" varchar(32) NOT NULL,
	"facts" jsonb,
	"text" jsonb,
	"model" varchar(80) NOT NULL,
	"prompt_version" varchar(20) NOT NULL,
	"error" text NOT NULL,
	"attempts" integer NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_ai_reports" PRIMARY KEY("id"),
	CONSTRAINT "uq_ai_reports_ledger_kind_period" UNIQUE("ledger_id","kind","period")
);
--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "fk_ai_reports_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_ai_reports_ledger_id" ON "ai_reports" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_ai_reports_status" ON "ai_reports" USING btree ("status");