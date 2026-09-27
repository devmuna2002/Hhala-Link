-- HLALA LINK: MASTER DATABASE SYNC (MAY 2024)
-- ================================================================
-- INSTRUCTIONS: 
-- 1. Copy this entire script.
-- 2. Open your Supabase Dashboard -> SQL Editor.
-- 3. Paste and Click 'Run'.
-- ================================================================

-- 0. ENABLE EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PROFILE UPDATES (Presence & Notifications)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;

-- 2. CONVERSATION UNIFICATION (One chat per pair)
-- Merge duplicate conversations and enforce unique pairs
DO $$
DECLARE
    conv_pair RECORD;
    main_conv_id UUID;
BEGIN
    FOR conv_pair IN 
        SELECT 
            LEAST(participant_a, participant_b) as user1,
            GREATEST(participant_a, participant_b) as user2,
            COUNT(*) as conv_count
        FROM conversations
        GROUP BY LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b)
        HAVING COUNT(*) > 1
    LOOP
        SELECT id INTO main_conv_id FROM conversations
        WHERE (participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
           OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1)
        ORDER BY created_at ASC LIMIT 1;

        UPDATE messages SET conversation_id = main_conv_id
        WHERE conversation_id IN (
            SELECT id FROM conversations
            WHERE ((participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
               OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1))
              AND id != main_conv_id
        );

        DELETE FROM conversations
        WHERE ((participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
           OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1))
          AND id != main_conv_id;
    END LOOP;
END $$;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_participant_a_participant_b_property_id_key;
DROP INDEX IF EXISTS idx_unique_conversation_pair;
CREATE UNIQUE INDEX idx_unique_conversation_pair 
ON conversations (LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b));

-- 3. NOTIFICATIONS & PRESENCE
-- Ensure notifications table matches app code (uses 'message' not 'body')
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='body') THEN
        ALTER TABLE notifications RENAME COLUMN body TO message;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id     UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    following_id    UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID            NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type            TEXT            NOT NULL,
    actor_id        UUID            REFERENCES profiles(id) ON DELETE SET NULL,
    reference_id    UUID,
    title           TEXT,
    message         TEXT            NOT NULL,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Ensure 'message' column exists if the table was created with old schema
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;

-- 4. ANALYTICS (Property Views)
CREATE OR REPLACE FUNCTION increment_views(property_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE properties
    SET views = COALESCE(views, 0) + 1
    WHERE id = property_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RLS SECURITY POLICIES
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Subscriptions: Users can only see their own
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription" 
ON public.subscriptions FOR SELECT 
USING (auth.uid() = user_id);

-- Subscriptions: Users can insert their own (on payment success)
DROP POLICY IF EXISTS "Users can create own subscription" ON public.subscriptions;
CREATE POLICY "Users can create own subscription" 
ON public.subscriptions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Notifications: Users can only see their own
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" 
ON public.notifications FOR SELECT 
USING (auth.uid() = user_id);

-- Notifications: Users can update their own (to mark as read)
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" 
ON public.notifications FOR UPDATE 
USING (auth.uid() = user_id);

-- Follows: Users can view all follows
DROP POLICY IF EXISTS "Follows are public" ON public.user_follows;
CREATE POLICY "Follows are public" ON public.user_follows FOR SELECT USING (true);

-- Follows: Users can follow/unfollow
DROP POLICY IF EXISTS "Users can manage own follows" ON public.user_follows;
CREATE POLICY "Users can manage own follows" 
ON public.user_follows FOR ALL 
USING (auth.uid() = follower_id);

-- Allow participants to see messages in their conversations
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
CREATE POLICY "Participants can view messages" 
ON public.messages FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = messages.conversation_id 
    AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  )
);

-- Allow participants to insert messages into their conversations
DROP POLICY IF EXISTS "Participants can insert messages" ON public.messages;
CREATE POLICY "Participants can insert messages" 
ON public.messages FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = conversation_id 
    AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  )
  AND sender_id = auth.uid()
);

-- Allow participants to update messages (e.g. mark as read)
DROP POLICY IF EXISTS "Participants can update messages" ON public.messages;
CREATE POLICY "Participants can update messages" 
ON public.messages FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.conversations c 
    WHERE c.id = messages.conversation_id 
    AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  )
);

-- 6. AUTO-NOTIFICATION TRIGGERS
-- Trigger for Follows
CREATE OR REPLACE FUNCTION notify_on_follow() 
RETURNS TRIGGER SECURITY DEFINER AS $$
BEGIN
    INSERT INTO notifications (user_id, type, actor_id, title, message)
    VALUES (NEW.following_id, 'follow', NEW.follower_id, 'New Follower', 'Someone started following you.');
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_on_follow ON user_follows;
CREATE TRIGGER trigger_notify_on_follow AFTER INSERT ON user_follows FOR EACH ROW EXECUTE FUNCTION notify_on_follow();

-- Trigger for New Messages
CREATE OR REPLACE FUNCTION notify_on_message() 
RETURNS TRIGGER SECURITY DEFINER AS $$
DECLARE receiver_id UUID;
BEGIN
    SELECT CASE WHEN participant_a = NEW.sender_id THEN participant_b ELSE participant_a END INTO receiver_id
    FROM conversations WHERE id = NEW.conversation_id;
    INSERT INTO notifications (user_id, type, actor_id, reference_id, title, message)
    VALUES (receiver_id, 'message', NEW.sender_id, NEW.conversation_id, 'New Message', 'You have a new message.');
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notify_on_message ON messages;
CREATE TRIGGER trigger_notify_on_message AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION notify_on_message();

-- 7. REALTIME ENABLEMENT (FORCED)
-- 1. Ensure the publication exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

-- 2. Add table to publication (idempotent)
DO $$ 
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN 
    NULL; -- Already added
END $$;

-- 3. Set replica identity to FULL for notifications
-- This ensures all columns are sent in the realtime payload
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- 8. PERMISSION FIX FOR REALTIME
-- Sometimes the 'anon' or 'authenticated' roles need explicit broadcast permission
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.notifications TO anon;

-- SUCCESS
SELECT 'Database successfully synchronized. Realtime notifications are now FORCED ENABLED.' as status;
