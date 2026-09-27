-- ============================================================
-- Add suburb column to properties table
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add the suburb column (safe if already exists)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS suburb TEXT;

-- 2. Add an index so suburb-based searches are fast
CREATE INDEX IF NOT EXISTS idx_properties_suburb
  ON properties (suburb);

-- 3. Optional: backfill suburb from address for existing listings
--    (only updates rows where suburb is currently NULL and address has data)
--    Remove this block if you'd rather agents fill in manually via Edit Listing.
-- UPDATE properties
--   SET suburb = address
--   WHERE suburb IS NULL AND address IS NOT NULL;

-- 4. Verify: check the column was added and see current data
SELECT id, title, city, suburb, address
FROM properties
ORDER BY created_at DESC
LIMIT 20;
