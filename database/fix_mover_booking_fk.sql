-- ============================================================================
-- HLALA LINK — MOVER BOOKING FK FIX
-- File: database/fix_mover_booking_fk.sql
-- Run this in the Supabase SQL Editor (once).
--
-- ROOT CAUSE of:
--   "insert or update on table mover_bookings violates foreign key
--    constraint mover_bookings_mover_id_fkey"
-- mover_bookings.mover_id REFERENCES movers(id), but the app sends the
-- mover's profiles.id. Booking only worked when a movers row happened to
-- share the profile id. Any mover profile without a movers row
-- (e.g. newly registered movers) crashed every booking.
--
-- This migration:
--   1) Backfills one movers row per mover profile (id = profile_id, the
--      convention the app already relies on in MyMoverBookingsScreen).
--   2) Hardens create_mover_booking so it accepts EITHER a movers.id or a
--      profiles.id and auto-provisions the movers row when missing.
--   3) Notifies with type 'new_move_request' (was dead 'mover_booking'
--      with no route and no Accept/Decline buttons in the app).
--   4) Auto-creates movers rows for future mover profiles via trigger,
--      so this FK can never break again.
-- ============================================================================

-- 1) Backfill missing movers rows -------------------------------------------
-- (Only columns verified to exist on the live table + safe defaults.
--  phone is NOT NULL on the live table, so it must be supplied.)
INSERT INTO movers (id, owner_id, profile_id, company_name, city, phone, avatar_url)
SELECT
    p.id,
    p.id,
    p.id,
    COALESCE(
        NULLIF(TRIM(COALESCE(p.business_name, '')), ''),
        NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
        'Mover'
    ),
    COALESCE(NULLIF(TRIM(p.city), ''), 'Harare'),
    COALESCE(NULLIF(TRIM(COALESCE(p.phone_number, '')), ''), '0000000000'),
    p.avatar_url
FROM profiles p
LEFT JOIN movers m ON m.profile_id = p.id
WHERE p.role = 'mover'
  AND m.id IS NULL;

-- 2) Hardened booking RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION create_mover_booking(
    requester_id UUID, mover_id UUID, job_details JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_booking_id UUID;
    v_mover_row_id UUID;
    v_mover_profile UUID;
BEGIN
    -- Accept either a movers.id or a profiles.id
    SELECT m.id, m.profile_id INTO v_mover_row_id, v_mover_profile
    FROM movers m
    WHERE m.id = mover_id OR m.profile_id = mover_id
    LIMIT 1;

    -- Auto-provision a movers row when only the profile exists
    IF v_mover_row_id IS NULL THEN
        INSERT INTO movers (id, owner_id, profile_id, company_name, city, phone, avatar_url)
        SELECT
            mover_id,
            mover_id,
            mover_id,
            COALESCE(
                NULLIF(TRIM(COALESCE(p.business_name, '')), ''),
                NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
                'Mover'
            ),
            COALESCE(NULLIF(TRIM(p.city), ''), 'Harare'),
            COALESCE(NULLIF(TRIM(COALESCE(p.phone_number, '')), ''), '0000000000'),
            p.avatar_url
        FROM profiles p
        WHERE p.id = mover_id
        RETURNING id, profile_id INTO v_mover_row_id, v_mover_profile;

        IF v_mover_row_id IS NULL THEN
            RAISE EXCEPTION 'Unknown mover: %', mover_id;
        END IF;
    END IF;

    INSERT INTO mover_bookings (client_id, mover_id, status, job_details)
    VALUES (requester_id, v_mover_row_id, 'pending', job_details)
    RETURNING id INTO v_booking_id;

    -- Rich notification: the mover sees the requested job info (route,
    -- date, price) right in the notification body + a data snapshot, so
    -- the app can render the full job card without an extra fetch.
    INSERT INTO notifications (user_id, type, actor_id, title, body, message, reference_id, data)
    VALUES (
        v_mover_profile,
        'new_move_request',
        requester_id,
        'New Move Request',
        COALESCE(job_details->>'pickup_address', 'Pickup') || ' → ' ||
        COALESCE(job_details->>'drop_address', 'Drop-off') ||
        COALESCE(' · ' || NULLIF(job_details->>'moving_date', ''), '') ||
        COALESCE(' · $' || NULLIF(job_details->>'estimated_price', ''), ''),
        COALESCE(job_details->>'pickup_address', 'Pickup') || ' → ' ||
        COALESCE(job_details->>'drop_address', 'Drop-off') ||
        COALESCE(' · ' || NULLIF(job_details->>'moving_date', ''), '') ||
        COALESCE(' · $' || NULLIF(job_details->>'estimated_price', ''), ''),
        v_booking_id::text,
        jsonb_build_object(
            'booking_id', v_booking_id,
            'pickup_address', job_details->>'pickup_address',
            'drop_address', job_details->>'drop_address',
            'moving_date', job_details->>'moving_date',
            'moving_time', job_details->>'moving_time',
            'items_description', job_details->>'items_description',
            'estimated_price', job_details->>'estimated_price',
            'need_packing', job_details->>'need_packing',
            'need_insurance', job_details->>'need_insurance',
            'notes', job_details->>'notes'
        )
    );

    -- Update total_jobs counter
    UPDATE movers SET total_jobs = total_jobs + 1 WHERE id = v_mover_row_id;

    RETURN v_booking_id;
END;
$$;

-- 3) Auto-create movers rows for future mover profiles -----------------------
CREATE OR REPLACE FUNCTION ensure_mover_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.role = 'mover' THEN
        INSERT INTO movers (id, owner_id, profile_id, company_name, city, phone, avatar_url)
        SELECT
            NEW.id,
            NEW.id,
            NEW.id,
            COALESCE(
                NULLIF(TRIM(COALESCE(NEW.business_name, '')), ''),
                NULLIF(TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), ''),
                'Mover'
            ),
            COALESCE(NULLIF(TRIM(NEW.city), ''), 'Harare'),
            COALESCE(NULLIF(TRIM(COALESCE(NEW.phone_number, '')), ''), '0000000000'),
            NEW.avatar_url
        WHERE NOT EXISTS (SELECT 1 FROM movers WHERE profile_id = NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_mover_row ON profiles;
CREATE TRIGGER trg_ensure_mover_row
    AFTER INSERT OR UPDATE OF role ON profiles
    FOR EACH ROW EXECUTE FUNCTION ensure_mover_row();

-- End of migration
