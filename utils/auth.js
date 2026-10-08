import AsyncStorage from '@react-native-async-storage/async-storage';

// Use the custom postgres.js client (backs onto Hlala Link MySQL API, not Supabase cloud).
import supabase from '../supabase';

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
const emitLogout = (v) => {
  logoutListeners.forEach((cb) => { try { cb(v); } catch (_) {} });
};

// Explicit sign-out: clear our session mirror FIRST, then sign out locally.
// The postgres.js signOut() just clears AsyncStorage and notifies listeners —
// no network call to Supabase pooler, so it never hangs on cPanel.
export async function signOutAndClear() {
  explicitSignOutPending = true;
  emitLogout(true);
  try {
    await AsyncStorage.removeItem('hlala_auth_mirror_v1');
  } catch (_) {}
  // The custom client's signOut clears AsyncStorage + fires SIGNED_OUT
  // without any network request to the Supabase pooler, so it cannot hang.
  try {
    await supabase.signOut();
  } catch (_) {
    // Fallback: force‑clear everything locally even if the client throws.
    try { await AsyncStorage.removeItem('hlala_link_token'); } catch (_) {}
    try { await AsyncStorage.removeItem('hlala_link_user'); } catch (_) {}
  }
  finally {
    emitLogout(false);
  }
}