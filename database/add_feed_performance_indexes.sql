-- Hlala Link feed performance indexes
-- Run once in the Supabase SQL editor. All statements are IF NOT EXISTS,
-- so re-running is safe. These cover the app's hottest queries:
--   feed (status + created_at), featured rail (status + views),
--   category feed (status + property_type + created_at),
--   movers list (role + created_at).

CREATE INDEX IF NOT EXISTS idx_properties_feed
  ON public.properties (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_properties_featured
  ON public.properties (status, views DESC);

CREATE INDEX IF NOT EXISTS idx_properties_category_feed
  ON public.properties (status, property_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_role_created
  ON public.profiles (role, created_at DESC);

-- Optional: faster ILIKE city/suburb suggestions (needs pg_trgm).
-- Uncomment if search-as-you-type feels slow with 10k+ properties.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_properties_city_trgm
--   ON public.properties USING gin (city gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS idx_properties_suburb_trgm
--   ON public.properties USING gin (suburb gin_trgm_ops);
