-- ============================================================
-- FINAL FIX: Drop old function and recreate cleanly
-- Run this in Supabase SQL Editor
-- ============================================================

-- Step 1: Drop the old broken trigger and function entirely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Step 2: Recreate the function, always providing non-null values
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_first_name TEXT;
  v_last_name  TEXT;
  v_role       user_role;
BEGIN
  -- Safely extract first_name, never NULL
  v_first_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''), 'Hlala');

  -- Safely extract last_name, never NULL
  v_last_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''), 'User');

  -- Safely cast role, default to 'tenant' if missing or invalid
  BEGIN
    v_role := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'tenant')::user_role;
  EXCEPTION WHEN OTHERS THEN
    v_role := 'tenant'::user_role;
  END;

  -- Insert or update the profile
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    phone_number,
    role,
    avatar_url
  )
  VALUES (
    NEW.id,
    v_first_name,
    v_last_name,
    COALESCE(NEW.raw_user_meta_data->>'phone_number', ''),
    v_role,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name   = EXCLUDED.first_name,
    last_name    = EXCLUDED.last_name,
    phone_number = EXCLUDED.phone_number,
    role         = EXCLUDED.role,
    avatar_url   = EXCLUDED.avatar_url;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Attach the trigger back
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
