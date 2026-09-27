-- ============================================================
-- PATCH: Listings (sale + rent) and Message Read Receipts
-- Run in the Supabase SQL Editor. Safe / idempotent.
-- ============================================================

-- 1. Make property rent optional (a "For Sale" listing may have no rent)
ALTER TABLE public.properties ALTER COLUMN rent_usd DROP NOT NULL;

-- 2. Ensure property size (area_sqm) is optional
ALTER TABLE public.properties ALTER COLUMN area_sqm DROP NOT NULL;

-- 3. Allow a sale price and a listing purpose (rent | sale | both)
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS sale_price_usd NUMERIC(10,2);
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS listing_purpose TEXT NOT NULL DEFAULT 'rent';

-- 4. Fix message read receipts: add an UPDATE policy for conversation participants.
--    Without this, RLS silently blocks marking received messages as "read".
DROP POLICY IF EXISTS "messages_update_participants" ON public.messages;
CREATE POLICY "messages_update_participants" ON public.messages
  FOR UPDATE
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
