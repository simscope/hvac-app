import { createClient } from '@supabase/supabase-js';

// Build configuration is required: an omitted variable must never reconnect to a retired backend.
const configuredUrl = (process.env.REACT_APP_SUPABASE_URL || '').trim();
export const SUPABASE_URL = configuredUrl === 'same-origin'
  ? window.location.origin
  : configuredUrl.replace(/\/+$/, '');
// Preserve existing browser sessions when the transport moves from MSI to the app origin.
export const SUPABASE_STORAGE_KEY = 'sb-msi-auth-token';
export const SUPABASE_ANON_KEY = (process.env.REACT_APP_SUPABASE_ANON_KEY || '').trim();
// OAuth cookies belong to the browser app. Vercel proxies this path to the MSI API.
export const FUNCTIONS_URL = (process.env.REACT_APP_SUPABASE_FUNCTIONS_URL || '/functions/v1').trim().replace(/\/+$/, '');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are required');
}

export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;
export const functionsUrl = FUNCTIONS_URL;

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: SUPABASE_STORAGE_KEY },
});
export const supabase = client;
export default client;
