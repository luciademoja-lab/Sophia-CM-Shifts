// Picks the repository: Supabase when configured, otherwise demo mode in memory.
import { createMemoryRepo } from './memoryRepo';
import { createSupabaseRepo } from './supabaseRepo';
import { demoSeed } from './demoSeed';
import type { Repo } from './repo';

export function createRepo(): Repo {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? createSupabaseRepo(url, key) : createMemoryRepo(demoSeed(Date.now()));
}
