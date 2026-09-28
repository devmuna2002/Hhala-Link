-- Listing links on reservation messages: tag the property directly on the
-- chat message so it renders as a tappable listing link in the exchange.
--
-- WHY: when a tenant reserves a listing ("Message Agent" / inquiry draft),
-- the intro message carries property_id and the chat renders it as a
-- "View listing" link chip on that message.
--
-- SAFE TO RUN ON LIVE DATA: purely additive nullable column; existing rows
-- are untouched. The app retries message inserts WITHOUT property_id when
-- this column does not exist yet (error 42703), so old and new builds
-- coexist before/after this migration.
--
-- HOW TO APPLY: paste into the Supabase Dashboard → SQL Editor → Run.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_property
  ON public.messages(property_id);
