/** Client adapter backed by the Hlala Link cPanel MySQL API. */
import { supabase, getSessionUser } from './postgres';
export { supabase, getSessionUser };
export * from './postgres';
export default supabase;
