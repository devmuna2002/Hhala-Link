-- ============================================================================
-- HLALA LINK — MOVERS FEATURE MIGRATION
-- File: database/20260521_movers_feature.sql
-- Goal: Full movers marketplace — movers, bookings, reviews, RLS, functions.
-- ============================================================================

-- 1. Create movers table (browsable mover profiles)
CREATE TABLE IF NOT EXISTS movers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Harare',
    description TEXT,
    vehicle_types TEXT[] DEFAULT '{}',
    service_areas TEXT[] DEFAULT '{}',
    base_price_usd NUMERIC DEFAULT 0,
    rating NUMERIC DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    total_jobs INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT false,
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create or extend mover_bookings table
CREATE TABLE IF NOT EXISTS mover_bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    mover_id UUID NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    bid_amount NUMERIC,
    job_details JSONB DEFAULT '{}',
    pickup_time TIMESTAMPTZ,
    delivery_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If mover_bookings already exists, add missing columns
ALTER TABLE mover_bookings
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS bid_amount NUMERIC,
    ADD COLUMN IF NOT EXISTS job_details JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS delivery_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Create mover_reviews table
CREATE TABLE IF NOT EXISTS mover_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mover_id UUID NOT NULL REFERENCES movers(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES mover_bookings(id) ON DELETE SET NULL,
    reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Movers: anyone can browse, owner can manage
ALTER TABLE movers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movers_select_all" ON movers;
CREATE POLICY "movers_select_all" ON movers
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "movers_manage_own" ON movers;
CREATE POLICY "movers_manage_own" ON movers
    FOR ALL USING (auth.uid() = profile_id);

-- Mover bookings: mover and client can see their own
ALTER TABLE mover_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mover_bookings_mover_own" ON mover_bookings;
CREATE POLICY "mover_bookings_mover_own" ON mover_bookings
    FOR ALL USING (auth.uid() IN (
        SELECT profile_id FROM movers WHERE id = mover_bookings.mover_id
    ));
DROP POLICY IF EXISTS "mover_bookings_client_own" ON mover_bookings;
CREATE POLICY "mover_bookings_client_own" ON mover_bookings
    FOR ALL USING (auth.uid() = client_id);

-- Mover reviews: anyone can read, reviewer can insert
ALTER TABLE mover_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mover_reviews_select_all" ON mover_reviews;
CREATE POLICY "mover_reviews_select_all" ON mover_reviews
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "mover_reviews_insert_own" ON mover_reviews;
CREATE POLICY "mover_reviews_insert_own" ON mover_reviews
    FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Create a mover booking
CREATE OR REPLACE FUNCTION create_mover_booking(
    requester_id UUID, mover_id UUID, job_details JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_booking_id UUID;
    v_mover_profile UUID;
BEGIN
    -- Get the mover's profile_id for notifications
    SELECT profile_id INTO v_mover_profile FROM movers WHERE id = mover_id;

    INSERT INTO mover_bookings (client_id, mover_id, status, job_details)
    VALUES (requester_id, mover_id, 'pending', job_details)
    RETURNING id INTO v_booking_id;

    -- Notify the mover
    INSERT INTO notifications (user_id, type, title, body, reference_id)
    VALUES (v_mover_profile, 'mover_booking', 'New Move Request',
            'A customer has requested a move.', v_booking_id::text);

    -- Update total_jobs counter
    UPDATE movers SET total_jobs = total_jobs + 1 WHERE id = mover_id;

    RETURN v_booking_id;
END;
$$;

-- Place a bid on a booking
CREATE OR REPLACE FUNCTION place_bid(
    booking_id UUID, mover_id UUID, amount NUMERIC
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_client UUID;
BEGIN
    SELECT client_id INTO v_client FROM mover_bookings WHERE id = booking_id;

    UPDATE mover_bookings SET status = 'bidded', bid_amount = amount, updated_at = NOW()
    WHERE id = booking_id;

    INSERT INTO notifications (user_id, type, title, body, reference_id)
    VALUES (v_client, 'booking_update', 'Bid Received',
            format('A mover has placed a bid of $%s on your request.', amount), booking_id::text);
END;
$$;

-- Accept a booking
CREATE OR REPLACE FUNCTION accept_booking(
    booking_id UUID, mover_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_client UUID;
BEGIN
    SELECT client_id INTO v_client FROM mover_bookings WHERE id = booking_id;

    UPDATE mover_bookings SET status = 'accepted', updated_at = NOW()
    WHERE id = booking_id;

    INSERT INTO notifications (user_id, type, title, body, reference_id)
    VALUES (v_client, 'booking_update', 'Move Accepted',
            'Your move request has been accepted!', booking_id::text);
END;
$$;

-- Update booking status (in_progress, completed, cancelled, declined)
CREATE OR REPLACE FUNCTION update_booking_status(
    booking_id UUID, new_status TEXT, extra_data JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_client UUID;
    v_mover_profile UUID;
    v_mover_id UUID;
BEGIN
    SELECT client_id, mover_id INTO v_client, v_mover_id FROM mover_bookings WHERE id = booking_id;
    SELECT profile_id INTO v_mover_profile FROM movers WHERE id = v_mover_id;

    UPDATE mover_bookings SET status = new_status, updated_at = NOW()
    WHERE id = booking_id;

    -- Notify client
    INSERT INTO notifications (user_id, type, title, body, reference_id)
    VALUES (v_client, 'booking_update',
            format('Booking %s', initcap(new_status)),
            format('Your booking status has been updated to %s.', new_status),
            booking_id::text);

    -- Notify mover too (if client-initiated like cancellation)
    INSERT INTO notifications (user_id, type, title, body, reference_id)
    VALUES (v_mover_profile, 'booking_update',
            format('Booking %s', initcap(new_status)),
            format('A booking status has been updated to %s.', new_status),
            booking_id::text);
END;
$$;

-- Trigger to auto-update mover rating when a review is inserted
CREATE OR REPLACE FUNCTION update_mover_rating()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE movers SET
        rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM mover_reviews WHERE mover_id = NEW.mover_id),
        total_reviews = (SELECT COUNT(*) FROM mover_reviews WHERE mover_id = NEW.mover_id)
    WHERE id = NEW.mover_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_mover_rating ON mover_reviews;
CREATE TRIGGER trg_update_mover_rating
    AFTER INSERT ON mover_reviews
    FOR EACH ROW EXECUTE FUNCTION update_mover_rating();

-- End of migration
