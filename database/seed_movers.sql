-- ═══════════════════════════════════════════════════════════════
--  HLALA LINK — SEED MOVER MARKETPLACE
--  Run this in the Supabase SQL Editor once (as postgres).
--
--  Creates 6 real mover accounts (auth.users + profiles via the
--  existing handle_new_user trigger + movers rows) so the site and
--  app stop falling back to hardcoded "fake" movers.
--
--  Each owner can even log in with the password below and update
--  their own mover profile/listing from the app.
--    Email:  {see list}   Password:  HLala@Mover1
--
--  Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- 1. Ensure the movers table is complete regardless of migration order
ALTER TABLE public.movers
    ADD COLUMN IF NOT EXISTS owner_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS price_per_km  NUMERIC(8,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS phone         TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp      TEXT,
    ADD COLUMN IF NOT EXISTS email         TEXT,
    ADD COLUMN IF NOT EXISTS website       TEXT,
    ADD COLUMN IF NOT EXISTS total_jobs    INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS avatar_url    TEXT,
    ADD COLUMN IF NOT EXISTS logo_url      TEXT,
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Mover owner auth accounts
--    (the handle_new_user trigger creates the matching profile row)
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, phone
)
VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0001-4000-8000-000000000001',
    'authenticated', 'authenticated',
    'swift.relocations@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Tafadzwa","last_name":"Mambo","role":"mover","business_name":"Swift Relocations","phone_number":"+263 77 111 2222","city":"Harare","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 111 2222'
),
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0002-4000-8000-000000000002',
    'authenticated', 'authenticated',
    'zimmove.pros@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Nkosana","last_name":"Dube","role":"mover","business_name":"ZimMove Pros","phone_number":"+263 77 333 4444","city":"Bulawayo","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 333 4444'
),
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0003-4000-8000-000000000003',
    'authenticated', 'authenticated',
    'national.movers@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Faith","last_name":"Chirwa","role":"mover","business_name":"National Movers","phone_number":"+263 77 555 6666","city":"Harare","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 555 6666'
),
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0004-4000-8000-000000000004',
    'authenticated', 'authenticated',
    'easymove.mutare@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Ruvarashe","last_name":"Ncube","role":"mover","business_name":"EasyMove Mutare","phone_number":"+263 77 777 8888","city":"Mutare","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 777 8888'
),
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0005-4000-8000-000000000005',
    'authenticated', 'authenticated',
    'express.load@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Blessing","last_name":"Tafirenyika","role":"mover","business_name":"Express Load Harare","phone_number":"+263 77 999 0000","city":"Harare","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 999 0000'
),
(
    '00000000-0000-0000-0000-000000000000',
    'a1c9b0d0-0006-4000-8000-000000000006',
    'authenticated', 'authenticated',
    'gweru.transport@hlala.co.zw',
    crypt('HLala@Mover1', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"first_name":"Kudzai","last_name":"Musindo","role":"mover","business_name":"Gweru Transport Co","phone_number":"+263 77 111 3333","city":"Gweru","avatar_url":null}'::jsonb,
    NOW(), NOW(),
    '+263 77 111 3333'
)
ON CONFLICT (id) DO NOTHING;

-- 3. Identity rows so the accounts can refresh sessions/log in cleanly
DO $$
DECLARE
  n UUID;
