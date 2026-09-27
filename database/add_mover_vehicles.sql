-- ═══════════════════════════════════════════════════════════════
--  MOVERS: Vehicle details + vehicle photos (Instagram-style grid)
--  Run this in the Supabase SQL Editor once.
-- ═══════════════════════════════════════════════════════════════

-- 1. Vehicle columns on profiles (movers)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS vehicle_photos TEXT[] NOT NULL DEFAULT '{}';

-- 2. Carry vehicle details + business name from signup metadata into profiles
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
  v_business   TEXT;
  v_vehicle    JSONB;
BEGIN
  v_first_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''), 'Hlala');
  v_last_name  := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''), 'User');
  v_phone      := COALESCE(NEW.raw_user_meta_data->>'phone_number', NEW.phone, '');
  v_raw_role   := LOWER(COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'tenant'));
  v_business   := NULLIF(TRIM(NEW.raw_user_meta_data->>'business_name'), '');

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
      avatar_url,
      business_name,
      vehicle_details
    )
    VALUES (
      NEW.id,
      v_first_name,
      v_last_name,
      NEW.email,
      v_phone,
      v_role,
      NEW.raw_user_meta_data->>'avatar_url',
      v_business,
      COALESCE(NEW.raw_user_meta_data->'vehicle_details', '{}'::jsonb)
    )
    ON CONFLICT (id) DO UPDATE SET
      first_name      = EXCLUDED.first_name,
      last_name       = EXCLUDED.last_name,
      email           = COALESCE(EXCLUDED.email, profiles.email),
      phone_number    = COALESCE(EXCLUDED.phone_number, profiles.phone_number),
      role            = EXCLUDED.role,
      avatar_url      = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
      business_name   = COALESCE(EXCLUDED.business_name, profiles.business_name),
      vehicle_details = CASE
                          WHEN EXCLUDED.vehicle_details <> '{}'::jsonb THEN EXCLUDED.vehicle_details
                          ELSE profiles.vehicle_details
                        END,
      updated_at      = NOW();

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- 3. Allow movers to update their own profile columns (RLS safe default already covers this,
--    but re-assert a permissive own-row policy if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'profiles'
          AND policyname = 'profiles_update_own'
    ) THEN
        CREATE POLICY "profiles_update_own" ON public.profiles
            FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
    END IF;
END $$;
