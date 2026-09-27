-- ================================================================
--  HLALA LINK — COMPLETE UNIFIED DATABASE SCHEMA (2026 EDITION)
--  Platform  : PostgreSQL 15+ / Supabase
--  Strategy  : Fully Idempotent, High-Performance & Secure
--  Description: Master schema containing all core features:
--               - Auth & Profiles (Multi-Role, Ratings, Followers, Push Tokens)
--               - Subscriptions & Pricing Plans (Paynow Integration)
--               - Property Listings, Image Galleries & Analytics
--               - Saved Properties (Favorites) & Smart Saved Searches
--               - Rental Applications & Verification Flow
--               - Realtime Chat (Unique 1-on-1 Conversations & Messages)
--               - Movers & Freight Marketplace (Bids, Bookings & Reviews)
--               - Smart Automated Notifications (Follows, Likes, Price Drops, Bookings)
--               - Public Contact Submissions & View Logs
--               - Row Level Security (RLS) & Storage Buckets
-- ================================================================

-- ── 1. EXTENSIONS ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Trigram full-text & fuzzy search
CREATE EXTENSION IF NOT EXISTS "unaccent";       -- Accent-insensitive searching

-- ═══════════════════════════════════════════════════════════════
--  2. ENUMS & CUSTOM TYPES (Idempotent creation)
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'tenant', 'landlord', 'agent', 'mover', 'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE property_type AS ENUM (
    'apartment', 'house', 'cottage', 'studio',
    'townhouse', 'room', 'office', 'shops', 
    'villa', 'stands', 'commercial', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE property_status AS ENUM (
    'available', 'pending', 'rented', 'inactive'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app_status AS ENUM (
    'pending', 'reviewed', 'approved', 'rejected', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM (
    'pending', 'bidded', 'confirmed', 'accepted', 'in_progress', 'completed', 'cancelled', 'declined'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sub_plan AS ENUM (
    'free', 'basic', 'pro', 'enterprise'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sub_status AS ENUM (
    'active', 'expired', 'cancelled', 'pending'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE msg_status AS ENUM (
    'sent', 'delivered', 'read'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
--  3. HELPER FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Helper: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
--  4. TABLE: PROFILES (Extends Supabase auth.users)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role            user_role       NOT NULL DEFAULT 'tenant',
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

-- Ensure all columns exist if upgrading existing tables
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'tenant',
    ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS phone_number TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS bio TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Harare',
    ADD COLUMN IF NOT EXISTS push_token TEXT,
    ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS followers_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS average_rating NUMERIC(2,1) NOT NULL DEFAULT 0.0,
    ADD COLUMN IF NOT EXISTS review_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_profiles_role       ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_city       ON public.profiles(city);
CREATE INDEX IF NOT EXISTS idx_profiles_push_token ON public.profiles(push_token);

-- Grant proper schema permissions to Supabase roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, postgres;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ultra-safe Supabase Auth signup handler with explicit search_path
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
  v_first_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''), 'Hlala');
  v_last_name  := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''), 'User');
  v_phone      := COALESCE(NEW.raw_user_meta_data->>'phone_number', NEW.phone, '');
  v_raw_role   := LOWER(COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), ''), 'tenant'));

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
    RAISE WARNING 'handle_new_user error: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Full name profile helper view
DROP VIEW IF EXISTS public.profiles_full CASCADE;
CREATE VIEW public.profiles_full AS
    SELECT 
        id, role, first_name, last_name, email, phone_number, 
        avatar_url, bio, city, push_token, id_verified, is_active, 
        followers_count, average_rating, review_count, last_seen,
        created_at, updated_at,
        (TRIM(first_name || ' ' || last_name)) AS full_name 
    FROM public.profiles;

-- ═══════════════════════════════════════════════════════════════
--  5. TABLE: USER FOLLOWS & RATINGS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_follows (
    follower_id     UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    following_id    UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower  ON public.user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON public.user_follows(following_id);

CREATE OR REPLACE FUNCTION update_followers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles
    SET followers_count = COALESCE(followers_count, 0) + 1
    WHERE id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
    SET followers_count = GREATEST(COALESCE(followers_count, 0) - 1, 0)
    WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_followers_count ON public.user_follows;
CREATE TRIGGER trg_update_followers_count
AFTER INSERT OR DELETE ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION update_followers_count();

-- User Reviews (Landlords, Tenants & Agents review each other)
CREATE TABLE IF NOT EXISTS public.user_reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reviewee_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating          NUMERIC(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
    body            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(reviewer_id, reviewee_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reviews_reviewee ON public.user_reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_user_reviews_reviewer ON public.user_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION update_profile_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE public.profiles
    SET 
      average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM public.user_reviews WHERE reviewee_id = NEW.reviewee_id), 0.0),
      review_count = (SELECT COUNT(*) FROM public.user_reviews WHERE reviewee_id = NEW.reviewee_id)
    WHERE id = NEW.reviewee_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
    SET 
      average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM public.user_reviews WHERE reviewee_id = OLD.reviewee_id), 0.0),
      review_count = (SELECT COUNT(*) FROM public.user_reviews WHERE reviewee_id = OLD.reviewee_id)
    WHERE id = OLD.reviewee_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_profile_rating ON public.user_reviews;