BEGIN
  IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'id'
  ) THEN
    FOREACH n IN ARRAY ARRAY[
      'a1c9b0d0-0001-4000-8000-000000000001'::uuid,'a1c9b0d0-0002-4000-8000-000000000002'::uuid,
      'a1c9b0d0-0003-4000-8000-000000000003'::uuid,'a1c9b0d0-0004-4000-8000-000000000004'::uuid,
      'a1c9b0d0-0005-4000-8000-000000000005'::uuid,'a1c9b0d0-0006-4000-8000-000000000006'::uuid
    ]
    LOOP
      INSERT INTO auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      )
      VALUES (
        n, n, n,
        jsonb_build_object('sub', n::text, 'email',
          CASE n
            WHEN 'a1c9b0d0-0001-4000-8000-000000000001' THEN 'swift.relocations@hlala.co.zw'
            WHEN 'a1c9b0d0-0002-4000-8000-000000000002' THEN 'zimmove.pros@hlala.co.zw'
            WHEN 'a1c9b0d0-0003-4000-8000-000000000003' THEN 'national.movers@hlala.co.zw'
            WHEN 'a1c9b0d0-0004-4000-8000-000000000004' THEN 'easymove.mutare@hlala.co.zw'
            WHEN 'a1c9b0d0-0005-4000-8000-000000000005' THEN 'express.load@hlala.co.zw'
            ELSE 'gweru.transport@hlala.co.zw'
          END),
        'email', NOW(), NOW(), NOW()
      )
      ON CONFLICT (provider_id, provider) DO NOTHING;
    END LOOP;
  ELSE
    FOREACH n IN ARRAY ARRAY[
      'a1c9b0d0-0001-4000-8000-000000000001'::uuid,'a1c9b0d0-0002-4000-8000-000000000002'::uuid,
      'a1c9b0d0-0003-4000-8000-000000000003'::uuid,'a1c9b0d0-0004-4000-8000-000000000004'::uuid,
      'a1c9b0d0-0005-4000-8000-000000000005'::uuid,'a1c9b0d0-0006-4000-8000-000000000006'::uuid
    ]
    LOOP
      INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      )
      VALUES (
        n, n,
        jsonb_build_object('sub', n::text, 'email',
          CASE n
            WHEN 'a1c9b0d0-0001-4000-8000-000000000001' THEN 'swift.relocations@hlala.co.zw'
            WHEN 'a1c9b0d0-0002-4000-8000-000000000002' THEN 'zimmove.pros@hlala.co.zw'
            WHEN 'a1c9b0d0-0003-4000-8000-000000000003' THEN 'national.movers@hlala.co.zw'
            WHEN 'a1c9b0d0-0004-4000-8000-000000000004' THEN 'easymove.mutare@hlala.co.zw'
            WHEN 'a1c9b0d0-0005-4000-8000-000000000005' THEN 'express.load@hlala.co.zw'
            ELSE 'gweru.transport@hlala.co.zw'
          END),
        'email', NOW(), NOW(), NOW()
      )
      ON CONFLICT (provider_id, provider) DO NOTHING;
    END LOOP;
  END IF;
END $$;

