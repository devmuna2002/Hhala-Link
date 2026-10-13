-- ═══════════════════════════════════════════════════════════════
--  CHAT: Message & Conversation Pinning Support
--  Run this in the Supabase SQL Editor once.
--
--  The app works WITHOUT this migration too: pins are kept on the
--  phone and the server writes below are best-effort (ignored until
--  these columns exist). Applying it makes pins shared between both
--  sides of a chat and across devices.
-- ═══════════════════════════════════════════════════════════════

-- 1. One pinned message per conversation (flag; app enforces single-pin)
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_pinned
    ON public.messages (conversation_id) WHERE is_pinned = TRUE;

-- 2. Pinned chats sort above the rest in the inbox
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Either participant may (un)pin a message, not just the sender
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_pin_participant" ON public.messages;
CREATE POLICY "messages_pin_participant"
    ON public.messages FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
            AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
            AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
        )
    );

-- 4. Either participant may (un)pin the conversation itself
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_pin_participant" ON public.conversations;
CREATE POLICY "conversations_pin_participant"
    ON public.conversations FOR UPDATE
    USING (participant_a = auth.uid() OR participant_b = auth.uid())
    WITH CHECK (participant_a = auth.uid() OR participant_b = auth.uid());