CREATE TRIGGER trg_update_profile_rating
AFTER INSERT OR UPDATE OR DELETE ON public.user_reviews
FOR EACH ROW EXECUTE FUNCTION update_profile_rating();

-- ═══════════════════════════════════════════════════════════════
--  6. SUBSCRIPTION PLANS & USER SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    plan            sub_plan        PRIMARY KEY,
    price_usd       NUMERIC(8,2)    NOT NULL,
    max_listings    INT             NOT NULL,
    features        TEXT[]          NOT NULL DEFAULT '{}'
);

INSERT INTO public.subscription_plans (plan, price_usd, max_listings, features) VALUES
    ('free',        0,    1, ARRAY['1 active listing', 'Standard search visibility', 'In-app chat']),
    ('basic',       5,    5, ARRAY['5 active listings', 'Email support', 'Verified badge', 'Standard analytics']),
    ('pro',        15,   20, ARRAY['20 active listings', 'Priority search placement', 'Advanced analytics', 'Instant notifications']),
    ('enterprise', 40,  999, ARRAY['Unlimited listings', 'Dedicated account manager', 'API Access', 'Featured badge boost'])
ON CONFLICT (plan) DO UPDATE SET
    price_usd    = EXCLUDED.price_usd,
    max_listings = EXCLUDED.max_listings,
    features     = EXCLUDED.features;

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan              sub_plan        NOT NULL DEFAULT 'free',
    status            sub_status      NOT NULL DEFAULT 'active',
    price_usd         NUMERIC(10,2)   NOT NULL DEFAULT 0,
    starts_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    max_listings      INT             NOT NULL DEFAULT 1,
    auto_renew        BOOLEAN         NOT NULL DEFAULT FALSE,
    paynow_reference  TEXT,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status, expires_at);