-- 4. Mover marketplace listings (owner + profile link both set)
INSERT INTO public.movers (
    id, owner_id, profile_id, company_name, description, city,
    service_areas, vehicle_types, base_price_usd, price_per_km,
    phone, whatsapp, email, website,
    rating, total_reviews, total_jobs, is_verified, is_active
)
VALUES
(
    'a1c9b0d0-0001-4000-8000-000000000001',
    'a1c9b0d0-0001-4000-8000-000000000001',
    'a1c9b0d0-0001-4000-8000-000000000001',
    'Swift Relocations',
    'Harare''s premier moving company with modern fleet and professional handlers.',
    'Harare', ARRAY['Harare','Chitungwiza'], ARRAY['bakkie','truck'],
    80, 2.50, '+263 77 111 2222', '+263 77 111 2222',
    'swift.relocations@hlala.co.zw', 'https://swiftrelocations.co.zw',
    4.9, 128, 210, TRUE, TRUE
),
(
    'a1c9b0d0-0002-4000-8000-000000000002',
    'a1c9b0d0-0002-4000-8000-000000000002',
    'a1c9b0d0-0002-4000-8000-000000000002',
    'ZimMove Pros',
    'Bulawayo-based movers specializing in residential and commercial relocations.',
    'Bulawayo', ARRAY['Bulawayo','Gweru'], ARRAY['van','truck'],
    60, 2.00, '+263 77 333 4444', '+263 77 333 4444',
    'zimmove.pros@hlala.co.zw', 'https://zimmovepros.co.zw',
    4.7, 94, 156, TRUE, TRUE
),
(
    'a1c9b0d0-0003-4000-8000-000000000003',
    'a1c9b0d0-0003-4000-8000-000000000003',
    'a1c9b0d0-0003-4000-8000-000000000003',
    'National Movers',
    'Zimbabwe-wide moving services with insured cargo and experienced teams.',
    'Harare', ARRAY['Harare','Mutare','Gweru','Bulawayo'], ARRAY['truck','trailer'],
    100, 3.00, '+263 77 555 6666', '+263 77 555 6666',
    'national.movers@hlala.co.zw', 'https://nationalmovers.co.zw',
    4.8, 210, 380, TRUE, TRUE
),
(
    'a1c9b0d0-0004-4000-8000-000000000004',
    'a1c9b0d0-0004-4000-8000-000000000004',
    'a1c9b0d0-0004-4000-8000-000000000004',
    'EasyMove Mutare',
    'Affordable movers serving Mutare and eastern Zimbabwe.',
    'Mutare', ARRAY['Mutare','Nyanga'], ARRAY['bakkie','van'],
    50, 1.50, '+263 77 777 8888', '+263 77 777 8888',
    'easymove.mutare@hlala.co.zw', 'https://easymovemutare.co.zw',
    4.5, 42, 88, FALSE, TRUE
),
(
    'a1c9b0d0-0005-4000-8000-000000000005',
    'a1c9b0d0-0005-4000-8000-000000000005',
    'a1c9b0d0-0005-4000-8000-000000000005',
    'Express Load Harare',
    'Fast and affordable bakkie hire for small moves and student relocations.',
    'Harare', ARRAY['Harare'], ARRAY['bakkie'],
    40, 1.20, '+263 77 999 0000', '+263 77 999 0000',
    'express.load@hlala.co.zw', 'https://expressload.co.zw',
    4.3, 29, 55, FALSE, TRUE
),
(
    'a1c9b0d0-0006-4000-8000-000000000006',
    'a1c9b0d0-0006-4000-8000-000000000006',
    'a1c9b0d0-0006-4000-8000-000000000006',
    'Gweru Transport Co',
    'Midlands-region movers with full packing and unpacking services.',
    'Gweru', ARRAY['Gweru','Kwekwe'], ARRAY['truck','van'],
    70, 2.20, '+263 77 111 3333', '+263 77 111 3333',
    'gweru.transport@hlala.co.zw', 'https://gwerutransport.co.zw',
    4.6, 58, 122, TRUE, TRUE
)
ON CONFLICT (id) DO UPDATE SET
    company_name   = EXCLUDED.company_name,
    description    = EXCLUDED.description,
    city           = EXCLUDED.city,
    service_areas  = EXCLUDED.service_areas,
    vehicle_types  = EXCLUDED.vehicle_types,
    base_price_usd = EXCLUDED.base_price_usd,
    price_per_km   = EXCLUDED.price_per_km,
    phone          = EXCLUDED.phone,
    whatsapp       = EXCLUDED.whatsapp,
    email          = EXCLUDED.email,
    website        = EXCLUDED.website,
    rating         = EXCLUDED.rating,
    total_reviews  = EXCLUDED.total_reviews,
    total_jobs     = EXCLUDED.total_jobs,
    is_verified    = EXCLUDED.is_verified,
    is_active      = EXCLUDED.is_active;

-- 5. Sync city + verification onto the auto-created profiles
UPDATE public.profiles pr
SET city = m.city, id_verified = TRUE
FROM public.movers m
WHERE m.owner_id = pr.id
  AND (pr.city IS DISTINCT FROM m.city OR pr.id_verified IS DISTINCT FROM TRUE);

-- 6. Verify — should print 6 movers
SELECT m.company_name, m.city, m.rating, m.base_price_usd,
       TRIM(pr.first_name || ' ' || pr.last_name) AS owner_name
FROM public.movers m
JOIN public.profiles pr ON pr.id = COALESCE(m.owner_id, m.profile_id)
WHERE m.is_active = TRUE
ORDER BY m.rating DESC;