export function listingPricePrimary(item) {
  const rent = item && item.rent_usd != null ? Number(item.rent_usd) : null;
  const sale = item && item.sale_price_usd != null ? Number(item.sale_price_usd) : null;
  if (rent && sale) return `$${rent}/mo`;
  if (rent) return `$${rent}/mo`;
  if (sale) return `$${sale}`;
  return 'Price on request';
}

export function listingPriceSecondary(item) {
  const rent = item && item.rent_usd != null ? Number(item.rent_usd) : null;
  const sale = item && item.sale_price_usd != null ? Number(item.sale_price_usd) : null;
  if (rent && sale) return `$${sale} to buy`;
  return null;
}

export function listingPurposeLabel(item) {
  if (!item) return 'For Rent';
  if (item.listing_purpose === 'sale') return 'For Sale';
  if (item.listing_purpose === 'both') return 'Rent or Buy';
  return 'For Rent';
}
