-- Remap actors → merchants, then drop actors / subscription / category recurrence
-- gates. Schedules become suggested|active|ended|dismissed with exact|average
-- amount modes. Existing series are wiped and rebuilt as suggestions.

-- 1. Create merchants for actors that do not already exist under the same name.
INSERT INTO merchants (
  ledger_id,
  normalized_name,
  display_name,
  default_category_id,
  category_source,
  is_confirmed,
  transaction_count,
  last_seen_at,
  created_at,
  updated_at
)
SELECT
  a.ledger_id,
  a.normalized_name,
  a.display_name,
  NULL,
  'none',
  a.is_confirmed,
  a.transaction_count,
  a.last_seen_at,
  a.created_at,
  a.updated_at
FROM actors a
WHERE NOT EXISTS (
  SELECT 1
  FROM merchants m
  WHERE m.ledger_id = a.ledger_id
    AND m.normalized_name = a.normalized_name
);
--> statement-breakpoint

-- 2. Point actor transactions at the matching merchant.
UPDATE transactions t
SET merchant_id = m.id
FROM actors a
JOIN merchants m
  ON m.ledger_id = a.ledger_id
 AND m.normalized_name = a.normalized_name
WHERE t.actor_id = a.id
  AND t.merchant_id IS NULL;
--> statement-breakpoint

-- 3. Drop series: signatures and flags change; detector rebuilds as suggestions.
DELETE FROM recurring_occurrences;
--> statement-breakpoint
DELETE FROM recurring_series;
--> statement-breakpoint

ALTER TABLE recurring_series DROP CONSTRAINT IF EXISTS fk_recurring_series_actor_id_actors;
--> statement-breakpoint
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fk_transactions_actor_id_actors;
--> statement-breakpoint
DROP INDEX IF EXISTS ix_transactions_actor_id;
--> statement-breakpoint
ALTER TABLE recurring_series DROP COLUMN IF EXISTS actor_id;
--> statement-breakpoint
ALTER TABLE transactions DROP COLUMN IF EXISTS actor_id;
--> statement-breakpoint
DROP TABLE IF EXISTS actor_aliases;
--> statement-breakpoint
DROP TABLE IF EXISTS actors;
--> statement-breakpoint

ALTER TABLE categories DROP COLUMN IF EXISTS is_subscription;
--> statement-breakpoint
ALTER TABLE categories DROP COLUMN IF EXISTS is_recurrent;
--> statement-breakpoint
ALTER TABLE categories DROP COLUMN IF EXISTS recurrent_cadence;
--> statement-breakpoint
ALTER TABLE recurring_series DROP COLUMN IF EXISTS is_subscription;
--> statement-breakpoint

ALTER TABLE recurring_series ADD COLUMN amount_mode varchar(32) DEFAULT 'exact' NOT NULL;
--> statement-breakpoint
ALTER TABLE recurring_series ALTER COLUMN amount_mode DROP DEFAULT;
