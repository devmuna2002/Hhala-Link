-- ================================================================
--  UPDATE: NOTIFICATIONS & FOLLOWS SCHEMA
--  Run this in your Supabase SQL Editor
-- ================================================================

-- 1. Create User Follows Table
CREATE TABLE IF NOT EXISTS user_follows (
    follower_id     UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id    UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);

-- 2. Create Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, -- who receives it
    type            TEXT            NOT NULL, -- 'follow', 'like', 'message', 'new_listing', 'update'
    actor_id        UUID            REFERENCES profiles(id) ON DELETE SET NULL, -- who did it
    reference_id    UUID,           -- e.g. property_id or message_id
    title           TEXT,
    message         TEXT            NOT NULL,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;

-- 3. Triggers for Auto-Notifications (Optional but recommended for robust backend)

-- A. Auto-notify on Follow
CREATE OR REPLACE FUNCTION notify_on_follow()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO notifications (user_id, type, actor_id, title, message)
    VALUES (
        NEW.following_id, 
        'follow', 
        NEW.follower_id, 
        'New Follower',
        'Someone started following you.'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_follow ON user_follows;
CREATE TRIGGER trigger_notify_on_follow
    AFTER INSERT ON user_follows
    FOR EACH ROW EXECUTE FUNCTION notify_on_follow();

-- B. Auto-notify followers on New Listing
CREATE OR REPLACE FUNCTION notify_followers_on_listing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO notifications (user_id, type, actor_id, reference_id, title, message)
    SELECT 
        follower_id, 
        'new_listing', 
        NEW.owner_id, 
        NEW.id, 
        'New Listing Alert',
        'An agent you follow posted a new listing: ' || NEW.title
    FROM user_follows
    WHERE following_id = NEW.owner_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_listing ON properties;
CREATE TRIGGER trigger_notify_on_listing
    AFTER INSERT ON properties
    FOR EACH ROW EXECUTE FUNCTION notify_followers_on_listing();

-- C. Auto-notify on Like (Favorite)
CREATE OR REPLACE FUNCTION notify_on_favorite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    prop_owner UUID;
    prop_title TEXT;
BEGIN
    -- Get the owner and title of the favorited property
    SELECT owner_id, title INTO prop_owner, prop_title 
    FROM properties 
    WHERE id = NEW.property_id;

    -- Don't notify if they like their own property
    IF prop_owner IS NOT NULL AND prop_owner != NEW.user_id THEN
        INSERT INTO notifications (user_id, type, actor_id, reference_id, title, message)
        VALUES (
            prop_owner, 
            'like', 
            NEW.user_id, 
            NEW.property_id, 
            'Property Liked',
            'Someone favorited your listing: ' || prop_title
        );
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_favorite ON saved_properties;
CREATE TRIGGER trigger_notify_on_favorite
    AFTER INSERT ON saved_properties
    FOR EACH ROW EXECUTE FUNCTION notify_on_favorite();

-- D. Auto-notify on new Message
CREATE OR REPLACE FUNCTION notify_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    receiver_id UUID;
BEGIN
    -- Determine who is receiving the message
    SELECT CASE 
        WHEN participant_a = NEW.sender_id THEN participant_b 
        ELSE participant_a 
    END INTO receiver_id
    FROM conversations 
    WHERE id = NEW.conversation_id;

    INSERT INTO notifications (user_id, type, actor_id, reference_id, title, message)
    VALUES (
        receiver_id, 
        'message', 
        NEW.sender_id, 
        NEW.conversation_id, 
        'New Message',
        'You have a new message.'
    );
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_message ON messages;
CREATE TRIGGER trigger_notify_on_message
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION notify_on_message();

-- Ensure realtime is enabled for notifications safely
DO $$ 
BEGIN 
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION 
    WHEN duplicate_object THEN 
        -- Already a member, do nothing
        NULL; 
END $$;
