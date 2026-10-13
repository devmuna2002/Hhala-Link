-- ═══════════════════════════════════════════════════════════════
--  Remove Match Alerts (saved-search notifications)
--  Run this in the Supabase SQL Editor once.
--
--  Drops the trigger that fires a 'search_match' notification to every
--  user whose saved search matches a newly listed property, plus its
--  helper function. Existing saved_searches rows are left untouched;
--  they simply stop notifying. The app no longer links to the
--  Match Alerts screen.
-- ═══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trigger_notify_on_search_match ON public.properties;
DROP FUNCTION IF EXISTS notify_on_saved_search_match();
