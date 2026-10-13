-- Merge duplicate chat threads so split history reunites side-by-side.
--
-- WHY: blind conversation inserts created several threads for the same
-- (user pair + property). Each side's messages landed in different threads,
-- so every chat looked one-sided (only your own bubbles). This moves every
-- message into the OLDEST thread of each (pair + property) group and deletes
-- the empty dupes. General chats (property_id NULL) are grouped together too.
--
-- SAFE TO RUN ON LIVE DATA: only groups with >1 thread are touched, messages
-- are moved (never deleted), and the surviving thread keeps its id. Distinct
-- listings keep their own separate threads.
--
-- HOW TO APPLY: Supabase Dashboard → SQL Editor → paste → Run. Afterwards
-- reload the app (Expo Go: press `r` in the terminal) and reopen the chat —
-- both sides will render left/right as sent/received.

DO $$
DECLARE
    grp RECORD;
    main_conv_id UUID;
    moved_count INTEGER;
BEGIN
    -- One group = same unordered user pair + same property (NULL-safe).
    FOR grp IN
        SELECT
            LEAST(participant_a, participant_b) AS user1,
            GREATEST(participant_a, participant_b) AS user2,
            COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid) AS prop,
            COUNT(*) AS conv_count
        FROM conversations
        GROUP BY
            LEAST(participant_a, participant_b),
            GREATEST(participant_a, participant_b),
            COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
        HAVING COUNT(*) > 1
    LOOP
        -- Oldest thread wins: existing caches/notifications point at ids,
        -- and the app's lookups prefer the earliest thread too.
        SELECT id INTO main_conv_id
        FROM conversations
        WHERE LEAST(participant_a, participant_b) = grp.user1
          AND GREATEST(participant_a, participant_b) = grp.user2
          AND COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid) = grp.prop
        ORDER BY created_at ASC
        LIMIT 1;

        -- Move every message from the dupe threads into the main thread.
        UPDATE messages
        SET conversation_id = main_conv_id
        WHERE conversation_id IN (
            SELECT id FROM conversations
            WHERE LEAST(participant_a, participant_b) = grp.user1
              AND GREATEST(participant_a, participant_b) = grp.user2
              AND COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid) = grp.prop
              AND id != main_conv_id
        );
        GET DIAGNOSTICS moved_count = ROW_COUNT;

        -- Keep the thread ordering fresh on the merged thread.
        UPDATE conversations
        SET last_message_at = (
            SELECT COALESCE(MAX(created_at), conversations.last_message_at)
            FROM messages
            WHERE messages.conversation_id = main_conv_id
        )
        WHERE id = main_conv_id;

        -- Delete the now-empty duplicate thread rows.
        DELETE FROM conversations
        WHERE LEAST(participant_a, participant_b) = grp.user1
          AND GREATEST(participant_a, participant_b) = grp.user2
          AND COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid) = grp.prop
          AND id != main_conv_id;

        RAISE NOTICE 'Merged % thread(s) for pair % / % (property %): % message(s) moved into %',
            grp.conv_count - 1, grp.user1, grp.user2, grp.prop, moved_count, main_conv_id;
    END LOOP;
END $$;

-- Stop future dupes at the database level (order-insensitive, per property).
-- General chats (property_id NULL) are NOT covered by unique indexes
-- (Postgres treats NULLs as distinct) — the app now looks those up before
-- inserting, so rerun this script only if dupes ever reappear.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair_property
ON public.conversations (
  LEAST(participant_a, participant_b),
  GREATEST(participant_a, participant_b),
  COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
