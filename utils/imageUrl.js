import { supabase } from '../supabase';
import { Image as ExpoImage } from 'expo-image';

const STORAGE_PUBLIC_BASE = `${supabase.supabaseUrl}/storage/v1/object/public`;

export const DEFAULT_IMAGE_URL = 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?q=80&w=1000&auto=format&fit=crop';

// Normalize any image reference to a fully-qualified public URL.
// Handles bare storage paths and resolves to the cPanel storage endpoint.
// Normalize storage URLs to the configured cPanel API host.

export function toPublicImageUrl(value) {
  if (!value) return '';
  const raw = (typeof value === 'string' ? value : '').trim();
  if (!raw) return '';
  
  const storageMarker = '/storage/v1/object/public/';
  const storageIndex = raw.indexOf(storageMarker);
  if (storageIndex >= 0) {
    const relativePath = raw.slice(storageIndex + storageMarker.length);
    return `${STORAGE_PUBLIC_BASE}/${relativePath}`;
  }
  
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  const clean = raw.replace(/^\//, '');
  return `${STORAGE_PUBLIC_BASE}/properties/${clean}`;
}

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;

// Warm the image cache for feed covers right after listings load, so cards
// (and re-renders/remounts after login) paint instantly instead of popping
// in one by one. Videos are skipped. Fire-and-forget — never throws.
export function prefetchFeedCovers(listings, limit = 12) {
  try {
    const urls = [];
    for (const p of listings || []) {
      const imgs = p?.property_images || [];
      const cover = imgs.find(i => i && i.url && !isVideoRef(i)) || imgs.find(i => i && i.url);
      const url = toPublicImageUrl(cover && cover.url);
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length >= limit) break;
    }
    urls.forEach(u => {
      try {
        const r = ExpoImage.prefetch(u);
        if (r && r.catch) r.catch(() => {});
      } catch (_) {}
    });
  } catch (_) {}
}

function isVideoRef(img) {
  if (!img || !img.url) return false;
  return img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url);
}