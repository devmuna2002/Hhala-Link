-- HLALA LINK: CONVERSATION MERGE & UNIFICATION
-- This script unifies all chat threads between the same two users into a single thread.
-- It moves all messages from duplicate conversations into one main thread per pair.

-- 1. Identify and merge messages into the oldest conversation for each user pair
DO $$
DECLARE
    conv_pair RECORD;
    main_conv_id UUID;
BEGIN
    -- Loop through all pairs of users who have more than one conversation
    FOR conv_pair IN 
        SELECT 
            LEAST(participant_a, participant_b) as user1,
            GREATEST(participant_a, participant_b) as user2,
            COUNT(*) as conv_count
        FROM conversations
        GROUP BY LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b)
        HAVING COUNT(*) > 1
    LOOP
        -- Pick the oldest conversation as the "Main" one
        SELECT id INTO main_conv_id
        FROM conversations
        WHERE (participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
           OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1)
        ORDER BY created_at ASC
        LIMIT 1;

        -- Move all messages from other conversations of this pair to the main one
        UPDATE messages
        SET conversation_id = main_conv_id
        WHERE conversation_id IN (
            SELECT id FROM conversations
            WHERE ((participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
               OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1))
              AND id != main_conv_id
        );

        -- Delete the duplicate conversation records
        DELETE FROM conversations
        WHERE ((participant_a = conv_pair.user1 AND participant_b = conv_pair.user2)
           OR (participant_a = conv_pair.user2 AND participant_b = conv_pair.user1))
          AND id != main_conv_id;
    END LOOP;
END $$;

-- 2. Drop the old property-specific unique constraint
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_participant_a_participant_b_property_id_key;

-- 3. Create a new strict unique index on the user pair (ignoring order and property)
-- This ensures that only one conversation can EVER exist between any two users.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair 
ON conversations (LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b));

-- 4. (Optional) Remove property_id from conversations if you want to be truly clean, 
-- but keeping it as a "reference" for where it started is fine. 
-- However, we should remove the NOT NULL if it exists (it's already nullable).
