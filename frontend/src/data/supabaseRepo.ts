// Repository backed by Supabase: reads tables through RLS, writes through the
// Postgres functions in backend/supabase/migrations, logins via the admin-users function.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeCoverage, type Slot } from '../lib/coverage';
import type { Availability } from '../lib/availability';
import type { LogEntry, Profile, Report, Shift } from '../lib/shifts';
import type { WeeklyReport, WorkType } from '../lib/work';
import type { Task, TaskEvent, TaskTimeRow } from '../lib/tasks';
import type { ShiftSession } from '../lib/session';
import type { RepeatUnit, TodoTemplate } from '../lib/todos';
import { loginEmail } from '../../../backend/supabase/functions/_shared/username.ts';
import { parseDbError, RepoError, signInError, type Repo, type Snapshot } from './repo';

type ProfileRow = { id: string; username: string; full_name: string; role: 'admin' | 'rcm'; timezone: string | null; active: boolean };
type ShiftRow = { id: string; owner: string; starts_at: string; ends_at: string; status: Shift['status']; covers_id: string | null };
type LogRow = { id: number; at: string; actor: string; owner: string; action: LogEntry['action']; starts_at: string | null; ends_at: string | null; from_owner: string | null; shift_id: string | null };
type ReportRow = { shift_id: string; owner: string; worked_minutes: number; notes: string; work_types: WorkType[] | null; posters: string | null; updated_at: string; updated_by: string | null };
type ReportTaskRow = { shift_id: string; task_id: string; owner: string; minutes: number };
type TaskRow = { id: string; title: string; description: string; priority: Task['priority']; estimate_minutes: number; grabs_for: Task['grabsFor']; created_by: string | null; created_at: string };
type AssigneeRow = { task_id: string; person: string; status: Task['assignees'][number]['status']; done_at: string | null; updated_at: string };
type TaskLogRow = { id: number; at: string; actor: string | null; task_id: string | null; title: string; person: string | null; action: TaskEvent['action']; status: TaskEvent['status'] };
type WeeklyRow = { id: string; owner: string; week: string; worked_minutes: number; message: string; status: WeeklyReport['status']; submitted_at: string; decided_by: string | null; decided_at: string | null };

