-- ================================================================
-- ADD LAST SEEN SUPPORT
-- Run this in your Supabase SQL Editor to track user activity.
-- ================================================================

-- 1. Add last_seen column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();

-- 2. Update the helper view to include last_seen
DROP VIEW IF EXISTS profiles_full CASCADE;
CREATE VIEW profiles_full AS
    SELECT 
        id, role, first_name, last_name, phone_number, 
        avatar_url, bio, city, id_verified, is_active, 
        created_at, updated_at, last_seen,
        first_name || ' ' || last_name AS full_name
    FROM profiles;
