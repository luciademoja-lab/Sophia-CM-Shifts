// Edge Function: admins (Lucia, Aram) create RCM logins (username + password) and
// reset passwords. The logic lives in ../_shared/admin_users.ts and is unit-tested.
//
// Deploy: npx supabase --workdir backend functions deploy admin-users
// Needs no extra secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// are provided to every Edge Function by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleAdminUsers } from '../_shared/admin_users.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* handled as unknown action */ }

  const result = await handleAdminUsers(input, {
    callerIsAdmin: async () => {
      const { data, error } = await caller.rpc('is_admin');
      return !error && data === true;
    },
    createUser: async (u) => {
      const { data, error } = await service.auth.admin.createUser({ ...u, email_confirm: true });
      if (error || !data.user) throw new Error(error?.message ?? 'no user returned');
      return { id: data.user.id };
    },
    setRole: async (id, role) => {
      const { error } = await service.from('profiles').update({ role }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    setPassword: async (id, password) => {
      const { error } = await service.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(error.message);
    },
  });

  return new Response(JSON.stringify(result.body), { status: result.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
