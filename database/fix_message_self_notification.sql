-- ============================================================
-- FIX: Message notifications must NEVER be sent to the sender.
-- Recreates notify_on_message() so it targets ONLY the other
-- participant of the conversation. Idempotent / safe to re-run.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_receiver_id UUID;
    v_sender_name TEXT;
BEGIN
    -- Resolve the OTHER participant in the conversation
    SELECT CASE
        WHEN participant_a = NEW.sender_id THEN participant_b
        ELSE participant_a
    END INTO v_receiver_id
    FROM public.conversations
    WHERE id = NEW.conversation_id;

    -- Guard: do not notify when there is no receiver or it is the sender
    IF v_receiver_id IS NULL OR v_receiver_id = NEW.sender_id THEN
        RETURN NEW;
    END IF;

    SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    INTO v_sender_name
    FROM public.profiles
    WHERE id = NEW.sender_id;

    PERFORM create_notification(
        v_receiver_id,                                   -- recipient (never the sender)
        'message',
        NEW.sender_id,                                   -- actor = the person who sent it
        NEW.conversation_id::text,
        'New Message',
        COALESCE(NULLIF(v_sender_name, ''), 'Someone') || ': ' || LEFT(NEW.body, 80),
        jsonb_build_object('conversationId', NEW.conversation_id)
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_on_message ON public.messages;
CREATE TRIGGER trigger_notify_on_message
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION notify_on_message();
