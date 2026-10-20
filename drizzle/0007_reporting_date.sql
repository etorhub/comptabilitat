ALTER TABLE "transactions" ADD COLUMN "reporting_date" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reporting_date_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "transactions" AS t
SET "reporting_date" = (date_trunc('month', t.booking_date) + interval '1 month')::date
FROM "categories" AS c
WHERE t.category_id = c.id
  AND c.slug = 'ingressos-del-treball-nomina'
  AND extract(day from t.booking_date) >= 28;--> statement-breakpoint
CREATE INDEX "ix_transactions_reporting_date" ON "transactions" USING btree ("reporting_date");--> statement-breakpoint
CREATE INDEX "ix_transactions_ledger_reporting" ON "transactions" USING btree ("ledger_id","reporting_date");
