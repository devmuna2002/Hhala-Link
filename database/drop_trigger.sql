-- ============================================================
-- DIAGNOSTIC 3 - IS THE TRIGGER THE PROBLEM?
-- Run this in Supabase SQL Editor
-- ============================================================

-- Drop the trigger completely. 
-- This will temporarily stop profiles from being created automatically, 
-- but it will tell us if the trigger is the thing crashing signups.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
