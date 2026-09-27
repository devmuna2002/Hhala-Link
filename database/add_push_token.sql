-- Add push_token column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Index it for performance
CREATE INDEX IF NOT EXISTS idx_profiles_push_token ON profiles(push_token);
