-- Remove content-duplicate transactions that slipped in when the bank later
-- added an entry_reference (h:… row kept, ref:… inserted on the next sync).
--
-- Keeps the oldest row of each (account_id, booking_date, amount, description)
-- group so categories and notes stay. Dry-run first:
--
--   SELECT account_id, booking_date, amount, left(description, 50), count(*),
--          array_agg(id ORDER BY id)
--   FROM transactions
--   GROUP BY 1, 2, 3, description
--   HAVING count(*) > 1
--   ORDER BY booking_date DESC;
--
-- Then run this file inside a transaction and check the forecast curve.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY account_id, booking_date, amount, description
      ORDER BY id
    ) AS n
  FROM transactions
)
DELETE FROM transactions t
USING ranked r
WHERE t.id = r.id
  AND r.n > 1;

COMMIT;
