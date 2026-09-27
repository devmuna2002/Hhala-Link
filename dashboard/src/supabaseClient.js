import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ntzjjfbmpxgmjuorzwmv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8vLXHSsl6aVGAULRwATw0Q_SmyWGHEe';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
