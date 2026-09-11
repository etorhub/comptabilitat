CREATE TABLE "job_runs" (
	"id" serial NOT NULL,
	"job_name" varchar(32) NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"parent_id" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" text NOT NULL,
	"error" text NOT NULL,
	CONSTRAINT "pk_job_runs" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "fk_job_runs_parent_id_job_runs" FOREIGN KEY ("parent_id") REFERENCES "public"."job_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_job_runs_started_at" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ix_job_runs_job_name" ON "job_runs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "ix_job_runs_status" ON "job_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_job_runs_parent_id" ON "job_runs" USING btree ("parent_id");
