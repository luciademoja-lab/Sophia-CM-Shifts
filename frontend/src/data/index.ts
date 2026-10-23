// Picks the repository: Supabase when configured, demo data in development and e2e builds.
import { backendMode } from './config';
import { createMemoryRepo } from './memoryRepo';
import { createSupabaseRepo } from './supabaseRepo';
import { demoSeed } from './demoSeed';
import type { Repo } from './repo';

/** null means the production build is missing its Supabase configuration. */
export function createRepo(): Repo | null {
  const env = import.meta.env as { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string; MODE?: string; DEV?: boolean };
  const mode = backendMode(env);
  if (mode === 'live') return createSupabaseRepo(env.VITE_SUPABASE_URL!.trim(), env.VITE_SUPABASE_ANON_KEY!.trim());
  if (mode === 'demo') return createMemoryRepo(demoSeed(Date.now()));
  return null;
}
