import AsyncStorage from '@react-native-async-storage/async-storage';
import { withTimeout } from './network';

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

// Remove only this device's Expo token from the profile, preserving any
// merged web-push subscription that shares the push_token column.
async function clearDevicePushToken(userId) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('id', userId)
      .maybeSingle();
    const stored = data?.push_token;
    if (!stored) return;
    let parsed = null;
    try {
      parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
    } catch (_) {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      let changed = false;
      for (const key of ['expo', 'token']) {
        if (typeof parsed[key] === 'string' && parsed[key].startsWith('ExponentPushToken')) {
          delete parsed[key];
          changed = true;
        }
      }
      if (!changed) return;
      const remaining = Object.keys(parsed);
      await supabase
        .from('profiles')
        .update({ push_token: remaining.length ? JSON.stringify(parsed) : null })
        .eq('id', userId);
      return;
    }
    if (typeof stored === 'string' && stored.trim().startsWith('ExponentPushToken')) {
      await supabase.from('profiles').update({ push_token: null }).eq('id', userId);
    }
  } catch (_) {}
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
// Every network step is time-boxed — on a flaky link logout must still
// finish locally instead of hanging on "Logging out…".
// The cPanel client signOut() clears AsyncStorage and notifies listeners.
export async function signOutAndClear() {
  explicitSignOutPending = true;
  emitLogout(true);
  // Detach this device's Expo token from the signing-out profile BEFORE the
  // session is cleared (the request needs the auth header). Otherwise two
  // accounts sharing one test phone both point at the same token and the
  // sender's own messages pop up as notifications on the shared device.
  // Best-effort with a hard cap: never blocks logout.
  try {
    const me = await withTimeout(
      Promise.resolve().then(() => getSessionUser()).catch(() => null),
      3500,
      'logout-whoami'
    ).catch(() => null);
    if (me?.id) {
      await withTimeout(clearDevicePushToken(me.id), 3500, 'logout-token').catch(() => {});
    }
  } catch (_) {}
  try {
    await AsyncStorage.removeItem('hlala_auth_mirror_v1');
  } catch (_) {}
  try {
    // NOTE: the cPanel adapter exposes signOut on `auth`, not top-level —
    // calling supabase.signOut() throws TypeError and the session is never
    // cleared, which made logout look completely unresponsive.
    const doSignOut = typeof supabase?.auth?.signOut === 'function'
      ? () => supabase.auth.signOut()
      : (typeof supabase?.signOut === 'function' ? () => supabase.signOut() : null);
    if (doSignOut) {
      await withTimeout(doSignOut(), 6000, 'logout-signout').catch(() => {});
    }
  } catch (_) {
    // Fall through to the forced local clear below.
  }
  finally {
    // Always finish locally even if the client call timed out or threw.
    try { await AsyncStorage.removeItem('hlala_link_token'); } catch (_) {}
    try { await AsyncStorage.removeItem('hlala_link_user'); } catch (_) {}
    emitLogout(false);
  }
}