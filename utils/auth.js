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

// Explicit sign-out: delete our session mirror FIRST, then sign out of
// supabase. Otherwise App's SIGNED_OUT handler revives the session from the
// mirror and the user never reaches the login screen.
export async function signOutAndClear() {
  explicitSignOutPending = true;
  try {
    await AsyncStorage.removeItem(AUTH_MIRROR_KEY);
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
}
