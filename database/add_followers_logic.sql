-- ============================================================
-- Add followers_count to profiles and keep it synced
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add the column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS followers_count INT DEFAULT 0;

-- 2. Backfill existing followers (if any)
UPDATE profiles p
SET followers_count = (
  SELECT count(*) FROM user_follows f WHERE f.following_id = p.id
);

-- 3. Create a function to update the count automatically
CREATE OR REPLACE FUNCTION update_followers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles
    SET followers_count = COALESCE(followers_count, 0) + 1
    WHERE id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles
    SET followers_count = GREATEST(COALESCE(followers_count, 0) - 1, 0)
    WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the trigger on user_follows
DROP TRIGGER IF EXISTS trg_update_followers_count ON user_follows;
CREATE TRIGGER trg_update_followers_count
AFTER INSERT OR DELETE ON user_follows
FOR EACH ROW
EXECUTE FUNCTION update_followers_count();
