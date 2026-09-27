-- ============================================================
-- Add user rating system (Agents and Tenants)
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Create the user_reviews table
CREATE TABLE IF NOT EXISTS user_reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  reviewer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reviewee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reviewer_id, reviewee_id) -- One review per user pair
);

-- 2. Add average_rating and review_count to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(2, 1) DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS review_count INT DEFAULT 0;

-- 3. Create a function to update the profile's average rating automatically
CREATE OR REPLACE FUNCTION update_profile_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE profiles
    SET 
      average_rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM user_reviews WHERE reviewee_id = NEW.reviewee_id),
      review_count = (SELECT COUNT(*) FROM user_reviews WHERE reviewee_id = NEW.reviewee_id)
    WHERE id = NEW.reviewee_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles
    SET 
      average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM user_reviews WHERE reviewee_id = OLD.reviewee_id), 0.0),
      review_count = (SELECT COUNT(*) FROM user_reviews WHERE reviewee_id = OLD.reviewee_id)
    WHERE id = OLD.reviewee_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the trigger on user_reviews
DROP TRIGGER IF EXISTS trg_update_profile_rating ON user_reviews;
CREATE TRIGGER trg_update_profile_rating
AFTER INSERT OR UPDATE OR DELETE ON user_reviews
FOR EACH ROW
EXECUTE FUNCTION update_profile_rating();

-- 5. Backfill existing profile reviews (if any exist)
UPDATE profiles p
SET 
  average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM user_reviews r WHERE r.reviewee_id = p.id), 0.0),
  review_count = (SELECT COUNT(*) FROM user_reviews r WHERE r.reviewee_id = p.id);
