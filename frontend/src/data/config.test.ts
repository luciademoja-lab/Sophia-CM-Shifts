import { describe, it, expect } from 'vitest';
import { backendMode } from './config';

describe('backendMode', () => {
  it('uses Supabase when both keys are set', () => {
    expect(backendMode({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k', MODE: 'production', DEV: false })).toBe('live');
  });
  it('falls back to demo data only in development and e2e builds', () => {
    expect(backendMode({ MODE: 'development', DEV: true })).toBe('demo');
    expect(backendMode({ MODE: 'e2e', DEV: false })).toBe('demo');
  });
  it('never silently runs a production build on demo data', () => {
    expect(backendMode({ MODE: 'production', DEV: false })).toBe('missing-config');
    expect(backendMode({ VITE_SUPABASE_URL: 'https://x.supabase.co', MODE: 'production', DEV: false })).toBe('missing-config');
    expect(backendMode({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: 'k', MODE: 'production', DEV: false })).toBe('missing-config');
  });
});
