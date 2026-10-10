import AsyncStorage from '@react-native-async-storage/async-storage';

// Use the cPanel MySQL client.
import supabase, { getSessionUser } from '../supabase';
export { getSessionUser };

// Marks a DELIBERATE logout so App's SIGNED_OUT handler can skip the
// multi-second session-restore loop and drop to the login screen instantly.
// (Spurious sign-outs from network blips still get the full restore path.)
let explicitSignOutPending = false;

export function consumeExplicitSignOut() {
  const v = explicitSignOutPending;
  explicitSignOutPending = false;
  return v;
}

// Turn "agent.user@example.com" into "Agent" — a trailing "user" token is
// an email convention, not part of anyone's name. Used everywhere a
// display name is derived from an email address.
export function displayNameFromEmail(email) {
  const raw = String(email || '').split('@')[0] || '';
  const words = raw.split(/[._-]+/).filter(Boolean);
  while (words.length > 1 && /^(users?)$/i.test(words[words.length - 1])) {
    words.pop();
  }
  if (words.length === 0) return '';
}

// Logout progress subscribers (App renders a fullscreen spinner overlay).
const logoutListeners = new Set();
export function onLogoutStateChange(cb) {
  logoutListeners.add(cb);
  return () => { logoutListeners.delete(cb); };
}
export const emitLogout = (v) => {
  logoutListeners.forEach((cb) => { try { cb(v); } catch (_) {} });
};

// Explicit sign-out: clear our session mirror FIRST, then sign out locally.
// The cPanel client signOut() clears AsyncStorage and notifies listeners.
export async function signOutAndClear() {
  explicitSignOutPending = true;
  emitLogout(true);
  try {
    await AsyncStorage.removeItem('hlala_auth_mirror_v1');
  } catch (_) {}
  try {
    // NOTE: the cPanel adapter exposes signOut on `auth`, not top-level —
    // calling supabase.signOut() throws TypeError and the session is never
    // cleared, which made logout look completely unresponsive.
    if (typeof supabase?.auth?.signOut === 'function') await supabase.auth.signOut();
    else if (typeof supabase?.signOut === 'function') await supabase.signOut();
  } catch (_) {
    // Fallback: force‑clear everything locally even if the client throws.
    try { await AsyncStorage.removeItem('hlala_link_token'); } catch (_) {}
    try { await AsyncStorage.removeItem('hlala_link_user'); } catch (_) {}
  }
  finally {
    emitLogout(false);
  }
}