import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { attachRatings } from './ratings';
import { withTimeout } from './network';
import { prefetchFeedCovers } from './imageUrl';

// Warm the home-feed cache so the feed paints instantly on first mount
// (e.g. right after login) instead of fetching from scratch. Fire-and-
// forget: never throws, never blocks the caller.
const SELECT_COLUMNS =
  'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, address, property_type, created_at, views, owner_id, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, business_name, avatar_url, role)';

export async function prefetchFeedCache() {
  try {
    const [{ data: featured }, { data: recent }] = await withTimeout(
      Promise.all([
        supabase
          .from('properties')
          .select(SELECT_COLUMNS)
          .eq('status', 'available')
          .order('views', { ascending: false })
          .limit(5),
        supabase
          .from('properties')
          .select(SELECT_COLUMNS)
          .eq('status', 'available')
          .order('created_at', { ascending: false }),
      ]),
      12000,
      'prefetch'
    );
    const rated = await withTimeout(attachRatings(recent || []), 8000, 'ratings').catch(
      () => recent || []
    );
    await Promise.all([
      AsyncStorage.setItem('cached_listings', JSON.stringify(rated)),
      featured
        ? AsyncStorage.setItem('cached_featured_listings', JSON.stringify(featured))
        : Promise.resolve(),
    ]).catch(() => {});
    prefetchFeedCovers(rated);
  } catch (_) {
    // Offline or slow network — the feed falls back to its own cache path.
  }
}
