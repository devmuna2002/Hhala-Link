import AsyncStorage from '@react-native-async-storage/async-storage';

// DRAFT_KEY  = transient autosave slot (single, overwritten every keystroke).
// DRAFTS_KEY = explicit "Save draft" saves (the My Drafts list).
// The two never merge automatically: saving reuses the same id so the
// same draft is UPDATED, never duplicated. Only new content creates an entry.
export const DRAFT_KEY = 'hlala_listing_draft';
export const DRAFTS_KEY = 'hlala_listing_drafts';
const MIGRATED_KEY = 'hlala_listing_drafts_migrated_v1';

export const isDraftEmpty = (d) => {
  if (!d) return true;
  const f = d.form || {};
  return !String(f.title || '').trim() && !String(f.description || '').trim()
    && !String(f.rent_usd || '').trim() && !String(f.sale_price_usd || '').trim()
    && !String(f.address || '').trim() && !String(f.city || '').trim() && !String(f.suburb || '').trim()
    && !String(f.link || '').trim()
    && !(d.images || []).length && !d.video;
};

export const draftTitleOf = (d) => {
  const f = d?.form || {};
  const t = String(f.title || '').trim();
  if (t) return t;
  const desc = String(f.description || '').trim().replace(/\s+/g, ' ');
  if (desc) return desc.length > 50 ? `${desc.slice(0, 50)}…` : desc;
  return 'Untitled draft';
};

const readRawDrafts = async () => {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((d) => d && d.id) : [];
  } catch (_) {
    return [];
  }
};

// Content signature: two drafts with the same signature are the same draft,
// even if saved from different composer sessions (different ids).
const sigOf = (d) => {
  const f = d?.form || {};
  const norm = {};
  for (const k of Object.keys(f).sort()) {
    const v = f[k];
    norm[k] = typeof v === 'string' ? v.trim() : v;
  }
  const imgs = (d.images || []).map((i) =>
    i?.uri || (i?.base64 ? `b64:${i.base64.length}:${String(i.base64).slice(0, 32)}` : '?')
  );
  return JSON.stringify({ f: norm, imgs, vu: d.video?.uri || null, adv: !!d.isAdvert });
};

export async function listDrafts() {
  const all = (await readRawDrafts()).filter((d) => !isDraftEmpty(d));
  // Self-heal: collapse duplicates by id first, then by identical content
  // (keeps the newest). Repairs lists duplicated by older app versions.
  const byId = new Map();
  for (const d of all) {
    const prev = byId.get(d.id);
    if (!prev || (d.savedAt || 0) > (prev.savedAt || 0)) byId.set(d.id, d);
  }
  const seen = new Set();
  const clean = [];
  const sorted = [...byId.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  for (const d of sorted) {
    const s = sigOf(d);
    if (seen.has(s)) continue;
    seen.add(s);
    clean.push(d);
  }
  if (clean.length !== all.length) {
    try { await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(clean)); } catch (_) {}
  }
  return clean;
}

// One-time upgrade for drafts saved by older versions: moves the legacy
// autosave slot into the list once (by stable id / content match, never a
// copy), stamps it with a stable id, then never runs again.
export async function migrateLegacyDraftOnce() {
  try {
    if (await AsyncStorage.getItem(MIGRATED_KEY)) return;
    const raw = await AsyncStorage.getItem(DRAFT_KEY);
    if (raw) {
      const legacy = JSON.parse(raw);
      if (legacy && !isDraftEmpty(legacy)) {
        const id = legacy.id || `draft-${legacy.savedAt || Date.now()}`;
        const stamped = { ...legacy, id };
        const current = await readRawDrafts();
        const sig = sigOf(stamped);
        const exists = current.some((d) => d.id === id || sigOf(d) === sig);
        if (!exists) {
          current.unshift({ ...stamped, savedAt: stamped.savedAt || Date.now() });
          try { await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(current)); } catch (_) {}
        }
        try { await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(stamped)); } catch (_) {}
      }
    }
    try { await AsyncStorage.setItem(MIGRATED_KEY, '1'); } catch (_) {}
  } catch (_) {}
}

export async function upsertDraft(snapshot, existingId) {
  const wantId = (snapshot && snapshot.id) || existingId || null;
  try {
    const current = await readRawDrafts();
    const sig = sigOf({ ...(snapshot || {}), id: wantId || 'tmp' });
    // Same session id → update in place.
    let idx = wantId ? current.findIndex((d) => d.id === wantId) : -1;
    let id = wantId;
    if (idx < 0) {
      // Same content saved from a fresh session → update, never duplicate.
      idx = current.findIndex((d) => sigOf(d) === sig);
      if (idx >= 0) id = current[idx].id;
    }
    // Only genuinely new content gets a new entry.
    if (!id) id = `draft-${Date.now()}`;
    const entry = { ...(snapshot || {}), id, savedAt: Date.now() };
    if (idx >= 0) current[idx] = entry;
    else current.unshift(entry);
    try {
      await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(current));
    } catch (_) {
      // Quota: retry without media, keep text-only copy.
      const slim = { ...entry, images: [], video: null };
      await AsyncStorage.setItem(
        DRAFTS_KEY,
        JSON.stringify(current.map((d) => (d.id === id ? slim : d)))
      );
    }
    // Keep the autosave slot on the same stable id so resume keeps identity.
    try { await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(entry)); } catch (_) {}
    return { ok: true, id };
  } catch (_) {
    return { ok: false, id: wantId };
  }
}

export async function deleteDraft(id) {
  try {
    const current = await readRawDrafts();
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(current.filter((d) => d.id !== id)));
    // If the autosave slot pointed at this draft, clear it too.
    try {
      const legacyRaw = await AsyncStorage.getItem(DRAFT_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy && legacy.id === id) {
          await AsyncStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}
