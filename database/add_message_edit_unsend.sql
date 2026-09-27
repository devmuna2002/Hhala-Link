-- ═══════════════════════════════════════════════════════════════
--  CHAT: Message Edit & Unsend Support
--  Run this in the Supabase SQL Editor once.
-- ═══════════════════════════════════════════════════════════════

-- 1. Track whether a message has been edited (shows "Edited" tag)
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Allow senders to edit their own messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_update_sender" ON public.messages;
CREATE POLICY "messages_update_sender"
    ON public.messages FOR UPDATE
    USING (auth.uid() = sender_id)
    WITH CHECK (auth.uid() = sender_id);

-- 3. Allow senders to delete (unsend) their own messages
DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
CREATE POLICY "messages_delete_sender"
    ON public.messages FOR DELETE
    USING (auth.uid() = sender_id);

-- 4. Ensure realtime broadcasts DELETE events for messages
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION WHEN others THEN NULL;
END $$;
