-- Per-property chat threads: one conversation per (user pair + property)
-- instead of a single merged thread per user pair.
--
-- WHY: contacting the same agent about 3 different listings currently lands
-- in ONE thread with no property context. After this migration each listing
-- gets its own exchange, while general (property-less) chats keep working.
--
-- SAFE TO RUN ON LIVE DATA: legacy tables hold at most one row per pair, so
-- nothing can conflict. NULL property_ids stay distinct (Postgres treats
-- NULLs as unequal), so general chats are unaffected.
--
-- HOW TO APPLY: paste into the Supabase Dashboard → SQL Editor → Run.
-- The app already falls back to the pair thread when this migration has not
-- been applied yet (unique-violation 23505), so old and new builds coexist.

DROP INDEX IF EXISTS public.idx_unique_conversation_pair;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair_property
ON public.conversations (
  LEAST(participant_a, participant_b),
  GREATEST(participant_a, participant_b),
  property_id
);
