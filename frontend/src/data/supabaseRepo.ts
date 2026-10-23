// Repository backed by Supabase: reads tables through RLS, writes through the
// Postgres functions in backend/supabase/migrations, logins via the admin-users function.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeCoverage } from '../lib/coverage';
import type { LogEntry, Profile, Report, Shift } from '../lib/shifts';
import { usernameToEmail } from '../../../backend/supabase/functions/_shared/username.ts';
import { parseDbError, RepoError, type Repo, type Snapshot } from './repo';

type ProfileRow = { id: string; username: string; full_name: string; role: 'admin' | 'rcm'; timezone: string | null; active: boolean };
type ShiftRow = { id: string; owner: string; starts_at: string; ends_at: string; status: Shift['status']; covers_id: string | null };
type LogRow = { id: number; at: string; actor: string; owner: string; action: LogEntry['action']; starts_at: string | null; ends_at: string | null; from_owner: string | null; shift_id: string | null };
type ReportRow = { shift_id: string; owner: string; worked_minutes: number; notes: string; updated_at: string; updated_by: string | null };

const toProfile = (r: ProfileRow): Profile => ({ id: r.id, username: r.username, fullName: r.full_name, role: r.role, timezone: r.timezone, active: r.active });
const toShift = (r: ShiftRow): Shift => ({ id: r.id, owner: r.owner, start: Date.parse(r.starts_at), end: Date.parse(r.ends_at), status: r.status, coversId: r.covers_id });
const toLog = (r: LogRow): LogEntry => ({
  id: String(r.id), at: Date.parse(r.at), actor: r.actor, owner: r.owner, action: r.action,
  start: r.starts_at ? Date.parse(r.starts_at) : 0, end: r.ends_at ? Date.parse(r.ends_at) : 0, fromOwner: r.from_owner, shiftId: r.shift_id,
});
const toReport = (r: ReportRow): Report => ({
  shiftId: r.shift_id, owner: r.owner, workedMinutes: r.worked_minutes, notes: r.notes, updatedAt: Date.parse(r.updated_at), updatedBy: r.updated_by,
});
const iso = (ms: number) => new Date(ms).toISOString();

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw parseDbError(res.error.message);
  return res.data;
}

export function createSupabaseRepo(url: string, anonKey: string): Repo {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  async function callAdmin(body: Record<string, unknown>) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (!error) return data as Record<string, unknown>;
    const ctx = (error as { context?: Response }).context;
    let msg = error.message, status = 0;
    if (ctx && typeof ctx.json === 'function') {
      status = ctx.status;
      try { msg = ((await ctx.json()) as { error?: string }).error || msg; } catch { /* keep message */ }
    }
    throw new RepoError(status === 409 ? 'conflict' : status === 403 ? 'forbidden' : status === 400 ? 'invalid' : 'network', msg);
  }

  return {
    mode: 'live',
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.id ?? null;
    },
    async signIn(username, password) {
      const { error } = await sb.auth.signInWithPassword({ email: usernameToEmail(username), password });
      if (error) throw new RepoError(/fetch|network/i.test(error.message) ? 'network' : 'bad_login', 'Wrong username or password.');
    },
    async signOut() { await sb.auth.signOut(); },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async load(from, to): Promise<Snapshot> {
      const uid = (await sb.auth.getSession()).data.session?.user.id ?? null;
      const [p, s, l, c] = await Promise.all([
        sb.from('profiles').select('id, username, full_name, role, timezone, active'),
        sb.from('shifts').select('id, owner, starts_at, ends_at, status, covers_id').lt('starts_at', iso(to)).gt('ends_at', iso(from)).order('starts_at'),
        sb.from('shift_log').select('id, at, actor, owner, action, starts_at, ends_at, from_owner, shift_id').order('at', { ascending: false }).limit(80),
        sb.from('coverage').select('tz, days').maybeSingle(),
      ]);
      const profiles = Object.fromEntries((check(p) as ProfileRow[]).map((r) => [r.id, toProfile(r)]));
      const shifts = (check(s) as ShiftRow[]).map(toShift);
      const log = (check(l) as LogRow[]).map(toLog).reverse();
      const ids = [...new Set([...shifts.map((x) => x.id), ...log.map((x) => x.shiftId).filter((x): x is string => !!x)])];
      const reports: Record<string, Report> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const r = await sb.from('shift_reports').select('shift_id, owner, worked_minutes, notes, updated_at, updated_by').in('shift_id', ids.slice(i, i + 200));
        for (const row of check(r) as ReportRow[]) reports[row.shift_id] = toReport(row);
      }
      return { me: uid ? profiles[uid] ?? null : null, profiles, shifts, log, coverage: normalizeCoverage(check(c)), reports };
    },
    subscribe(onChange) {
      const ch = sb.channel('rcm-board');
      for (const table of ['shifts', 'shift_log', 'coverage', 'profiles', 'shift_reports']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange());
      }
      ch.subscribe();
      return () => { void sb.removeChannel(ch); };
    },

    async setMyTimezone(tz) { check(await sb.rpc('set_my_timezone', { p_tz: tz })); },
    async bookShift(start, end, owner, restore) {
      return check(await sb.rpc('book_shift', { p_start: iso(start), p_end: iso(end), p_owner: owner ?? null, p_restore: !!restore })) as string;
    },
    async updateShift(id, start, end, owner) {
      check(await sb.rpc('update_shift', { p_id: id, p_start: iso(start), p_end: iso(end), p_owner: owner ?? null }));
    },
    async deleteShift(id) { check(await sb.rpc('delete_shift', { p_id: id })); },
    async askCover(id) { check(await sb.rpc('ask_cover', { p_id: id })); },
    async cancelAsk(id) { check(await sb.rpc('cancel_ask', { p_id: id })); },
    async takeShift(id, forId) { return check(await sb.rpc('take_shift', { p_id: id, p_for: forId ?? null })) as string; },
    async setCoverage(tz, days) { check(await sb.rpc('set_coverage', { p_tz: tz, p_days: days })); },

    async saveReport(shiftId, workedMinutes, notes) {
      check(await sb.rpc('save_report', { p_shift: shiftId, p_worked_minutes: workedMinutes, p_notes: notes }));
    },
    async deleteReport(shiftId) { check(await sb.rpc('delete_report', { p_shift: shiftId })); },

    async createLogin(l) {
      const r = await callAdmin({ action: 'create', ...l });
      return { id: String(r.id), username: String(r.username) };
    },
    async resetPassword(userId, password) { await callAdmin({ action: 'reset_password', userId, password }); },
    async updateProfile(id, fullName, role, active) {
      check(await sb.rpc('admin_update_profile', { p_id: id, p_full_name: fullName, p_role: role, p_active: active }));
    },
  };
}
