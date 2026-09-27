-- ============================================================
-- Create the increment_views function to track property views
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION increment_views(property_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE properties
  SET views = COALESCE(views, 0) + 1
  WHERE id = property_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION increment_views(UUID) TO authenticated, anon;
