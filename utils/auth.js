import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

export const AUTH_MIRROR_KEY = 'hlala_auth_mirror_v1';

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
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

// Explicit sign-out: delete our session mirror FIRST, then sign out of
// supabase. Otherwise App's SIGNED_OUT handler revives the session from the
// mirror and the user never reaches the login screen.
export async function signOutAndClear() {
  explicitSignOutPending = true;
  emitLogout(true);
  try {
  try {
    await AsyncStorage.removeItem(AUTH_MIRROR_KEY);
  } catch (_) {}
  // Stop this device receiving the signed-out user's pushes: clear the
  // token while still authenticated (RLS only lets owners edit own row),
  // with a short timeout so logout never hangs on a bad network.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      try {
        await Promise.race([
          supabase.from('profiles').update({ push_token: null }).eq('id', uid),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      } catch (_) {}
    }
  } catch (_) {}
  // Never let a slow/hung network delay logout: race the server call and
  // fall back to a local-only sign-out that clears storage immediately.
  try {
    await Promise.race([
      supabase.auth.signOut(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('signout timeout')), 3000)),
    ]);
  } catch (_) {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (_) {}
  }
  } finally {
    emitLogout(false);
  }
}
