BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone_number TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT DEFAULT 'Harare',
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_details JSONB,
    ADD COLUMN IF NOT EXISTS vehicle_photos JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS push_token TEXT,
    ADD COLUMN IF NOT EXISTS id_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS followers_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS average_rating NUMERIC(2,1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $migration$
BEGIN
    IF to_regclass('auth.users') IS NOT NULL THEN
        EXECUTE $sql$
            UPDATE profiles AS profile
            SET email = COALESCE(profile.email, auth_user.email),
                password_hash = COALESCE(NULLIF(profile.password_hash, ''), auth_user.encrypted_password)
            FROM auth.users AS auth_user
            WHERE profile.id = auth_user.id
                AND (profile.email IS NULL OR profile.password_hash IS NULL OR profile.password_hash = '')
        $sql$;
    END IF;
END
$migration$;

UPDATE profiles
SET first_name = COALESCE(NULLIF(split_part(full_name, ' ', 1), ''), ''),
    last_name = COALESCE(NULLIF(BTRIM(regexp_replace(full_name, '^\S+\s*', '')), ''), ''),
    phone_number = COALESCE(phone_number, phone)
WHERE first_name = '' OR last_name = '' OR phone_number IS NULL;

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'rent',
    ADD COLUMN IF NOT EXISTS listing_purpose TEXT,
    ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS amenities JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS suburb TEXT,
    ADD COLUMN IF NOT EXISTS province TEXT,
    ADD COLUMN IF NOT EXISTS rent_usd NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS sale_price_usd NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS deposit_usd NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS area_sqm NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS floor_level SMALLINT,
    ADD COLUMN IF NOT EXISTS parking_spots SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_furnished BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS available_from DATE,
    ADD COLUMN IF NOT EXISTS utilities_inc BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_wifi BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_pool BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_gym BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_borehole BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_solar BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_security BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_generator BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_water_tank BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_garden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS views INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

UPDATE properties SET rent_usd = price WHERE rent_usd IS NULL;
UPDATE properties SET listing_purpose = listing_type WHERE listing_purpose IS NULL;
ALTER TABLE properties ALTER COLUMN images SET DEFAULT '[]'::jsonb;
ALTER TABLE properties ALTER COLUMN amenities SET DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS property_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt_text TEXT,
    is_cover BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, url)
);

INSERT INTO property_images (property_id, url, sort_order)
SELECT p.id,
       COALESCE(image->>'url', image->>'image_url', image #>> '{}'),
       (item.ordinality - 1)::SMALLINT
FROM properties p
CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p.images) = 'array' THEN p.images ELSE '[]'::jsonb END
) WITH ORDINALITY AS item(image, ordinality)
WHERE COALESCE(image->>'url', image->>'image_url', image #>> '{}') IS NOT NULL
    AND NOT EXISTS (
            SELECT 1 FROM property_images existing
            WHERE existing.property_id = p.id
                AND existing.url = COALESCE(image->>'url', image->>'image_url', image #>> '{}')
    );

ALTER TABLE saved_properties
    ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE OR REPLACE FUNCTION update_followers_count() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
        RETURN NEW;
    END IF;
    UPDATE profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_followers_count ON user_follows;
CREATE TRIGGER trg_update_followers_count AFTER INSERT OR DELETE ON user_follows
    FOR EACH ROW EXECUTE FUNCTION update_followers_count();

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS participant_one UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS participant_two UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS participant_a UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS participant_b UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE conversations
SET participant_a = COALESCE(participant_a, participant_one),
    participant_b = COALESCE(participant_b, participant_two),
    participant_one = COALESCE(participant_one, participant_a),
    participant_two = COALESCE(participant_two, participant_b);

UPDATE conversations c
SET last_message_at = COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS body TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent',
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE messages
SET body = COALESCE(body, message),
    message = COALESCE(message, body),
    is_read = is_read OR status::text = 'read'
WHERE body IS NULL OR message IS NULL;

UPDATE messages SET status = 'read' WHERE is_read = TRUE AND status::text <> 'read';

ALTER TABLE messages ALTER COLUMN body SET NOT NULL;

ALTER TABLE movers
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS company_name TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT 'Harare',
    ADD COLUMN IF NOT EXISTS service_areas TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS service_area TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_types TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS price_from NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS base_price_usd NUMERIC(8,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_per_km NUMERIC(8,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS whatsapp TEXT,
    ADD COLUMN IF NOT EXISTS website TEXT,
    ADD COLUMN IF NOT EXISTS total_reviews INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_jobs INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

UPDATE movers
SET owner_id = COALESCE(owner_id, user_id),
    user_id = COALESCE(user_id, owner_id),
    company_name = COALESCE(company_name, business_name),
    service_areas = CASE WHEN service_area IS NULL OR BTRIM(service_area) = ''
        THEN service_areas ELSE string_to_array(service_area, ',') END,
    base_price_usd = CASE WHEN base_price_usd = 0 THEN COALESCE(price_from, 0) ELSE base_price_usd END;

ALTER TABLE mover_bookings
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS booking_date DATE NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS bid_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS moving_date DATE,
    ADD COLUMN IF NOT EXISTS drop_address TEXT,
    ADD COLUMN IF NOT EXISTS destination_address TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pickup_city TEXT DEFAULT 'Harare',
    ADD COLUMN IF NOT EXISTS drop_city TEXT DEFAULT 'Harare',
    ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS estimated_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS final_price NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS items_description TEXT;

UPDATE mover_bookings
SET client_id = COALESCE(client_id, customer_id),
    customer_id = COALESCE(customer_id, client_id),
    moving_date = COALESCE(moving_date, booking_date),
    drop_address = COALESCE(drop_address, destination_address),
    destination_address = COALESCE(destination_address, drop_address),
    estimated_price = COALESCE(estimated_price, price);

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reference_id TEXT,
    ADD COLUMN IF NOT EXISTS body TEXT;

UPDATE notifications
SET body = COALESCE(body, message), message = COALESCE(message, body)
WHERE body IS NULL OR message = '';

CREATE TABLE IF NOT EXISTS mover_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id UUID NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
    booking_id UUID UNIQUE REFERENCES mover_bookings(id) ON DELETE SET NULL,
    reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mover_reviews_booking
    ON mover_reviews(booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_plans (
    plan TEXT PRIMARY KEY,
    price_usd NUMERIC(8,2) NOT NULL,
    max_listings INT NOT NULL,
    features TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO subscription_plans (plan, price_usd, max_listings, features) VALUES
    ('free', 0, 1, ARRAY['1 active listing', 'Standard search visibility', 'In-app chat']),
    ('basic', 5, 5, ARRAY['5 active listings', 'Email support', 'Verified badge']),
    ('pro', 15, 20, ARRAY['20 active listings', 'Priority search placement', 'Advanced analytics']),
    ('enterprise', 40, 999, ARRAY['Unlimited listings', 'Dedicated account manager', 'API access'])
ON CONFLICT (plan) DO NOTHING;

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free' REFERENCES subscription_plans(plan),
    status TEXT NOT NULL DEFAULT 'active',
    price_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    max_listings INT NOT NULL DEFAULT 1,
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    suburb TEXT,
    property_type TEXT,
    max_price NUMERIC(10,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_participants
    ON conversations(participant_a, participant_b);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
    ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC);

COMMIT;