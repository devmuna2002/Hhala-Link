import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vorhegfxprkdcylkwaum.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5lL3x6thNUtsZLXReMdrdg_fT5Fnkel';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