const toProfile = (r: ProfileRow): Profile => ({ id: r.id, username: r.username, fullName: r.full_name, role: r.role, timezone: r.timezone, active: r.active });
const toShift = (r: ShiftRow): Shift => ({ id: r.id, owner: r.owner, start: Date.parse(r.starts_at), end: Date.parse(r.ends_at), status: r.status, coversId: r.covers_id });
const toLog = (r: LogRow): LogEntry => ({
  id: String(r.id), at: Date.parse(r.at), actor: r.actor, owner: r.owner, action: r.action,
  start: r.starts_at ? Date.parse(r.starts_at) : 0, end: r.ends_at ? Date.parse(r.ends_at) : 0, fromOwner: r.from_owner, shiftId: r.shift_id,
});
const toReport = (r: ReportRow): Report => ({
  shiftId: r.shift_id, owner: r.owner, workedMinutes: r.worked_minutes, notes: r.notes, workTypes: r.work_types || [], posters: r.posters || '',
  tasks: [], updatedAt: Date.parse(r.updated_at), updatedBy: r.updated_by,
});
const toWeekly = (r: WeeklyRow): WeeklyReport => ({
  id: r.id, owner: r.owner, week: r.week, workedMinutes: r.worked_minutes, message: r.message, status: r.status,
  submittedAt: Date.parse(r.submitted_at), decidedBy: r.decided_by, decidedAt: r.decided_at ? Date.parse(r.decided_at) : null,
});
const iso = (ms: number) => new Date(ms).toISOString();
type SessionRow = { id: string; shift_id: string; owner: string; started_at: string; ended_at: string | null; check_due_at: string; ended_by: ShiftSession['endedBy'] };
type TemplateRow = { id: string; title: string; items: string[]; everyone: boolean; people: string[] | null; repeat_unit: RepeatUnit | null; repeat_every: number | null; repeat_from: string | null; slot_start: string | null; slot_end: string | null; mode: TodoTemplate['mode'] };
export const REALTIME_TABLES = ['shifts', 'shift_log', 'coverage', 'profiles', 'shift_reports', 'availability', 'availability_days',
  'notification_seen', 'tasks', 'task_assignees', 'task_log', 'report_tasks', 'weekly_reports', 'task_items', 'shift_sessions', 'session_todos', 'todo_templates'];

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
      let error: { message: string } | null = null;
      try { ({ error } = await sb.auth.signInWithPassword({ email: loginEmail(username), password })); }
      catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
      if (error) throw signInError(error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async load(from, to): Promise<Snapshot> {
      const uid = (await sb.auth.getSession()).data.session?.user.id ?? null;
      if (uid) await sb.rpc('close_stale_sessions'); // ends sessions nobody confirmed for 30 minutes
      const [p, s, l, c, aw, ad, ns, rq, tk, ta, tl, rt, wr, ti, ss, st, tt] = await Promise.all([
        sb.from('profiles').select('id, username, full_name, role, timezone, active'),
        sb.from('shifts').select('id, owner, starts_at, ends_at, status, covers_id').lt('starts_at', iso(to)).gt('ends_at', iso(from)).order('starts_at'),
        sb.from('shift_log').select('id, at, actor, owner, action, starts_at, ends_at, from_owner, shift_id').order('at', { ascending: false }).limit(80),
        sb.from('coverage').select('tz, days').maybeSingle(),
        sb.from('availability').select('owner, days'),
        sb.from('availability_days').select('owner, day, slots').gte('day', new Date(from - 2 * 86_400_000).toISOString().slice(0, 10)).lte('day', new Date(to + 2 * 86_400_000).toISOString().slice(0, 10)),
        sb.from('notification_seen').select('seen_at').maybeSingle(),
        sb.from('shifts').select('id, owner, starts_at, ends_at, status, covers_id').eq('status', 'pending').order('starts_at'),
        sb.from('tasks').select('id, title, description, priority, estimate_minutes, grabs_for, created_by, created_at').order('created_at'),
        sb.from('task_assignees').select('task_id, person, status, done_at, updated_at'),
        sb.from('task_log').select('id, at, actor, task_id, title, person, action, status').order('at', { ascending: false }).limit(100),
        sb.from('report_tasks').select('shift_id, task_id, owner, minutes'),
        sb.from('weekly_reports').select('id, owner, week, worked_minutes, message, status, submitted_at, decided_by, decided_at').order('week', { ascending: false }).limit(200),
        sb.from('task_items').select('id, task_id, position, label, url, done_at, done_by').order('position'),
        sb.from('shift_sessions').select('id, shift_id, owner, started_at, ended_at, check_due_at, ended_by').gte('started_at', iso(from - 7 * 86_400_000)).order('started_at'),
        sb.from('session_todos').select('session_id, template_id, item'),
        sb.from('todo_templates').select('id, title, items, everyone, people, repeat_unit, repeat_every, repeat_from, slot_start, slot_end, mode').order('title'),
      ]);
      const profiles = Object.fromEntries((check(p) as ProfileRow[]).map((r) => [r.id, toProfile(r)]));
      const shifts = (check(s) as ShiftRow[]).map(toShift);
      const log = (check(l) as LogRow[]).map(toLog).reverse();
      const ids = [...new Set([...shifts.map((x) => x.id), ...log.map((x) => x.shiftId).filter((x): x is string => !!x)])];
      const reports: Record<string, Report> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const r = await sb.from('shift_reports').select('shift_id, owner, worked_minutes, notes, work_types, posters, updated_at, updated_by').in('shift_id', ids.slice(i, i + 200));
        for (const row of check(r) as ReportRow[]) reports[row.shift_id] = toReport(row);
      }
      const availability: Record<string, Availability> = {};
      for (const pr of Object.values(profiles)) if (pr.role !== 'viewer') availability[pr.id] = { tz: pr.timezone, week: {}, days: {} };
      for (const row of check(aw) as Array<{ owner: string; days: unknown }>) {
        if (availability[row.owner]) availability[row.owner].week = normalizeCoverage({ tz: 'UTC', days: row.days })?.days || {};
      }
      for (const row of check(ad) as Array<{ owner: string; day: string; slots: Slot[] }>) {
        if (availability[row.owner]) availability[row.owner].days[row.day] = row.slots;
      }
      const reportTasks = check(rt) as ReportTaskRow[];
      for (const row of reportTasks) reports[row.shift_id]?.tasks.push({ taskId: row.task_id, minutes: row.minutes });
      const sums = new Map<string, TaskTimeRow>();
      for (const row of reportTasks) {
        const k = `${row.task_id}|${row.owner}`;
        const x = sums.get(k) || { taskId: row.task_id, person: row.owner, minutes: 0 };
        x.minutes += row.minutes; sums.set(k, x);
      }
      const assignees = check(ta) as AssigneeRow[];
      const itemRows = check(ti) as Array<{ id: string; task_id: string; label: string; url: string; done_at: string | null; done_by: string | null }>;
      const tasks: Task[] = (check(tk) as TaskRow[]).map((t) => ({
        id: t.id, title: t.title, description: t.description, priority: t.priority, estimateMinutes: t.estimate_minutes, grabsFor: t.grabs_for || 'rcm',
        createdBy: t.created_by, createdAt: Date.parse(t.created_at),
        assignees: assignees.filter((a) => a.task_id === t.id).map((a) => ({ person: a.person, status: a.status, doneAt: a.done_at ? Date.parse(a.done_at) : null, updatedAt: Date.parse(a.updated_at) })),
        items: itemRows.filter((i) => i.task_id === t.id).map((i) => ({ id: i.id, label: i.label, url: i.url, doneAt: i.done_at ? Date.parse(i.done_at) : null, doneBy: i.done_by })),
      }));
      const taskLog: TaskEvent[] = (check(tl) as TaskLogRow[]).reverse().map((e) => ({
        id: String(e.id), at: Date.parse(e.at), actor: e.actor, taskId: e.task_id, title: e.title, person: e.person, action: e.action, status: e.status,
      }));
      const seenRow = check(ns) as { seen_at: string } | null;
      return {
        me: uid ? profiles[uid] ?? null : null, profiles, shifts, log, coverage: normalizeCoverage(check(c)), reports, availability,
        notificationsSeenAt: seenRow ? Date.parse(seenRow.seen_at) : 0,
        requests: (check(rq) as ShiftRow[]).map(toShift),
        tasks, taskTime: [...sums.values()], taskLog, weeklyReports: (check(wr) as WeeklyRow[]).map(toWeekly),
        sessions: (check(ss) as SessionRow[]).map((r) => ({
          id: r.id, shiftId: r.shift_id, owner: r.owner, startedAt: Date.parse(r.started_at), endedAt: r.ended_at ? Date.parse(r.ended_at) : null,
          checkDueAt: Date.parse(r.check_due_at), endedBy: r.ended_by,
        })),
        sessionTodos: (check(st) as Array<{ session_id: string; template_id: string; item: number }>).map((r) => ({ sessionId: r.session_id, templateId: r.template_id, item: r.item })),
        todoTemplates: (check(tt) as TemplateRow[]).map((r) => ({
          id: r.id, title: r.title, items: r.items, everyone: r.everyone, people: r.people || [], mode: r.mode,
          repeat: r.repeat_unit ? { unit: r.repeat_unit, every: r.repeat_every ?? 1, from: Date.parse(r.repeat_from!) } : null,
          slot: r.slot_start && r.slot_end ? { start: Date.parse(r.slot_start), end: Date.parse(r.slot_end) } : null,
        })),
      };
    },
    subscribe(onChange) {
      // One channel per table: if a table is missing from the realtime publication,
      // only that table stops updating instead of the whole board.
      const channels = REALTIME_TABLES.map((table) =>
        sb.channel(`rcm-${table}`).on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange()).subscribe());
      return () => { for (const ch of channels) void sb.removeChannel(ch); };
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

    async saveReport(shiftId, x) {
      check(await sb.rpc('save_report', {
        p_shift: shiftId, p_worked_minutes: x.workedMinutes, p_notes: x.notes, p_work_types: x.workTypes, p_posters: x.posters,
        p_tasks: x.tasks.map((t) => ({ task_id: t.taskId, minutes: t.minutes })),
      }));
    },
    async submitWeekly(week, message) { return check(await sb.rpc('submit_weekly', { p_week: week, p_message: message })) as string; },
    async approveWeekly(id) { check(await sb.rpc('approve_weekly', { p_id: id })); },
    async rejectWeekly(id) { check(await sb.rpc('reject_weekly', { p_id: id })); },
    async createTask(t, people) {
      return check(await sb.rpc('create_task', { p_title: t.title, p_description: t.description, p_priority: t.priority, p_estimate: t.estimateMinutes, p_people: people, p_grabs_for: t.grabsFor ?? null })) as string;
    },
    async updateTask(id, t, people) {
      check(await sb.rpc('update_task', { p_id: id, p_title: t.title, p_description: t.description, p_priority: t.priority, p_estimate: t.estimateMinutes, p_people: people, p_grabs_for: t.grabsFor ?? null }));
    },
    async deleteTask(id) { check(await sb.rpc('delete_task', { p_id: id })); },
    async moveTask(id, person, status) { check(await sb.rpc('move_task', { p_id: id, p_person: person, p_status: status })); },
    async claimTask(id) { check(await sb.rpc('claim_task', { p_id: id })); },
    async createContractTasks(t, minutesEach, people, items) {
      return check(await sb.rpc('create_contract_tasks', {
        p_title: t.title, p_description: t.description, p_priority: t.priority, p_minutes_each: minutesEach, p_people: people,
        p_items: items.map((i) => ({ label: i.label, url: i.url })),
      })) as string[];
    },
    async startShift(shiftId) { return check(await sb.rpc('start_shift_session', { p_shift: shiftId })) as string; },
    async confirmShift(id) { check(await sb.rpc('confirm_shift_session', { p_id: id })); },
    async endShift(id) { check(await sb.rpc('end_shift_session', { p_id: id })); },
    async toggleSessionTodo(sessionId, templateId, item, done) {
      check(await sb.rpc('toggle_session_todo', { p_session: sessionId, p_template: templateId, p_item: item, p_done: done }));
    },
    async saveTodoTemplate(t) {
      const p = {
        title: t.title, items: t.items, everyone: t.everyone, people: t.people, mode: t.mode,
        repeat: t.repeat ? { unit: t.repeat.unit, every: t.repeat.every, from: iso(t.repeat.from) } : null,
        slot: t.slot ? { start: iso(t.slot.start), end: iso(t.slot.end) } : null,
      };
      return check(await sb.rpc('save_todo_template', { p_id: t.id || null, p })) as string;
    },
    async deleteTodoTemplate(id) { check(await sb.rpc('delete_todo_template', { p_id: id })); },
    async toggleTaskItem(id, done) { check(await sb.rpc('toggle_task_item', { p_item: id, p_done: done })); },
    async setAvailability(week, owner) {
      check(await sb.rpc('set_availability', { p_days: week, p_owner: owner ?? null }));
    },
    async setAvailabilityDay(day, slots, owner) {
      check(await sb.rpc('set_availability_day', { p_day: day, p_slots: slots, p_owner: owner ?? null }));
    },
    async approveShift(id) { check(await sb.rpc('approve_shift', { p_id: id })); },
    async rejectShift(id) { check(await sb.rpc('reject_shift', { p_id: id })); },
    async deleteLog(id) { check(await sb.rpc('delete_log', { p_id: Number(id) })); },
    async markNotificationsSeen() { check(await sb.rpc('mark_notifications_seen')); },
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
