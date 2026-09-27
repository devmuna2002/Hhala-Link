-- ============================================================
-- Fix RLS Policies for user_follows
-- Run this in Supabase SQL Editor
-- ============================================================

-- Ensure RLS is enabled
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any to prevent conflicts
DROP POLICY IF EXISTS "Anyone can view follows" ON public.user_follows;
DROP POLICY IF EXISTS "Users can follow others" ON public.user_follows;
DROP POLICY IF EXISTS "Users can unfollow others" ON public.user_follows;

-- 1. Anyone can read who follows who
CREATE POLICY "Anyone can view follows" 
ON public.user_follows 
FOR SELECT 
USING (true);

-- 2. Authenticated users can follow someone (insert a row where they are the follower)
CREATE POLICY "Users can follow others" 
ON public.user_follows 
FOR INSERT 
WITH CHECK (auth.uid() = follower_id);

-- 3. Authenticated users can unfollow someone (delete their own follow row)
CREATE POLICY "Users can unfollow others" 
ON public.user_follows 
FOR DELETE 
USING (auth.uid() = follower_id);
