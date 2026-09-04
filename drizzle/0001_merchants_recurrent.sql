ALTER TABLE "merchants" ADD COLUMN "is_recurrent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "recurrent_cadence" varchar(32);