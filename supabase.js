import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ntzjjfbmpxgmjuorzwmv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8vLXHSsl6aVGAULRwATw0Q_SmyWGHEe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Mobile-tuned realtime: phone radios drop idle sockets (tower handoffs,
  // elevator, WiFi↔cellular switches). A 20s heartbeat notices a dead
  // socket quickly, and capped exponential backoff reconnects without
  // hammering the server or the battery.
  realtime: {
    params: { eventsPerSecond: 10 },
    heartbeatIntervalMs: 20000,
    reconnectAfterMs: (tries) => Math.min(1000 * 2 ** Math.max(tries - 1, 0), 15000),
    timeout: 20000,
  },
});

// Fast local user lookup — reads the persisted session from AsyncStorage
// WITHOUT a network round-trip. supabase.auth.getUser() hits /auth/v1/user
// over the network on EVERY call (~200-600ms on cellular); getSession()
// resolves locally in ~1-5ms. The returned user object carries the same
// id/email/user_metadata the screens need. Use this everywhere a screen
// just needs "who is signed in" before running its real queries.
export async function getSessionUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch {
    return null;
  }
}
