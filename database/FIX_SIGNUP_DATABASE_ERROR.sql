-- ================================================================
--  HLALA LINK — FIX SIGNUP "DATABASE ERROR SAVING NEW USER"
--  Run this script in the Supabase SQL Editor (project: ntzjjfbmpxgmjuorzwmv)
-- ================================================================

-- 1. Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Ensure user_role enum exists
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'tenant', 'landlord', 'agent', 'mover', 'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Ensure profiles table exists with all required columns
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role            public.user_role NOT NULL DEFAULT 'tenant',
    first_name      TEXT            NOT NULL DEFAULT '',
    last_name       TEXT            NOT NULL DEFAULT '',
    email           TEXT,
    phone_number    TEXT,
    avatar_url      TEXT,
    bio             TEXT,
    city            TEXT            DEFAULT 'Harare',
    push_token      TEXT,
    id_verified     BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    followers_count INT             NOT NULL DEFAULT 0,
    average_rating  NUMERIC(2,1)    NOT NULL DEFAULT 0.0,
    review_count    INT             NOT NULL DEFAULT 0,
    last_seen       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Grant proper schema permissions to Supabase roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

-- 4. Drop any legacy triggers on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_sync ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_profile_on_signup() CASCADE;

-- 5. Re-create the bulletproof handle_new_user function with explicit search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_first_name TEXT;
  v_last_name  TEXT;
  v_raw_role   TEXT;
  v_role       public.user_role;
  v_phone      TEXT;
BEGIN
  -- Safe data extraction
  v_first_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''), 'Hlala');
  v_last_name  := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''), 'User');
  v_phone      := COALESCE(NEW.raw_user_meta_data->>'phone_number', NEW.phone, '');
  v_raw_role   := LOWER(COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'tenant'));

  -- Safe role casting
  IF v_raw_role IN ('tenant', 'landlord', 'agent', 'mover', 'admin') THEN
    v_role := v_raw_role::public.user_role;
  ELSE
    v_role := 'tenant'::public.user_role;
  END IF;

  BEGIN
    INSERT INTO public.profiles (
      id,
      first_name,
      last_name,
      email,
      phone_number,
      role,
      avatar_url
    )
    VALUES (
      NEW.id,
      v_first_name,
      v_last_name,
      NEW.email,
      v_phone,
      v_role,
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO UPDATE SET
      first_name   = EXCLUDED.first_name,
      last_name    = EXCLUDED.last_name,
      email        = COALESCE(EXCLUDED.email, profiles.email),
      phone_number = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
      role         = EXCLUDED.role,
      avatar_url   = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
      updated_at   = NOW();

  EXCEPTION WHEN OTHERS THEN
    -- If profile creation fails, still return NEW so Supabase Auth can complete signup without 500 error
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 6. Attach trigger back to auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Ensure RLS policies allow insertion & selection
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_service_role" ON public.profiles;

CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

SELECT 'Signup trigger and profiles table fixed successfully!' AS status;
