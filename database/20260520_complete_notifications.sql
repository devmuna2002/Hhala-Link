-- ============================================================================
-- HLALA LINK — COMPLETE NOTIFICATION TRIGGERS MIGRATION
-- File: database/20260520_complete_notifications.sql
-- Goal: Automate real-time Airbnb, Property24, & Uber-style notifications in Supabase
-- ============================================================================

-- ── 1. SAVED SEARCHES SYSTEM (Property24 / Airbnb style) ───────────────────
-- Allows tenants to save searches and get notified of new listings matching criteria
CREATE TABLE IF NOT EXISTS saved_searches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    city            TEXT NOT NULL,
    suburb          TEXT,
    property_type   TEXT, -- maps to property_type type
    max_price       NUMERIC(10,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_query ON saved_searches(city, suburb, max_price);

-- Enable RLS for saved_searches
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_searches_all_own" ON saved_searches;
CREATE POLICY "saved_searches_all_own" ON saved_searches 
    FOR ALL USING (auth.uid() = user_id);

-- ── 2. HELPER FUNCTIONS ───────────────────────────────────────────────────

-- Helper to safely dispatch notifications to notifications table
CREATE OR REPLACE FUNCTION create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_actor_id UUID,
    p_reference_id UUID,
    p_title TEXT,
    p_message TEXT,
    p_data JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_notif_id UUID;
BEGIN
    INSERT INTO notifications (user_id, type, actor_id, reference_id, title, message, data)
    VALUES (p_user_id, p_type, p_actor_id, p_reference_id, p_title, p_message, p_data)
    RETURNING id INTO v_notif_id;
    RETURN v_notif_id;
END;
$$;


-- ── 3. TENANT NOTIFICATION TRIGGERS ───────────────────────────────────────

-- A. Rent Price Drop Trigger (Airbnb / Property24 style)
-- When a landlord decreases rent, alert all tenants who saved this listing.
CREATE OR REPLACE FUNCTION notify_on_price_drop()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Only trigger if the rent decreased
    IF NEW.rent_usd < OLD.rent_usd THEN
        FOR v_tenant_id IN 
            SELECT user_id FROM saved_properties WHERE property_id = NEW.id
        LOOP
            PERFORM create_notification(
                v_tenant_id,
                'price_drop',
                NEW.owner_id,
                NEW.id,
                'Rent Price Drop! 📉',
                'Great news! The rent for "' || NEW.title || '" in ' || NEW.city || ' has dropped from $' || OLD.rent_usd::int || ' to $' || NEW.rent_usd::int || '/mo!',
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

DROP TRIGGER IF EXISTS trigger_notify_on_price_drop ON properties;
CREATE TRIGGER trigger_notify_on_price_drop
    AFTER UPDATE OF rent_usd ON properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_price_drop();


-- B. New Property Matches & Saved Search Alerts
-- When a new property is listed, notify users who saved searches matching this property.
CREATE OR REPLACE FUNCTION notify_on_saved_search_match()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_match RECORD;
BEGIN
    -- Only notify for active, available properties
    IF NEW.status = 'available' THEN
        FOR v_match IN 
            SELECT user_id, id FROM saved_searches 
            WHERE LOWER(city) = LOWER(NEW.city)
              AND (suburb IS NULL OR LOWER(suburb) = LOWER(NEW.suburb))
              AND (property_type IS NULL OR property_type = NEW.property_type::text)
              AND (max_price IS NULL OR NEW.rent_usd <= max_price)
        LOOP
            PERFORM create_notification(
                v_match.user_id,
                'property_match',
                NEW.owner_id,
                NEW.id,
                'New Property Match! 🏠',
                'A new ' || NEW.property_type || ' matching your saved search is available in ' || NEW.city || ' (' || NEW.suburb || ') for $' || NEW.rent_usd::int || '/mo!',
                jsonb_build_object(
                    'propertyId', NEW.id,
                    'rent', NEW.rent_usd,
                    'city', NEW.city,
                    'suburb', NEW.suburb,
                    'searchId', v_match.id
                )
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_saved_search_match ON properties;
CREATE TRIGGER trigger_notify_on_saved_search_match
    AFTER INSERT ON properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_saved_search_match();


-- C. Property Application Status Change (Approval / Rejection / Viewing Reminders)
-- When a landlord approves/rejects a tenant application.
CREATE OR REPLACE FUNCTION notify_on_application_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_prop_title TEXT;
    v_landlord_id UUID;
    v_landlord_name TEXT;
BEGIN
    SELECT title, owner_id INTO v_prop_title, v_landlord_id FROM properties WHERE id = NEW.property_id;
    SELECT (first_name || ' ' || last_name) INTO v_landlord_name FROM profiles WHERE id = v_landlord_id;

    IF NEW.status != OLD.status THEN
        -- Application Approved -> Viewing reminder setup
        IF NEW.status = 'approved' THEN
            PERFORM create_notification(
                NEW.applicant_id,
                'application_approved',
                v_landlord_id,
                NEW.id,
                'Application Approved! 🎉',
                'Your application for "' || v_prop_title || '" has been approved by ' || COALESCE(v_landlord_name, 'the Landlord') || '! Let''s schedule a viewing appointment.',
                jsonb_build_object(
                    'applicationId', NEW.id,
                    'propertyId', NEW.property_id,
                    'note', NEW.decision_note
                )
            );

            -- Also create a viewing appointment reminder automatically
            PERFORM create_notification(
                NEW.applicant_id,
                'viewing_reminder',
                v_landlord_id,
                NEW.id,
                'Viewing Scheduled 🗓',
                'Reminder: You have an upcoming viewing appointment for "' || v_prop_title || '". Make sure to coordinate with the landlord!',
                jsonb_build_object(
                    'propertyId', NEW.property_id,
                    'date', COALESCE(NEW.move_in_date::text, NOW()::text)
                )
            );

        -- Application Rejected
        ELSIF NEW.status = 'rejected' THEN
            PERFORM create_notification(
                NEW.applicant_id,
                'application_rejected',
                v_landlord_id,
                NEW.id,
                'Application Update 📝',
                'Unfortunately, your application for "' || v_prop_title || '" was not accepted at this time.',
                jsonb_build_object(
                    'applicationId', NEW.id,
                    'propertyId', NEW.property_id,
                    'note', NEW.decision_note
                )
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_application_status_change ON applications;
CREATE TRIGGER trigger_notify_on_application_status_change
    AFTER UPDATE OF status ON applications
    FOR EACH ROW EXECUTE FUNCTION notify_on_application_status_change();


-- ── 4. LANDLORD / AGENT NOTIFICATION TRIGGERS ────────────────────────────

-- A. New Tenant Inquiry
-- When a tenant submits an application to a listing, alert the landlord.
CREATE OR REPLACE FUNCTION notify_landlord_on_application()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_prop_owner UUID;
    v_prop_title TEXT;
    v_tenant_name TEXT;
BEGIN
    SELECT owner_id, title INTO v_prop_owner, v_prop_title FROM properties WHERE id = NEW.property_id;
    SELECT (first_name || ' ' || last_name) INTO v_tenant_name FROM profiles WHERE id = NEW.applicant_id;

    IF v_prop_owner IS NOT NULL THEN
        PERFORM create_notification(
            v_prop_owner,
            'application_received',
            NEW.applicant_id,
            NEW.id,
            'New Tenant Inquiry 📨',
            COALESCE(v_tenant_name, 'A tenant') || ' has submitted an application for your property "' || v_prop_title || '".',
            jsonb_build_object(
                'applicationId', NEW.id,
                'propertyId', NEW.property_id,
                'monthlyIncome', NEW.monthly_income
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_landlord_on_application ON applications;
CREATE TRIGGER trigger_notify_landlord_on_application
    AFTER INSERT ON applications
    FOR EACH ROW EXECUTE FUNCTION notify_landlord_on_application();


-- B. Property Performance Analytics Trigger
-- Weekly digest simulator or notify when views exceed milestones (e.g. 100, 500, 1000 views)
CREATE OR REPLACE FUNCTION notify_property_analytics()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NEW.views % 100 = 0 AND NEW.views > 0 THEN
        PERFORM create_notification(
            NEW.owner_id,
            'property_analytics',
            NULL,
            NEW.id,
            'Listing Gaining Traction! 📈',
            'Your property "' || NEW.title || '" has reached ' || NEW.views || ' total views! Tap to view full analytics.',
            jsonb_build_object('propertyId', NEW.id, 'views', NEW.views)
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_property_analytics ON properties;
CREATE TRIGGER trigger_notify_property_analytics
    AFTER UPDATE OF views ON properties
    FOR EACH ROW EXECUTE FUNCTION notify_property_analytics();


-- ── 5. FREIGHT & MOVERS NOTIFICATION TRIGGERS (Uber-style) ───────────────

-- A. New Moving Requests (To Mover) & Confirmation (To Customer)
-- When a booking is created or changes status
CREATE OR REPLACE FUNCTION notify_mover_booking_updates()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_mover_owner UUID;
    v_company_name TEXT;
    v_client_name TEXT;
BEGIN
    -- Get mover information
    SELECT owner_id, company_name INTO v_mover_owner, v_company_name FROM movers WHERE id = NEW.mover_id;
    SELECT (first_name || ' ' || last_name) INTO v_client_name FROM profiles WHERE id = NEW.client_id;

    -- CASE 1: Insert (New Request to Mover)
    IF TG_OP = 'INSERT' THEN
        PERFORM create_notification(
            v_mover_owner,
            'new_move_request',
            NEW.client_id,
            NEW.id,
            'New Moving Request 🚚',
            COALESCE(v_client_name, 'A customer') || ' requested a move on ' || NEW.moving_date || ' from ' || NEW.pickup_address || ' to ' || NEW.drop_address || '.',
            jsonb_build_object(
                'bookingId', NEW.id,
                'moverId', NEW.mover_id,
                'pickup', NEW.pickup_address,
                'drop', NEW.drop_address,
                'estimatedPrice', NEW.estimated_price
            )
        );

    -- CASE 2: Status Updates
    ELSIF TG_OP = 'UPDATE' AND NEW.status != OLD.status THEN
        
        -- Confirmed (Customer Acceptance)
        IF NEW.status = 'confirmed' THEN
            PERFORM create_notification(
                NEW.client_id,
                'booking_confirmed',
                v_mover_owner,
                NEW.id,
                'Mover Accepted! ✅',
                v_company_name || ' has accepted your moving request! They will pick up on ' || NEW.moving_date || '.',
                jsonb_build_object('bookingId', NEW.id, 'moverId', NEW.mover_id)
            );
            
        -- In Progress (Pickup Reminder / Route Updates)
        ELSIF NEW.status = 'in_progress' THEN
            -- Pickup Reminder
            PERFORM create_notification(
                NEW.client_id,
                'pickup_reminder',
                v_mover_owner,
                NEW.id,
                'Mover En Route! 🚚',
                v_company_name || ' is en route to your pickup location: ' || NEW.pickup_address || '.',
                jsonb_build_object('bookingId', NEW.id, 'pickup', NEW.pickup_address)
            );

            -- Route Update
            PERFORM create_notification(
                NEW.client_id,
                'route_update',
                v_mover_owner,
                NEW.id,
                'Trip Started 📍',
                'Your items are loaded! Track the mover en route to ' || NEW.drop_address || '.',
                jsonb_build_object('bookingId', NEW.id, 'drop', NEW.drop_address)
            );

        -- Completed (Delivery Confirmation)
        ELSIF NEW.status = 'completed' THEN
            PERFORM create_notification(
                NEW.client_id,
                'delivery_complete',
                v_mover_owner,
                NEW.id,
                'Delivery Completed! 🏠🎉',
                'Your items have been safely delivered to ' || NEW.drop_address || '! Please review your experience with ' || v_company_name || '.',
                jsonb_build_object('bookingId', NEW.id, 'moverId', NEW.mover_id)
            );

            -- Notify mover that job completed and payment is logged
            PERFORM create_notification(
                v_mover_owner,
                'mover_payment_received',
                NEW.client_id,
                NEW.id,
                'Payment Received 💵',
                'Payment of $' || COALESCE(NEW.final_price, NEW.estimated_price)::int || ' for Job #' || SUBSTRING(NEW.id::text, 1, 8) || ' has been released!',
                jsonb_build_object('bookingId', NEW.id, 'amount', COALESCE(NEW.final_price, NEW.estimated_price))
            );
            
        -- Cancelled
        ELSIF NEW.status = 'cancelled' THEN
            PERFORM create_notification(
                NEW.client_id,
                'booking_cancelled',
                v_mover_owner,
                NEW.id,
                'Booking Cancelled ❌',
                'Your moving booking with ' || v_company_name || ' has been cancelled.',
                jsonb_build_object('bookingId', NEW.id)
            );
            PERFORM create_notification(
                v_mover_owner,
                'booking_cancelled',
                NEW.client_id,
                NEW.id,
                'Booking Cancelled ❌',
                'Booking with ' || COALESCE(v_client_name, 'customer') || ' was cancelled.',
                jsonb_build_object('bookingId', NEW.id)
            );
        END IF;

    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_mover_booking ON mover_bookings;
CREATE TRIGGER trigger_notify_mover_booking
    AFTER INSERT OR UPDATE OF status ON mover_bookings
    FOR EACH ROW EXECUTE FUNCTION notify_mover_booking_updates();


-- ── 6. ADMIN ALERTS & AUDITING TRIGGERS ──────────────────────────────────

-- A. Fraud Alerts, User Reports and Registrations
-- Creates automated notifications for 'admin' users.
CREATE OR REPLACE FUNCTION notify_admins_on_system_events()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_admin_id UUID;
BEGIN
    -- Find all administrator user profiles
    FOR v_admin_id IN 
        SELECT id FROM profiles WHERE role = 'admin'
    LOOP
        -- Admin: User registration notification
        IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'INSERT' THEN
            PERFORM create_notification(
                v_admin_id,
                'new_user_registration',
                NEW.id,
                NEW.id,
                'New User Registered 👤',
                'A new ' || NEW.role || ' (' || NEW.first_name || ' ' || NEW.last_name || ') has registered on the platform.',
                jsonb_build_object('userId', NEW.id, 'role', NEW.role)
            );
            
        -- Admin: Listing moderation flags
        ELSIF TG_TABLE_NAME = 'properties' AND TG_OP = 'INSERT' THEN
            PERFORM create_notification(
                v_admin_id,
                'listing_moderation',
                NEW.owner_id,
                NEW.id,
                'New Listing Moderation Required ⚖️',
                'Property "' || NEW.title || '" in ' || NEW.city || ' has been submitted and is pending moderation approval.',
                jsonb_build_object('propertyId', NEW.id, 'rent', NEW.rent_usd)
            );
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_admin_profiles ON profiles;
CREATE TRIGGER trigger_admin_profiles
    AFTER INSERT ON profiles
    FOR EACH ROW EXECUTE FUNCTION notify_admins_on_system_events();

DROP TRIGGER IF EXISTS trigger_admin_properties ON properties;
CREATE TRIGGER trigger_admin_properties
    AFTER INSERT ON properties
    FOR EACH ROW EXECUTE FUNCTION notify_admins_on_system_events();