-- ═══════════════════════════════════════════════════════════════
--  7. TABLE: PROPERTIES (Real Estate Listings)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.properties (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Overview
    title           TEXT            NOT NULL,
    description     TEXT,
    property_type   property_type   NOT NULL DEFAULT 'apartment',
    status          property_status NOT NULL DEFAULT 'available',

    -- Location
    address         TEXT            NOT NULL,
    suburb          TEXT,
    city            TEXT            NOT NULL DEFAULT 'Harare',
    province        TEXT,
    country         TEXT            NOT NULL DEFAULT 'Zimbabwe',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,

    -- Specs
    bedrooms        SMALLINT        NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
    bathrooms       SMALLINT        NOT NULL DEFAULT 1 CHECK (bathrooms >= 0),
    area_sqm        NUMERIC(8,2),
    floor_level     SMALLINT,
    parking_spots   SMALLINT        NOT NULL DEFAULT 0,
    is_furnished    BOOLEAN         NOT NULL DEFAULT FALSE,
    pets_allowed    BOOLEAN         NOT NULL DEFAULT FALSE,
    available_from  DATE,

    -- Pricing (USD)
    rent_usd        NUMERIC(10,2)   NOT NULL CHECK (rent_usd > 0),
    deposit_usd     NUMERIC(10,2),
    utilities_inc   BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Amenities
    has_wifi        BOOLEAN         NOT NULL DEFAULT FALSE,
    has_pool        BOOLEAN         NOT NULL DEFAULT FALSE,
    has_gym         BOOLEAN         NOT NULL DEFAULT FALSE,
    has_borehole    BOOLEAN         NOT NULL DEFAULT FALSE,
    has_solar       BOOLEAN         NOT NULL DEFAULT FALSE,
    has_security    BOOLEAN         NOT NULL DEFAULT FALSE,
    has_generator   BOOLEAN         NOT NULL DEFAULT FALSE,
    has_water_tank  BOOLEAN         NOT NULL DEFAULT FALSE,
    has_garden      BOOLEAN         NOT NULL DEFAULT FALSE,

    -- Analytics & Promotion
    views           INT             NOT NULL DEFAULT 0,
    featured        BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Ensure all columns exist
ALTER TABLE public.properties
    ADD COLUMN IF NOT EXISTS suburb TEXT,
    ADD COLUMN IF NOT EXISTS has_water_tank BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_garden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS water_source TEXT;

-- Full-text & Trigram Search Indexes
CREATE INDEX IF NOT EXISTS idx_properties_search ON public.properties USING gin(
    to_tsvector('english',
        coalesce(title,'') || ' ' ||
        coalesce(description,'') || ' ' ||
        coalesce(city,'') || ' ' ||
        coalesce(suburb,'') || ' ' ||
        coalesce(address,'')
    )
);
CREATE INDEX IF NOT EXISTS idx_properties_city    ON public.properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_suburb  ON public.properties(suburb);
CREATE INDEX IF NOT EXISTS idx_properties_status  ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_rent    ON public.properties(rent_usd);
CREATE INDEX IF NOT EXISTS idx_properties_owner   ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_type    ON public.properties(property_type);

DROP TRIGGER IF EXISTS properties_updated_at ON public.properties;
CREATE TRIGGER properties_updated_at
    BEFORE UPDATE ON public.properties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Safe RPC to increment property views
CREATE OR REPLACE FUNCTION increment_property_views(prop_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.properties SET views = views + 1 WHERE id = prop_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
--  8. PROPERTY IMAGES & SAVED PROPERTIES & SAVED SEARCHES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.property_images (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id     UUID            NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    storage_path    TEXT            NOT NULL,
    url             TEXT            NOT NULL,
    alt_text        TEXT,
    is_cover        BOOLEAN         NOT NULL DEFAULT FALSE,
    sort_order      SMALLINT        NOT NULL DEFAULT 0,
    uploaded_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON public.property_images(property_id, sort_order);

-- Saved Properties (Favorites)
CREATE TABLE IF NOT EXISTS public.saved_properties (
    user_id         UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    property_id     UUID            NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    saved_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_user     ON public.saved_properties(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_property ON public.saved_properties(property_id);

-- Saved Searches (Property24 / Airbnb Search alerts)
CREATE TABLE IF NOT EXISTS public.saved_searches (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    city            TEXT            NOT NULL DEFAULT 'Harare',
    suburb          TEXT,
    property_type   TEXT,
    max_price       NUMERIC(10,2),
    min_bedrooms    SMALLINT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user  ON public.saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_query ON public.saved_searches(city, suburb, max_price);

-- ═══════════════════════════════════════════════════════════════
--  9. RENTAL APPLICATIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.applications (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id     UUID            NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    applicant_id    UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status          app_status      NOT NULL DEFAULT 'pending',
    message         TEXT,
    move_in_date    DATE,
    monthly_income  NUMERIC(10,2),
    employer        TEXT,
    num_occupants   SMALLINT        NOT NULL DEFAULT 1,
    has_pets        BOOLEAN         NOT NULL DEFAULT FALSE,
    reviewed_at     TIMESTAMPTZ,
    decision_note   TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_property  ON public.applications(property_id);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON public.applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_applications_status    ON public.applications(status);

DROP TRIGGER IF EXISTS applications_updated_at ON public.applications;
CREATE TRIGGER applications_updated_at
    BEFORE UPDATE ON public.applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  10. CHAT & MESSAGING (Conversations & Messages)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.conversations (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_a   UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    participant_b   UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    property_id     UUID            REFERENCES public.properties(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Strict unique index ensuring only 1 thread between any pair of users
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair 
ON public.conversations (LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b));

CREATE INDEX IF NOT EXISTS idx_conversations_a ON public.conversations(participant_a);
CREATE INDEX IF NOT EXISTS idx_conversations_b ON public.conversations(participant_b);

CREATE TABLE IF NOT EXISTS public.messages (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID            NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id       UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    body            TEXT            NOT NULL,
    status          msg_status      NOT NULL DEFAULT 'sent',
    is_edited       BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON public.messages(sender_id);

CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.conversations
    SET last_message_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_update_conversation ON public.messages;
CREATE TRIGGER messages_update_conversation
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- ═══════════════════════════════════════════════════════════════
--  11. MOVERS & FREIGHT MARKETPLACE
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'movers') THEN
        DROP VIEW IF EXISTS public.movers CASCADE;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'mover_bookings') THEN
        DROP VIEW IF EXISTS public.mover_bookings CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.movers (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID            REFERENCES public.profiles(id) ON DELETE CASCADE,
    profile_id      UUID            REFERENCES public.profiles(id) ON DELETE CASCADE,
    company_name    TEXT            NOT NULL,
    description     TEXT,
    city            TEXT            NOT NULL DEFAULT 'Harare',
    service_areas   TEXT[]          NOT NULL DEFAULT '{}',
    vehicle_types   TEXT[]          NOT NULL DEFAULT '{}',
    base_price_usd  NUMERIC(8,2)    NOT NULL DEFAULT 0 CHECK (base_price_usd >= 0),
    price_per_km    NUMERIC(8,2)    DEFAULT 0,
    phone           TEXT            NOT NULL,
    whatsapp        TEXT,
    email           TEXT,
    website         TEXT,
    rating          NUMERIC(3,2)    NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    total_reviews   INT             NOT NULL DEFAULT 0,
    total_jobs      INT             NOT NULL DEFAULT 0,
    is_verified     BOOLEAN         NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    avatar_url      TEXT,
    logo_url        TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Backfill profile_id <-> owner_id link if needed
UPDATE public.movers SET profile_id = owner_id WHERE profile_id IS NULL AND owner_id IS NOT NULL;
UPDATE public.movers SET owner_id = profile_id WHERE owner_id IS NULL AND profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_movers_city   ON public.movers(city);
CREATE INDEX IF NOT EXISTS idx_movers_active ON public.movers(is_active);
CREATE INDEX IF NOT EXISTS idx_movers_owner  ON public.movers(COALESCE(owner_id, profile_id));

DROP TRIGGER IF EXISTS movers_updated_at ON public.movers;
CREATE TRIGGER movers_updated_at
    BEFORE UPDATE ON public.movers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Mover Bookings
CREATE TABLE IF NOT EXISTS public.mover_bookings (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id          UUID            NOT NULL REFERENCES public.movers(id) ON DELETE CASCADE,
    client_id         UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status            TEXT            NOT NULL DEFAULT 'pending',
    bid_amount        NUMERIC(10,2),
    job_details       JSONB           DEFAULT '{}'::jsonb,
    moving_date       DATE,
    pickup_time       TIMESTAMPTZ,
    delivery_time     TIMESTAMPTZ,
    pickup_address    TEXT,
    drop_address      TEXT,
    pickup_city       TEXT            DEFAULT 'Harare',
    drop_city         TEXT            DEFAULT 'Harare',
    distance_km       NUMERIC(8,2),
    estimated_price   NUMERIC(10,2),
    final_price       NUMERIC(10,2),
    items_description TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mover_bookings_mover  ON public.mover_bookings(mover_id);
CREATE INDEX IF NOT EXISTS idx_mover_bookings_client ON public.mover_bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_mover_bookings_status ON public.mover_bookings(status);

DROP TRIGGER IF EXISTS mover_bookings_updated_at ON public.mover_bookings;
CREATE TRIGGER mover_bookings_updated_at
    BEFORE UPDATE ON public.mover_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Mover Reviews
CREATE TABLE IF NOT EXISTS public.mover_reviews (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id        UUID            NOT NULL REFERENCES public.movers(id) ON DELETE CASCADE,
    booking_id      UUID            REFERENCES public.mover_bookings(id) ON DELETE SET NULL,
    reviewer_id     UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rating          INTEGER         NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mover_reviews_mover    ON public.mover_reviews(mover_id);
CREATE INDEX IF NOT EXISTS idx_mover_reviews_reviewer ON public.mover_reviews(reviewer_id);

CREATE OR REPLACE FUNCTION update_mover_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.movers SET
        rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM public.mover_reviews WHERE mover_id = NEW.mover_id), 0),
        total_reviews = (SELECT COUNT(*) FROM public.mover_reviews WHERE mover_id = NEW.mover_id)
    WHERE id = NEW.mover_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_mover_rating ON public.mover_reviews;
CREATE TRIGGER trg_update_mover_rating
    AFTER INSERT OR UPDATE OR DELETE ON public.mover_reviews
    FOR EACH ROW EXECUTE FUNCTION update_mover_rating();

-- Unified Reviews table (for properties, agents, movers)
CREATE TABLE IF NOT EXISTS public.reviews (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id     UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    property_id     UUID            REFERENCES public.properties(id) ON DELETE CASCADE,
    target_user_id  UUID            REFERENCES public.profiles(id)   ON DELETE CASCADE,
    mover_id        UUID            REFERENCES public.movers(id)     ON DELETE CASCADE,
    rating          SMALLINT        NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title           TEXT,
    body            TEXT,
    is_public       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT reviews_one_target CHECK (
        (property_id IS NOT NULL)::int +
        (target_user_id IS NOT NULL)::int +
        (mover_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_reviews_property   ON public.reviews(property_id);
CREATE INDEX IF NOT EXISTS idx_reviews_mover      ON public.reviews(mover_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_user ON public.reviews(target_user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer   ON public.reviews(reviewer_id);

-- ═══════════════════════════════════════════════════════════════
--  12. NOTIFICATIONS & REALTIME ALERTS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.notifications (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type            TEXT            NOT NULL, -- 'mover_booking', 'booking_update', 'follow', 'like', 'message', 'price_drop', 'new_listing', etc.
    actor_id        UUID            REFERENCES public.profiles(id) ON DELETE SET NULL,
    reference_id    TEXT,           -- string representation of UUID for versatility
    title           TEXT            NOT NULL,
    body            TEXT,
    message         TEXT,
    data            JSONB           NOT NULL DEFAULT '{}'::jsonb,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Ensure body and message are always populated seamlessly
CREATE OR REPLACE FUNCTION sync_notification_body_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body IS NULL AND NEW.message IS NOT NULL THEN
    NEW.body := NEW.message;
  ELSIF NEW.message IS NULL AND NEW.body IS NOT NULL THEN
    NEW.message := NEW.body;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notif_text ON public.notifications;
CREATE TRIGGER trg_sync_notif_text
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION sync_notification_body_message();

CREATE INDEX IF NOT EXISTS idx_notifications_user   ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id) WHERE is_read = FALSE;

-- Notification Helper Function
CREATE OR REPLACE FUNCTION create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_actor_id UUID,
    p_reference_id TEXT,
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_notif_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, actor_id, reference_id, title, message, body, data)
    VALUES (p_user_id, p_type, p_actor_id, p_reference_id, p_title, p_message, p_message, p_data)
    RETURNING id INTO v_notif_id;
    RETURN v_notif_id;
END;
$$;

-- ── Trigger: Auto-notify on Follow ──
CREATE OR REPLACE FUNCTION notify_on_follow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_follower_name TEXT;
BEGIN
    SELECT TRIM(first_name || ' ' || last_name) INTO v_follower_name 
    FROM public.profiles WHERE id = NEW.follower_id;

    PERFORM create_notification(
        NEW.following_id, 
        'follow', 
        NEW.follower_id, 
        NEW.follower_id::text,
        'New Follower! 👋',
        COALESCE(NULLIF(v_follower_name, ''), 'Someone') || ' started following you.',
        jsonb_build_object('followerId', NEW.follower_id)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_follow ON public.user_follows;
CREATE TRIGGER trigger_notify_on_follow
    AFTER INSERT ON public.user_follows
    FOR EACH ROW EXECUTE FUNCTION notify_on_follow();

-- ── Trigger: Auto-notify followers on New Listing ──
CREATE OR REPLACE FUNCTION notify_followers_on_listing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, actor_id, reference_id, title, message, body, data)
    SELECT 
        follower_id, 
        'new_listing', 
        NEW.owner_id, 
        NEW.id::text, 
        'New Listing Alert 🏠',
        'An agent you follow posted: ' || NEW.title || ' in ' || NEW.city,
        'An agent you follow posted: ' || NEW.title || ' in ' || NEW.city,
        jsonb_build_object('propertyId', NEW.id, 'city', NEW.city, 'rent', NEW.rent_usd)
    FROM public.user_follows
    WHERE following_id = NEW.owner_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_listing ON public.properties;
CREATE TRIGGER trigger_notify_on_listing
    AFTER INSERT ON public.properties
    FOR EACH ROW EXECUTE FUNCTION notify_followers_on_listing();

-- ── Trigger: Auto-notify on Like / Favorite ──
CREATE OR REPLACE FUNCTION notify_on_favorite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    prop_owner UUID;
    prop_title TEXT;
    liker_name TEXT;
BEGIN
    SELECT owner_id, title INTO prop_owner, prop_title 
    FROM public.properties 
    WHERE id = NEW.property_id;

    IF prop_owner IS NOT NULL AND prop_owner != NEW.user_id THEN
        SELECT TRIM(first_name || ' ' || last_name) INTO liker_name 
        FROM public.profiles WHERE id = NEW.user_id;

        PERFORM create_notification(
            prop_owner, 
            'like', 
            NEW.user_id, 
            NEW.property_id::text, 
            'Property Liked ❤️',
            COALESCE(NULLIF(liker_name, ''), 'Someone') || ' saved your listing "' || prop_title || '".',
            jsonb_build_object('propertyId', NEW.property_id)
        );
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_favorite ON public.saved_properties;
CREATE TRIGGER trigger_notify_on_favorite
    AFTER INSERT ON public.saved_properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_favorite();

-- ── Trigger: Auto-notify on new Message ──
CREATE OR REPLACE FUNCTION notify_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    receiver_id UUID;
    sender_name TEXT;
    v_prop_id UUID;
    v_prop_title TEXT;
    v_prop_image TEXT;
BEGIN
    SELECT 
        CASE 
            WHEN participant_a = NEW.sender_id THEN participant_b 
            ELSE participant_a 
        END,
        property_id
    INTO receiver_id, v_prop_id
    FROM public.conversations 
    WHERE id = NEW.conversation_id;

    SELECT TRIM(first_name || ' ' || last_name) INTO sender_name 
    FROM public.profiles WHERE id = NEW.sender_id;

    IF v_prop_id IS NOT NULL THEN
        SELECT title INTO v_prop_title FROM public.properties WHERE id = v_prop_id;
        SELECT url INTO v_prop_image FROM public.property_images WHERE property_id = v_prop_id ORDER BY is_cover DESC, sort_order ASC LIMIT 1;
    END IF;

    IF receiver_id IS NOT NULL THEN
        PERFORM create_notification(
            receiver_id, 
            'message', 
            NEW.sender_id, 
            NEW.conversation_id::text, 
            'New Message 💬',
            COALESCE(NULLIF(sender_name, ''), 'Someone') || ': ' || LEFT(NEW.body, 80),
            jsonb_build_object(
                'conversationId', NEW.conversation_id,
                'property_id', v_prop_id,
                'property_title', v_prop_title,
                'property_image', v_prop_image,
                'image_url', v_prop_image
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_message ON public.messages;
CREATE TRIGGER trigger_notify_on_message
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION notify_on_message();

-- ── Trigger: Price Drop Alert for Saved Properties ──
CREATE OR REPLACE FUNCTION notify_on_price_drop()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    IF NEW.rent_usd < OLD.rent_usd THEN
        FOR v_tenant_id IN 
            SELECT user_id FROM public.saved_properties WHERE property_id = NEW.id
        LOOP
            PERFORM create_notification(
                v_tenant_id,
                'price_drop',
                NEW.owner_id,
                NEW.id::text,
                'Price Drop Alert! 📉',
                'Rent for "' || NEW.title || '" dropped from $' || OLD.rent_usd::int || ' to $' || NEW.rent_usd::int || '/mo!',
                jsonb_build_object(
                    'propertyId', NEW.id,
                    'oldRent', OLD.rent_usd,
                    'newRent', NEW.rent_usd,
                    'city', NEW.city
                )
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_price_drop ON public.properties;
CREATE TRIGGER trigger_notify_on_price_drop
    AFTER UPDATE OF rent_usd ON public.properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_price_drop();

-- ── Trigger: Saved Searches Match Alert ──
CREATE OR REPLACE FUNCTION notify_on_saved_search_match()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_match RECORD;
BEGIN
    IF NEW.status = 'available' THEN
        FOR v_match IN
            SELECT user_id FROM public.saved_searches
            WHERE user_id != NEW.owner_id
              AND (LOWER(city) = LOWER(NEW.city))
              AND (suburb IS NULL OR suburb = '' OR LOWER(suburb) = LOWER(COALESCE(NEW.suburb, '')))
              AND (max_price IS NULL OR NEW.rent_usd <= max_price)
        LOOP
            PERFORM create_notification(
                v_match.user_id,
                'search_match',
                NEW.owner_id,
                NEW.id::text,
                'New Match For You! 🎯',
                'A new property in ' || NEW.city || ' matches your saved search: "' || NEW.title || '" ($' || NEW.rent_usd::int || '/mo)',
                jsonb_build_object('propertyId', NEW.id, 'rent', NEW.rent_usd, 'city', NEW.city)
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_search_match ON public.properties;
CREATE TRIGGER trigger_notify_on_search_match
    AFTER INSERT ON public.properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_saved_search_match();

-- ═══════════════════════════════════════════════════════════════
--  13. MOVERS RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Create a mover booking
CREATE OR REPLACE FUNCTION create_mover_booking(
    requester_id UUID, mover_id UUID, job_details JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_booking_id UUID;
    v_mover_profile UUID;
BEGIN
    SELECT COALESCE(profile_id, owner_id) INTO v_mover_profile FROM public.movers WHERE id = mover_id;

    INSERT INTO public.mover_bookings (
        client_id, 
        mover_id, 
        status, 
        job_details,
        moving_date,
        pickup_address,
        drop_address,
        estimated_price
    )
    VALUES (
        requester_id, 
        mover_id, 
        'pending', 
        job_details,
        (job_details->>'moving_date')::date,
        job_details->>'pickup_address',
        job_details->>'drop_address',
        (job_details->>'estimated_price')::numeric
    )
    RETURNING id INTO v_booking_id;

    IF v_mover_profile IS NOT NULL THEN
        PERFORM create_notification(
            v_mover_profile, 
            'mover_booking', 
            requester_id, 
            v_booking_id::text, 
            'New Moving Request 🚚',
            'You have received a new move request.',
            jsonb_build_object('bookingId', v_booking_id)
        );
    END IF;

    UPDATE public.movers SET total_jobs = total_jobs + 1 WHERE id = mover_id;

    RETURN v_booking_id;
END;
$$;

-- Place a bid on a booking
CREATE OR REPLACE FUNCTION place_bid(
    booking_id UUID, mover_id UUID, amount NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE 
    v_client UUID;
    v_mover_name TEXT;
BEGIN
    SELECT client_id INTO v_client FROM public.mover_bookings WHERE id = booking_id;
    SELECT company_name INTO v_mover_name FROM public.movers WHERE id = mover_id;

    UPDATE public.mover_bookings 
    SET status = 'bidded', bid_amount = amount, updated_at = NOW()
    WHERE id = booking_id;

    IF v_client IS NOT NULL THEN
        PERFORM create_notification(
            v_client, 
            'booking_update', 
            NULL, 
            booking_id::text, 
            'Bid Received! 💰',
            COALESCE(v_mover_name, 'A mover') || ' offered a bid of $' || amount::int || ' for your move.',
            jsonb_build_object('bookingId', booking_id, 'bidAmount', amount)
        );
    END IF;
END;
$$;

-- Accept a booking
CREATE OR REPLACE FUNCTION accept_booking(
    booking_id UUID, mover_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE 
    v_client UUID;
    v_mover_name TEXT;
BEGIN
    SELECT client_id INTO v_client FROM public.mover_bookings WHERE id = booking_id;
    SELECT company_name INTO v_mover_name FROM public.movers WHERE id = mover_id;

    UPDATE public.mover_bookings 
    SET status = 'accepted', updated_at = NOW()
    WHERE id = booking_id;

    IF v_client IS NOT NULL THEN
        PERFORM create_notification(
            v_client, 
            'booking_update', 
            NULL, 
            booking_id::text, 
            'Move Accepted! ✅',
            COALESCE(v_mover_name, 'The mover') || ' has accepted your booking request.',
            jsonb_build_object('bookingId', booking_id)
        );
    END IF;
END;
$$;

-- Update booking status
CREATE OR REPLACE FUNCTION update_booking_status(
    booking_id UUID, new_status TEXT, extra_data JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_client UUID;
    v_mover_profile UUID;
    v_mover_id UUID;
BEGIN
    SELECT client_id, mover_id INTO v_client, v_mover_id FROM public.mover_bookings WHERE id = booking_id;
    SELECT COALESCE(profile_id, owner_id) INTO v_mover_profile FROM public.movers WHERE id = v_mover_id;

    UPDATE public.mover_bookings 
    SET status = new_status, updated_at = NOW()
    WHERE id = booking_id;

    IF v_client IS NOT NULL THEN
        PERFORM create_notification(
            v_client, 
            'booking_update', 
            NULL, 
            booking_id::text, 
            'Booking Status Updated',
            'Your move booking is now ' || initcap(new_status) || '.',
            jsonb_build_object('bookingId', booking_id, 'status', new_status)
        );
    END IF;

    IF v_mover_profile IS NOT NULL THEN
        PERFORM create_notification(
            v_mover_profile, 
            'booking_update', 
            NULL, 
            booking_id::text, 
            'Booking Status Updated',
            'Move booking status updated to ' || initcap(new_status) || '.',
            jsonb_build_object('bookingId', booking_id, 'status', new_status)
        );
    END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
--  14. CONTACT FORM & ANALYTICS VIEW LOGS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.contact_submissions (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT            NOT NULL,
    email           TEXT            NOT NULL,
    subject         TEXT,
    message         TEXT            NOT NULL,
    ip_address      TEXT,
    is_resolved     BOOLEAN         NOT NULL DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_resolved ON public.contact_submissions(is_resolved, created_at DESC);

CREATE TABLE IF NOT EXISTS public.property_view_logs (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id     UUID            NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
    viewer_id       UUID            REFERENCES public.profiles(id) ON DELETE SET NULL,
    ip_hash         TEXT,
    viewed_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_view_logs_property ON public.property_view_logs(property_id, viewed_at DESC);

-- ═══════════════════════════════════════════════════════════════
--  15. ROW LEVEL SECURITY (RLS) POLICIES
-- ═══════════════════════════════════════════════════════════════

-- Profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_all"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own"  ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_delete_own" ON public.profiles FOR DELETE USING (auth.uid() = id);

-- User Follows
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_follows_select_all" ON public.user_follows;
DROP POLICY IF EXISTS "user_follows_insert_own" ON public.user_follows;
DROP POLICY IF EXISTS "user_follows_delete_own" ON public.user_follows;
CREATE POLICY "user_follows_select_all" ON public.user_follows FOR SELECT USING (true);
CREATE POLICY "user_follows_insert_own" ON public.user_follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "user_follows_delete_own" ON public.user_follows FOR DELETE USING (auth.uid() = follower_id);

-- User Reviews
ALTER TABLE public.user_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_reviews_select_all" ON public.user_reviews;
DROP POLICY IF EXISTS "user_reviews_insert_own" ON public.user_reviews;
DROP POLICY IF EXISTS "user_reviews_update_own" ON public.user_reviews;
DROP POLICY IF EXISTS "user_reviews_delete_own" ON public.user_reviews;
CREATE POLICY "user_reviews_select_all" ON public.user_reviews FOR SELECT USING (true);
CREATE POLICY "user_reviews_insert_own" ON public.user_reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);
CREATE POLICY "user_reviews_update_own" ON public.user_reviews FOR UPDATE USING (auth.uid() = reviewer_id);
CREATE POLICY "user_reviews_delete_own" ON public.user_reviews FOR DELETE USING (auth.uid() = reviewer_id);

-- Subscription Plans & Subscriptions
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_plans_public_read" ON public.subscription_plans;
CREATE POLICY "sub_plans_public_read" ON public.subscription_plans FOR SELECT USING (true);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_insert_own" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subscriptions_update_own" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- Properties
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "properties_select_active" ON public.properties;
DROP POLICY IF EXISTS "properties_all_owner"     ON public.properties;
CREATE POLICY "properties_select_active" ON public.properties FOR SELECT USING (status != 'inactive' OR auth.uid() = owner_id);
CREATE POLICY "properties_all_owner"     ON public.properties FOR ALL USING (auth.uid() = owner_id);

-- Property Images
ALTER TABLE public.property_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_images_select_all" ON public.property_images;
DROP POLICY IF EXISTS "property_images_owner_all"  ON public.property_images;
CREATE POLICY "property_images_select_all" ON public.property_images FOR SELECT USING (true);
CREATE POLICY "property_images_owner_all"  ON public.property_images FOR ALL
    USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()));

-- Saved Properties
ALTER TABLE public.saved_properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_all_own" ON public.saved_properties;
CREATE POLICY "saved_all_own" ON public.saved_properties FOR ALL USING (auth.uid() = user_id);

-- Saved Searches
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saved_searches_all_own" ON public.saved_searches;
CREATE POLICY "saved_searches_all_own" ON public.saved_searches FOR ALL USING (auth.uid() = user_id);

-- Rental Applications
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apps_select_applicant" ON public.applications;
DROP POLICY IF EXISTS "apps_select_owner"     ON public.applications;
DROP POLICY IF EXISTS "apps_insert_tenant"    ON public.applications;
DROP POLICY IF EXISTS "apps_update_tenant"    ON public.applications;
DROP POLICY IF EXISTS "apps_update_owner"     ON public.applications;
CREATE POLICY "apps_select_applicant" ON public.applications FOR SELECT USING (auth.uid() = applicant_id);
CREATE POLICY "apps_select_owner"     ON public.applications FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()));
CREATE POLICY "apps_insert_tenant"    ON public.applications FOR INSERT WITH CHECK (auth.uid() = applicant_id);
CREATE POLICY "apps_update_tenant"    ON public.applications FOR UPDATE USING (auth.uid() = applicant_id);
CREATE POLICY "apps_update_owner"     ON public.applications FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()));

-- Conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "convos_select_participants" ON public.conversations;
DROP POLICY IF EXISTS "convos_insert_participants" ON public.conversations;
CREATE POLICY "convos_select_participants" ON public.conversations FOR SELECT
    USING (auth.uid() = participant_a OR auth.uid() = participant_b);
CREATE POLICY "convos_insert_participants" ON public.conversations FOR INSERT
    WITH CHECK (auth.uid() = participant_a OR auth.uid() = participant_b);

-- Messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_participants" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_sender"       ON public.messages;
CREATE POLICY "messages_select_participants" ON public.messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.conversations c 
        WHERE c.id = conversation_id AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    ));
CREATE POLICY "messages_insert_sender" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "messages_update_sender" ON public.messages;
CREATE POLICY "messages_update_sender" ON public.messages FOR UPDATE
    USING (auth.uid() = sender_id) WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
CREATE POLICY "messages_delete_sender" ON public.messages FOR DELETE USING (auth.uid() = sender_id);

-- Movers
ALTER TABLE public.movers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movers_select_all" ON public.movers;
DROP POLICY IF EXISTS "movers_manage_own" ON public.movers;
CREATE POLICY "movers_select_all" ON public.movers FOR SELECT USING (true);
CREATE POLICY "movers_manage_own" ON public.movers FOR ALL 
    USING (auth.uid() = owner_id OR auth.uid() = profile_id);

-- Mover Bookings
ALTER TABLE public.mover_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mover_bookings_select_client" ON public.mover_bookings;
DROP POLICY IF EXISTS "mover_bookings_select_mover"  ON public.mover_bookings;
DROP POLICY IF EXISTS "mover_bookings_insert_client" ON public.mover_bookings;
DROP POLICY IF EXISTS "mover_bookings_update_both"   ON public.mover_bookings;
CREATE POLICY "mover_bookings_select_client" ON public.mover_bookings FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "mover_bookings_select_mover"  ON public.mover_bookings FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.movers m WHERE m.id = mover_id AND (m.owner_id = auth.uid() OR m.profile_id = auth.uid())));
CREATE POLICY "mover_bookings_insert_client" ON public.mover_bookings FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "mover_bookings_update_both"   ON public.mover_bookings FOR UPDATE
    USING (
        auth.uid() = client_id OR
        EXISTS (SELECT 1 FROM public.movers m WHERE m.id = mover_id AND (m.owner_id = auth.uid() OR m.profile_id = auth.uid()))
    );

-- Mover Reviews
ALTER TABLE public.mover_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mover_reviews_select_all" ON public.mover_reviews;
DROP POLICY IF EXISTS "mover_reviews_insert_own" ON public.mover_reviews;
CREATE POLICY "mover_reviews_select_all" ON public.mover_reviews FOR SELECT USING (true);
CREATE POLICY "mover_reviews_insert_own" ON public.mover_reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- Unified Reviews
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_select_public" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert_auth"   ON public.reviews;
DROP POLICY IF EXISTS "reviews_update_own"    ON public.reviews;
DROP POLICY IF EXISTS "reviews_delete_own"    ON public.reviews;
CREATE POLICY "reviews_select_public" ON public.reviews FOR SELECT USING (is_public = true);
CREATE POLICY "reviews_insert_auth"   ON public.reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);
CREATE POLICY "reviews_update_own"    ON public.reviews FOR UPDATE USING (auth.uid() = reviewer_id);
CREATE POLICY "reviews_delete_own"    ON public.reviews FOR DELETE USING (auth.uid() = reviewer_id);

-- Notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifs_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifs_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifs_insert_all" ON public.notifications;
CREATE POLICY "notifs_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifs_insert_all" ON public.notifications FOR INSERT WITH CHECK (true);

-- Contact Submissions & View Logs
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contact_insert_anon" ON public.contact_submissions;
CREATE POLICY "contact_insert_anon" ON public.contact_submissions FOR INSERT WITH CHECK (true);

ALTER TABLE public.property_view_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "view_logs_insert_anon"  ON public.property_view_logs;
DROP POLICY IF EXISTS "view_logs_select_owner" ON public.property_view_logs;
CREATE POLICY "view_logs_insert_anon"  ON public.property_view_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "view_logs_select_owner" ON public.property_view_logs FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
--  16. SUPABASE REALTIME SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.applications; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.mover_bookings; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN others THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
--  17. VIEWS FOR ADMIN & MOBILE CLIENTS
-- ═══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_active_properties CASCADE;
CREATE VIEW public.v_active_properties AS
SELECT
    p.*,
    TRIM(pr.first_name || ' ' || pr.last_name) AS owner_name,
    pr.phone_number AS owner_phone,
    pr.avatar_url   AS owner_avatar,
    pr.id_verified  AS owner_verified
FROM public.properties p
JOIN public.profiles pr ON pr.id = p.owner_id
WHERE p.status = 'available';

DROP VIEW IF EXISTS public.v_active_movers CASCADE;
CREATE VIEW public.v_active_movers AS
SELECT
    m.*,
    TRIM(pr.first_name || ' ' || pr.last_name) AS owner_name,
    pr.phone_number AS owner_phone
FROM public.movers m
JOIN public.profiles pr ON pr.id = COALESCE(m.owner_id, m.profile_id)
WHERE m.is_active = true;

-- ═══════════════════════════════════════════════════════════════
--  18. STORAGE BUCKETS CONFIGURATION
-- ═══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('avatars', 'avatars', true),
    ('properties', 'properties', true),
    ('movers', 'movers', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for all 3 buckets
DROP POLICY IF EXISTS "Public Read Avatars" ON storage.objects;
CREATE POLICY "Public Read Avatars" ON storage.objects FOR SELECT USING (bucket_id IN ('avatars', 'properties', 'movers'));

-- Authenticated uploads for storage
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
CREATE POLICY "Authenticated Upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id IN ('avatars', 'properties', 'movers'));

-- Owner updates & deletes for storage objects
DROP POLICY IF EXISTS "Owner Update" ON storage.objects;
CREATE POLICY "Owner Update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id IN ('avatars', 'properties', 'movers'));

DROP POLICY IF EXISTS "Owner Delete" ON storage.objects;
CREATE POLICY "Owner Delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id IN ('avatars', 'properties', 'movers'));

-- ================================================================
--  END OF MASTER SCHEMA
-- ================================================================
