export function autoDescription(item) {
  if (!item) return '';
  const beds = item.bedrooms != null ? item.bedrooms : 2;
  const baths = item.bathrooms != null ? item.bathrooms : 2;
  const type = item.property_type ? String(item.property_type).toLowerCase() : 'property';
  const place = [item.suburb, item.city].filter(Boolean).join(', ');
  const purpose = item.listing_purpose === 'sale' ? 'for sale' : 'for rent';
  const location = place ? ` in ${place}` : '';
  return `A comfortable ${beds}-bedroom, ${baths}-bathroom ${type}${location}, available ${purpose}. Contact the agent for more details.`;
}

export function listingDescription(item) {
  const d = item && item.description ? String(item.description).trim() : '';
  return d || autoDescription(item);
}