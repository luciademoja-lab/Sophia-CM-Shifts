// Which backend the app talks to. A production build without the Supabase keys shows a
// configuration error instead of quietly running on demo data (where real logins fail).
export type BackendMode = 'live' | 'demo' | 'missing-config';
export type Env = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string; MODE?: string; DEV?: boolean };

export function backendMode(env: Env): BackendMode {
  if (env.VITE_SUPABASE_URL?.trim() && env.VITE_SUPABASE_ANON_KEY?.trim()) return 'live';
  if (env.DEV || env.MODE === 'e2e') return 'demo';
  return 'missing-config';
}
