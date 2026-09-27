import { supabase } from '../supabase';

export async function attachRatings(listings) {
  if (!listings || listings.length === 0) return listings;
  const ids = listings.map(l => l.id);
  const { data, error } = await supabase
    .from('reviews')
    .select('property_id, rating')
    .in('property_id', ids);
  if (error || !data) return listings;
  const byId = {};
  for (const r of data) {
    if (!byId[r.property_id]) byId[r.property_id] = { sum: 0, count: 0 };
    byId[r.property_id].sum += Number(r.rating) || 0;
    byId[r.property_id].count += 1;
  }
  return listings.map(l => {
    const m = byId[l.id];
    return {
      ...l,
      average_rating: m && m.count ? m.sum / m.count : null,
      review_count: m ? m.count : 0,
    };
  });
}