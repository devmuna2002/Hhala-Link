-- ================================================================
--  HLALA LINK — STANDALONE POSTGRESQL SCHEMA
--  No Supabase dependency — works with plain PostgreSQL 14+
--  Run:  psql -U postgres -d hlala_link -f schema_postgres.sql
-- ================================================================

-- ── EXTENSIONS ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ═══════════════════════════════════════════════════════════════
--  ENUMS
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('tenant','landlord','agent','mover','admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE property_type AS ENUM ('apartment','house','cottage','studio','townhouse','room','office','shops','villa','stands','commercial','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE property_status AS ENUM ('available','pending','rented','inactive','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app_status AS ENUM ('pending','reviewed','approved','rejected','withdrawn'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE booking_status AS ENUM ('pending','bidded','confirmed','accepted','in_progress','completed','cancelled','declined'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sub_plan AS ENUM ('free','basic','pro','enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sub_status AS ENUM ('active','expired','cancelled','pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE msg_status AS ENUM ('sent','delivered','read'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
--  HELPER: Auto-update updated_at
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ═══════════════════════════════════════════════════════════════
--  TABLE: PROFILES (standalone — no auth.users FK)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT            NOT NULL UNIQUE,
    password_hash   TEXT            NOT NULL,
    full_name       TEXT            NOT NULL DEFAULT '',
    role            user_role       NOT NULL DEFAULT 'tenant',
    first_name      TEXT            NOT NULL DEFAULT '',
    last_name       TEXT            NOT NULL DEFAULT '',
    phone_number    TEXT,
    phone           TEXT,
    business_name   TEXT,
    vehicle_details JSONB,
    vehicle_photos  JSONB           NOT NULL DEFAULT '[]',
    approval_status TEXT            NOT NULL DEFAULT 'approved',
    is_approved     BOOLEAN         NOT NULL DEFAULT TRUE,
    approved_at     TIMESTAMPTZ,
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

CREATE INDEX IF NOT EXISTS idx_profiles_role  ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_city  ON profiles(city);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: USER FOLLOWS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_follows (
    follower_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE OR REPLACE FUNCTION update_followers_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET followers_count = COALESCE(followers_count,0)+1 WHERE id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET followers_count = GREATEST(COALESCE(followers_count,0)-1,0) WHERE id = OLD.following_id;
    RETURN OLD;
  END IF; RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_followers_count ON user_follows;
CREATE TRIGGER trg_update_followers_count AFTER INSERT OR DELETE ON user_follows
    FOR EACH ROW EXECUTE FUNCTION update_followers_count();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: SUBSCRIPTION PLANS & SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscription_plans (
    plan            sub_plan        PRIMARY KEY,
    price_usd       NUMERIC(8,2)    NOT NULL,
    max_listings    INT             NOT NULL,
    features        TEXT[]          NOT NULL DEFAULT '{}'
);

INSERT INTO subscription_plans (plan, price_usd, max_listings, features) VALUES
    ('free',        0,    1, ARRAY['1 active listing','Standard search visibility','In-app chat']),
    ('basic',       5,    5, ARRAY['5 active listings','Email support','Verified badge','Standard analytics']),
    ('pro',        15,   20, ARRAY['20 active listings','Priority search placement','Advanced analytics','Instant notifications']),
    ('enterprise', 40,  999, ARRAY['Unlimited listings','Dedicated account manager','API Access','Featured badge boost'])
ON CONFLICT (plan) DO UPDATE SET price_usd=EXCLUDED.price_usd, max_listings=EXCLUDED.max_listings, features=EXCLUDED.features;

CREATE TABLE IF NOT EXISTS subscriptions (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan              sub_plan    NOT NULL DEFAULT 'free',
    status            sub_status  NOT NULL DEFAULT 'active',
    price_usd         NUMERIC(10,2) NOT NULL DEFAULT 0,
    starts_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ,
    max_listings      INT         NOT NULL DEFAULT 1,
    auto_renew        BOOLEAN     NOT NULL DEFAULT FALSE,
    paynow_reference  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status, expires_at);

-- ═══════════════════════════════════════════════════════════════
--  TABLE: PROPERTIES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS properties (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title           TEXT            NOT NULL,
    description     TEXT,
    property_type   property_type   NOT NULL DEFAULT 'apartment',
    listing_type    TEXT            NOT NULL DEFAULT 'rent',
    listing_purpose TEXT            NOT NULL DEFAULT 'rent',
    status          property_status NOT NULL DEFAULT 'available',
    address         TEXT            NOT NULL,
    suburb          TEXT,
    city            TEXT            NOT NULL DEFAULT 'Harare',
    province        TEXT,
    country         TEXT            NOT NULL DEFAULT 'Zimbabwe',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    bedrooms        SMALLINT        NOT NULL DEFAULT 1 CHECK (bedrooms >= 0),
    bathrooms       SMALLINT        NOT NULL DEFAULT 1 CHECK (bathrooms >= 0),
    area_sqm        NUMERIC(8,2),
    floor_level     SMALLINT,
    parking_spots   SMALLINT        NOT NULL DEFAULT 0,
    is_furnished    BOOLEAN         NOT NULL DEFAULT FALSE,
    pets_allowed    BOOLEAN         NOT NULL DEFAULT FALSE,
    available_from  DATE,
    rent_usd        NUMERIC(10,2)   CHECK (rent_usd IS NULL OR rent_usd > 0),
    sale_price_usd  NUMERIC(10,2)   CHECK (sale_price_usd IS NULL OR sale_price_usd > 0),
    price           NUMERIC(10,2)   NOT NULL DEFAULT 0,
    currency        TEXT            NOT NULL DEFAULT 'USD',
    images          JSONB           NOT NULL DEFAULT '[]',
    amenities       JSONB           NOT NULL DEFAULT '[]',
    deposit_usd     NUMERIC(10,2),
    utilities_inc   BOOLEAN         NOT NULL DEFAULT FALSE,
    has_wifi        BOOLEAN         NOT NULL DEFAULT FALSE,
    has_pool        BOOLEAN         NOT NULL DEFAULT FALSE,
    has_gym         BOOLEAN         NOT NULL DEFAULT FALSE,
    has_borehole    BOOLEAN         NOT NULL DEFAULT FALSE,
    has_solar       BOOLEAN         NOT NULL DEFAULT FALSE,
    has_security    BOOLEAN         NOT NULL DEFAULT FALSE,
    has_generator   BOOLEAN         NOT NULL DEFAULT FALSE,
    has_water_tank  BOOLEAN         NOT NULL DEFAULT FALSE,
    has_garden      BOOLEAN         NOT NULL DEFAULT FALSE,
    views           INT             NOT NULL DEFAULT 0,
    featured        BOOLEAN         NOT NULL DEFAULT FALSE,
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_city   ON properties(city);
CREATE INDEX IF NOT EXISTS idx_properties_suburb ON properties(suburb);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_rent   ON properties(rent_usd);
CREATE INDEX IF NOT EXISTS idx_properties_owner  ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_type   ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_search ON properties USING gin(
    to_tsvector('english',
        coalesce(title,'') || ' ' || coalesce(description,'') || ' ' ||
        coalesce(city,'') || ' ' || coalesce(suburb,'') || ' ' || coalesce(address,''))
);

DROP TRIGGER IF EXISTS properties_updated_at ON properties;
CREATE TRIGGER properties_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: PROPERTY IMAGES & SAVED PROPERTIES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS property_images (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    url             TEXT        NOT NULL,
    alt_text        TEXT,
    is_cover        BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order      SMALLINT    NOT NULL DEFAULT 0,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id, sort_order);

CREATE TABLE IF NOT EXISTS saved_properties (
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    property_id     UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, property_id)
);

-- ═══════════════════════════════════════════════════════════════
--  TABLE: RENTAL APPLICATIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS applications (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    applicant_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status          app_status  NOT NULL DEFAULT 'pending',
    message         TEXT,
    move_in_date    DATE,
    monthly_income  NUMERIC(10,2),
    employer        TEXT,
    num_occupants   SMALLINT    NOT NULL DEFAULT 1,
    has_pets        BOOLEAN     NOT NULL DEFAULT FALSE,
    reviewed_at     TIMESTAMPTZ,
    decision_note   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_property  ON applications(property_id);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id);

DROP TRIGGER IF EXISTS applications_updated_at ON applications;
CREATE TRIGGER applications_updated_at BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: CONVERSATIONS & MESSAGES
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_one UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_two UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_a   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    participant_b   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    property_id     UUID REFERENCES properties(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair
    ON conversations (LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b));

CREATE TABLE IF NOT EXISTS messages (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    body            TEXT        NOT NULL,
    message         TEXT        NOT NULL DEFAULT '',
    status          msg_status  NOT NULL DEFAULT 'sent',
    is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
    is_edited       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender       ON messages(sender_id);

CREATE OR REPLACE FUNCTION update_conversation_timestamp() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN UPDATE conversations SET last_message_at = NOW() WHERE id = NEW.conversation_id; RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS messages_update_conversation ON messages;
CREATE TRIGGER messages_update_conversation AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_conversation_timestamp();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: MOVERS & MOVER BOOKINGS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS movers (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    owner_id        UUID        REFERENCES profiles(id) ON DELETE CASCADE,
    business_name   TEXT,
    company_name    TEXT        NOT NULL,
    description     TEXT,
    city            TEXT        NOT NULL DEFAULT 'Harare',
    service_areas   TEXT[]      NOT NULL DEFAULT '{}',
    service_area    TEXT,
    vehicle_types   TEXT[]      NOT NULL DEFAULT '{}',
    base_price_usd  NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (base_price_usd >= 0),
    price_from      NUMERIC(8,2),
    price_per_km    NUMERIC(8,2) DEFAULT 0,
    currency        TEXT        NOT NULL DEFAULT 'USD',
    phone           TEXT        NOT NULL,
    whatsapp        TEXT,
    email           TEXT,
    website         TEXT,
    rating          NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    total_reviews   INT         NOT NULL DEFAULT 0,
    total_jobs      INT         NOT NULL DEFAULT 0,
    is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    avatar_url      TEXT,
    logo_url        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movers_city   ON movers(city);
CREATE INDEX IF NOT EXISTS idx_movers_active ON movers(is_active);
CREATE INDEX IF NOT EXISTS idx_movers_owner  ON movers(owner_id);

DROP TRIGGER IF EXISTS movers_updated_at ON movers;
CREATE TRIGGER movers_updated_at BEFORE UPDATE ON movers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS mover_bookings (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id          UUID            NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
    customer_id       UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_id         UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    booking_date      DATE            NOT NULL DEFAULT CURRENT_DATE,
    status            booking_status  NOT NULL DEFAULT 'pending',
    bid_amount        NUMERIC(10,2),
    moving_date       DATE,
    pickup_address    TEXT,
    destination_address TEXT          NOT NULL DEFAULT '',
    drop_address      TEXT,
    pickup_city       TEXT            DEFAULT 'Harare',
    drop_city         TEXT            DEFAULT 'Harare',
    distance_km       NUMERIC(8,2),
    estimated_price   NUMERIC(10,2),
    price             NUMERIC(10,2),
    currency          TEXT            NOT NULL DEFAULT 'USD',
    final_price       NUMERIC(10,2),
    items_description TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mover_bookings_mover  ON mover_bookings(mover_id);
CREATE INDEX IF NOT EXISTS idx_mover_bookings_client ON mover_bookings(client_id);

DROP TRIGGER IF EXISTS mover_bookings_updated_at ON mover_bookings;
CREATE TRIGGER mover_bookings_updated_at BEFORE UPDATE ON mover_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS mover_reviews (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id        UUID    NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
    booking_id      UUID UNIQUE REFERENCES mover_bookings(id) ON DELETE SET NULL,
    reviewer_id     UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rating          INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_mover_rating() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE movers SET
        rating = COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM mover_reviews WHERE mover_id = COALESCE(NEW.mover_id, OLD.mover_id)), 0),
        total_reviews = (SELECT COUNT(*) FROM mover_reviews WHERE mover_id = COALESCE(NEW.mover_id, OLD.mover_id))
    WHERE id = COALESCE(NEW.mover_id, OLD.mover_id);
    RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_update_mover_rating ON mover_reviews;
CREATE TRIGGER trg_update_mover_rating AFTER INSERT OR UPDATE OR DELETE ON mover_reviews
    FOR EACH ROW EXECUTE FUNCTION update_mover_rating();

-- ═══════════════════════════════════════════════════════════════
--  TABLE: NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type            TEXT    NOT NULL,
    actor_id        UUID    REFERENCES profiles(id) ON DELETE SET NULL,
    reference_id    TEXT,
    title           TEXT    NOT NULL,
    message         TEXT    NOT NULL DEFAULT '',
    body            TEXT,
    data            JSONB   NOT NULL DEFAULT '{}',
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
