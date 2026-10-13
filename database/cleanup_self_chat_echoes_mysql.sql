-- Cleanup: self-chat echoes ("my sent message came back to me").
--
-- WHAT THIS FIXES: message notifications whose recipient IS the sender
-- (user_id = actor_id) — created on self-chat threads where the "other
-- participant" resolves back to you. Each one shows your own sent text as a
-- New-message alert + badge. The backend no longer creates these (sender
-- guards in hlala-api + backend/server), so this is a one-time purge of the
-- backlog plus removal of empty self-chat threads.
--
-- SAFE: only deletes notification echo rows and EMPTY self-chat threads.
-- Real messages are never deleted. Self-chat threads that DO hold messages
-- are listed at the end for manual review (delete them in-app if unwanted).
--
-- HOW TO APPLY: run against the live MySQL database (phpMyAdmin → SQL, or
-- mysql CLI). MySQL string comparisons are case-insensitive by default, so
-- UUID case variants are caught too.

-- 1. Purge self-echo message notifications (recipient == actor).
DELETE FROM notifications
WHERE type IN ('message', 'landlord_message') AND user_id = actor_id;

-- 2. Drop EMPTY self-chat threads (both sides are me, zero messages).
DELETE c FROM conversations AS c
LEFT JOIN messages AS m ON m.conversation_id = c.id
WHERE c.participant_one <=> c.participant_two
  AND c.participant_one IS NOT NULL
  AND m.id IS NULL;

DELETE c FROM conversations AS c
LEFT JOIN messages AS m ON m.conversation_id = c.id
WHERE c.participant_a <=> c.participant_b
  AND c.participant_a IS NOT NULL
  AND m.id IS NULL;

-- 3. Review leftovers: self-chat threads that hold messages (manual check).
SELECT c.id, c.participant_one, c.participant_two, c.property_id,
       COUNT(m.id) AS message_count, MAX(m.created_at) AS last_message_at
FROM conversations AS c
LEFT JOIN messages AS m ON m.conversation_id = c.id
WHERE (c.participant_one <=> c.participant_two AND c.participant_one IS NOT NULL)
   OR (c.participant_a <=> c.participant_b AND c.participant_a IS NOT NULL)
GROUP BY c.id, c.participant_one, c.participant_two, c.property_id;
