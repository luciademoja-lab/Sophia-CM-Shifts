// In-memory repository with the same rules as the database functions.
// Used for demo mode (no Supabase configured) and for end-to-end tests.
import { isRequired, normalizeCoverage, validateCoverage, validateDaySlots, type Coverage, type CoverageDays, type Slot } from '../lib/coverage';
import { isAvailable, type Availability } from '../lib/availability';
import { canChange, findOverlap, historyFor, type LogAction, type LogEntry, type Profile, type Report, type Role, type Shift } from '../lib/shifts';
import { isValidTimeZone, parseDateValue } from '../lib/time';
import { canSubmitWeekly, reportWeek, validateReport, weeklyMinutes, type WeeklyReport } from '../lib/work';
import { canSeeTask, taskTimeRows, validateTask, STATUSES, type Task, type TaskEvent } from '../lib/tasks';
import { normalizeUsername, validatePassword, validateUsername } from '../../../backend/supabase/functions/_shared/username.ts';
import { RepoError, type NewLogin, type Repo, type Snapshot } from './repo';

export type SeedUser = { username: string; fullName: string; role: Role; password: string; timezone?: string | null; availability?: CoverageDays };
export type SeedTask = { title: string; description?: string; priority: Task['priority']; estimateMinutes: number; assignees: string[]; grabsFor?: Task['grabsFor'] };
export type Seed = {
  users: SeedUser[]; now?: () => number; coverage?: Coverage | null;
  shifts?: Array<{ owner: string; start: number; end: number; status?: 'booked' | 'open' }>;
  tasks?: SeedTask[];
};

let counter = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;
const fail = (code: ConstructorParameters<typeof RepoError>[0], msg: string) => { throw new RepoError(code, msg); };

export function createMemoryRepo(seed: Seed): Repo {
  const profiles = new Map<string, Profile>();
  const passwords = new Map<string, string>();
  let shifts: Shift[] = [];
  const log: LogEntry[] = [];
  const reports = new Map<string, Report>();
  const seen = new Map<string, number>();
  let tasks: Task[] = [];
  const taskLog: TaskEvent[] = [];
  const weekly: WeeklyReport[] = [];
  const now = seed.now || (() => Date.now());
  const weeks = new Map<string, CoverageDays>();
  const exceptions = new Map<string, Record<string, Slot[]>>();
  let coverage: Coverage | null = seed.coverage ?? null;
  let me: string | null = null;
  const listeners = new Set<() => void>();
  const authListeners = new Set<() => void>();

  for (const u of seed.users) {
    const id = newId('u');
    profiles.set(id, { id, username: normalizeUsername(u.username), fullName: u.fullName, role: u.role, timezone: u.timezone ?? null, active: true });
    passwords.set(id, u.password);
    if (u.availability) weeks.set(id, normalizeCoverage({ tz: 'UTC', days: u.availability })!.days);
  }
  const byUsername = (u: string) => [...profiles.values()].find((p) => p.username === normalizeUsername(u));
  for (const s of seed.shifts || []) {
    const owner = byUsername(s.owner);
    if (owner) shifts.push({ id: newId('s'), owner: owner.id, start: s.start, end: s.end, status: s.status || 'booked', coversId: null });
  }

  const lucia = [...profiles.values()].find((p) => p.role === 'admin');
  for (const t of seed.tasks || []) {
    tasks.push({
      id: newId('t'), title: t.title, description: t.description || '', priority: t.priority, estimateMinutes: t.estimateMinutes,
      grabsFor: t.grabsFor || 'rcm', createdBy: lucia?.id ?? null, createdAt: now(),
      assignees: t.assignees.map((u) => byUsername(u)).filter((p): p is Profile => !!p).map((p) => ({ person: p.id, status: 'todo', doneAt: null, updatedAt: now() })),
    });
  }

  const changed = () => listeners.forEach((f) => f());
  const current = (): Profile => {
    if (!me) return fail('not_signed_in', 'Sign in first.');
    const p = profiles.get(me);
    if (!p || !p.active) return fail('forbidden', 'This login is not active.');
    return p;
  };
  const writer = () => { const p = current(); if (p.role === 'viewer') fail('forbidden', 'You have read-only access.'); return p; };
  const admin = (msg: string) => { const p = current(); if (p.role !== 'admin') fail('forbidden', msg); return p; };
  const activeRcm = (id: string) => { const t = profiles.get(id); if (!t?.active || t.role === 'viewer') fail('invalid', 'That person has no active RCM login.'); };
  const range = (start: number, end: number) => {
    if (!(end > start)) fail('invalid', 'The end must be after the start.');
    if (end - start > 24 * 3_600_000) fail('invalid', 'A shift can last at most 24 hours.');
  };
  const availabilityOf = (id: string): Availability => ({ tz: profiles.get(id)?.timezone ?? null, week: weeks.get(id) || {}, days: exceptions.get(id) || {} });
  const rcmAvailable = (p: Profile, owner: string, start: number, end: number) => {
    if (p.role === 'rcm' && !isAvailable(availabilityOf(owner), start, end)) fail('invalid', 'This is outside your availability. Add these hours to your availability first.');
  };
  // Same rule as the database: inside required hours (or no target) and inside availability.
  const requiredAll = (start: number, end: number) => {
    const c = coverage ? normalizeCoverage(coverage) : null;
    if (!c || !Object.keys(c.days).length) return true;
    for (let t = start; t < end; t += 15 * 60_000) if (!isRequired(t + 1, c)) return false;
    return true;
  };
  const statusFor = (p: Profile, owner: string, start: number, end: number): 'booked' | 'pending' =>
    p.role === 'rcm' && !(isAvailable(availabilityOf(owner), start, end) && requiredAll(start, end)) ? 'pending' : 'booked';
  const lockPast = (p: Profile, s: Shift, what: string) => {
    if (p.role === 'rcm' && !canChange(s, p, now())) fail('forbidden', `Shifts of past days can only be ${what} by an admin.`);
  };
  const availabilityOwner = (p: Profile, owner: string | null | undefined) => {
    const o = owner || p.id;
    if (o !== p.id && p.role !== 'admin') fail('forbidden', 'Only admins can change someone else\'s availability.');
    activeRcm(o);
    return o;
  };
  const free = (start: number, end: number, ignore: string[]) => {
    const o = findOverlap(shifts, start, end, ignore);
    if (o) throw new RepoError('overlap', 'overlap', { who: profiles.get(o.owner)?.fullName || 'Someone', start: o.start, end: o.end });
  };
  const manageable = (id: string, p: Profile) => {
    if (p.role === 'viewer') fail('forbidden', 'You have read-only access.');
    const s = shifts.find((x) => x.id === id);
    if (!s) return fail('not_found', 'That shift no longer exists.');
    if (s.owner !== p.id && p.role !== 'admin') fail('forbidden', 'Only the person who booked this shift or an admin can change it.');
    return s;
  };
  const tzOf = (id: string) => profiles.get(id)?.timezone || 'UTC';
  const weekLocked = (p: Profile, s: Shift) => {
    if (p.role !== 'rcm') return;
    const w = weekly.find((x) => x.owner === s.owner && x.week === reportWeek(s.start, tzOf(s.owner)));
    if (w && w.status !== 'rejected') fail('invalid', 'The weekly report for this week was already sent; ask an admin to change it.');
  };
  const taskEvent = (actor: string, t: Task, action: TaskEvent['action'], person: string | null = null, status: TaskEvent['status'] = null) => {
    taskLog.push({ id: newId('k'), at: now(), actor, taskId: t.id, title: t.title, person, action, status });
  };
  const checkPeople = (people: string[]) => {
    for (const id of people) { const t = profiles.get(id); if (!t?.active || t.role === 'viewer') fail('invalid', 'Tasks can only be assigned to admins and RCMs.'); }
    return [...new Set(people)];
  };
  const decideWeekly = (id: string, status: 'approved' | 'rejected') => {
    const p = admin('Only admins approve weekly reports.');
    const w = weekly.find((x) => x.id === id);
    if (!w) return fail('not_found', 'That weekly report no longer exists.');
    if (w.status !== 'submitted') fail('invalid', 'This weekly report is not waiting for approval.');
    Object.assign(w, { status, decidedBy: p.id, decidedAt: now() }); changed();
  };
  const write = (actor: string, owner: string, action: LogAction, s: { id: string; start: number; end: number }, fromOwner: string | null = null) => {
    log.push({ id: newId('l'), at: now(), actor, owner, action, start: s.start, end: s.end, fromOwner, shiftId: s.id });
  };

  const repo: Repo = {
    mode: 'demo',
    async session() { return me; },
    async signIn(username, password) {
      const p = byUsername(username);
      if (!p || !p.active || passwords.get(p.id) !== password) fail('bad_login', 'Wrong username or password.');
      me = p!.id;
      authListeners.forEach((f) => f());
    },
    async signOut() { me = null; authListeners.forEach((f) => f()); },
    onAuthChange(cb) { authListeners.add(cb); return () => authListeners.delete(cb); },
    async load(from, to): Promise<Snapshot> {
      return {
        me: me ? { ...profiles.get(me)! } : null,
        profiles: Object.fromEntries([...profiles.values()].map((p) => [p.id, { ...p }])),
        shifts: shifts.filter((s) => s.end > from && s.start < to).map((s) => ({ ...s })).sort((a, b) => a.start - b.start),
        log: historyFor(log, me ? profiles.get(me)! : null, null).slice(-80).map((l) => ({ ...l })),
        notificationsSeenAt: me ? seen.get(me) ?? 0 : 0,
        requests: shifts.filter((s) => s.status === 'pending').map((s) => ({ ...s })).sort((a, b) => a.start - b.start),
        coverage: coverage ? normalizeCoverage(coverage) : null,
        reports: Object.fromEntries([...reports.values()].map((r) => [r.shiftId, { ...r }])),
        availability: Object.fromEntries([...profiles.values()].filter((p) => p.role !== 'viewer').map((p) => [p.id, structuredClone(availabilityOf(p.id))])),
        ...(() => {
          const viewer = me ? profiles.get(me)! : null;
          const role = viewer?.role;
          const visible = tasks.filter((t) => canSeeTask(t, viewer)).map((t) => ({
            ...t, assignees: t.assignees.filter((a) => role === 'admin' || a.person === me).map((a) => ({ ...a })),
          }));
          const rows = taskTimeRows([...reports.values()]).filter((x) => role === 'admin' || x.person === me);
          return {
            tasks: visible,
            taskTime: role === 'viewer' ? [] : rows,
            taskLog: role === 'admin' ? taskLog.map((e) => ({ ...e })) : [],
            weeklyReports: weekly.filter((w) => role === 'admin' || role === 'viewer' || w.owner === me).map((w) => ({ ...w })),
          };
        })(),
      };
    },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    async setMyTimezone(tz) {
      const p = current();
      if (!isValidTimeZone(tz)) fail('invalid', `Unknown time zone ${tz}.`);
      p.timezone = tz; changed();
    },
    async bookShift(start, end, owner, restore) {
      const p = writer();
      const o = owner || p.id;
      if (o !== p.id && p.role !== 'admin') fail('forbidden', 'Only admins can book for someone else.');
      activeRcm(o); range(start, end); free(start, end, []);
      const id = newId('s');
      const status = statusFor(p, o, start, end);
      shifts.push({ id, owner: o, start, end, status, coversId: null });
      write(p.id, o, status === 'pending' ? 'requested' : restore ? 'restored' : 'booked', { id, start, end }); changed();
      return id;
    },
    async updateShift(id, start, end, owner) {
      const p = current(); const s = manageable(id, p);
      if (s.status !== 'booked' && s.status !== 'pending') fail('invalid', 'Only booked shifts and requests can be changed.');
      lockPast(p, s, 'changed');
      const o = owner || s.owner;
      if (o !== s.owner) { if (p.role !== 'admin') fail('forbidden', 'Only admins can reassign shifts.'); activeRcm(o); }
      range(start, end); free(start, end, [s.id]);
      const status = p.role === 'admin' ? s.status : statusFor(p, o, start, end);
      Object.assign(s, { start, end, owner: o, status });
      write(p.id, o, status === 'pending' && p.role === 'rcm' ? 'requested' : 'edited', s); changed();
    },
    async deleteShift(id) {
      const p = current(); const s = manageable(id, p);
      if (s.status === 'covered') fail('invalid', 'This shift was taken over; delete the cover shift instead.');
      lockPast(p, s, 'deleted');
      shifts = shifts.filter((x) => x.id !== id);
      reports.delete(id);
      if (s.coversId) {
        const orig = shifts.find((x) => x.id === s.coversId);
        if (orig && orig.status === 'covered') orig.status = 'open';
        write(p.id, s.owner, 'gaveback', s);
      } else write(p.id, s.owner, 'deleted', s);
      changed();
    },
    async askCover(id) {
      const p = current(); const s = manageable(id, p);
      if (s.status !== 'booked' || s.coversId) fail('invalid', 'Only your own booked shifts can be put up for cover.');
      if (s.start <= now()) fail('invalid', 'This shift has already started.');
      s.status = 'open'; write(p.id, s.owner, 'ask', s); changed();
    },
    async cancelAsk(id) {
      const p = current(); const s = manageable(id, p);
      if (s.status !== 'open') fail('invalid', 'This shift is not waiting for cover.');
      s.status = 'booked'; write(p.id, s.owner, 'cancelask', s); changed();
    },
    async takeShift(id, forId) {
      const p = writer(); const taker = forId || p.id;
      if (taker !== p.id && p.role !== 'admin') fail('forbidden', 'Only admins can give a shift to someone.');
      activeRcm(taker);
      const s = shifts.find((x) => x.id === id);
      if (!s) return fail('not_found', 'That shift no longer exists.');
      if (s.status !== 'open') fail('invalid', 'This shift does not need cover any more.');
      if (s.owner === taker) fail('invalid', 'Withdraw the cover request instead of taking your own shift.');
      rcmAvailable(p, taker, s.start, s.end);
      free(s.start, s.end, [s.id]);
      s.status = 'covered';
      const nid = newId('s');
      shifts.push({ id: nid, owner: taker, start: s.start, end: s.end, status: 'booked', coversId: s.id });
      write(p.id, taker, 'took', { id: nid, start: s.start, end: s.end }, s.owner); changed();
      return nid;
    },
    async setCoverage(tz, days: CoverageDays) {
      admin('Only admins can change the coverage target.');
      if (!isValidTimeZone(tz)) fail('invalid', `Unknown time zone ${tz}.`);
      const err = validateCoverage(days);
      if (err) fail('invalid', err);
      coverage = normalizeCoverage({ tz, days }); changed();
    },

    async saveReport(shiftId, input) {
      const p = writer(); const s = manageable(shiftId, p);
      if (s.status === 'covered') fail('invalid', 'This shift was taken over; the cover shift gets the report.');
      if (s.status === 'pending') fail('invalid', 'This shift is waiting for an admin to approve it.');
      if (s.start > now()) fail('invalid', 'You can report on a shift once it has started.');
      weekLocked(p, s);
      const err = validateReport(input); if (err) fail('invalid', err);
      for (const t of input.tasks) {
        if (!tasks.find((x) => x.id === t.taskId)?.assignees.some((a) => a.person === s.owner)) fail('invalid', 'You can only link tasks assigned to the person who worked the shift.');
      }
      const poster = input.workTypes.includes('poster_issues');
      reports.set(shiftId, {
        shiftId, owner: s.owner, workedMinutes: input.workedMinutes, notes: input.notes.trim(), workTypes: [...input.workTypes],
        posters: poster ? input.posters.trim() : '', tasks: input.tasks.map((t) => ({ ...t })), updatedAt: now(), updatedBy: p.id,
      });
      write(p.id, s.owner, 'reported', s); changed();
    },
    async deleteReport(shiftId) {
      const p = writer(); const s = manageable(shiftId, p);
      weekLocked(p, s);
      reports.delete(shiftId); changed();
    },

    async submitWeekly(week, message) {
      const p = writer();
      if (p.role !== 'rcm') fail('forbidden', 'Only RCMs send weekly reports.');
      const d = parseDateValue(week);
      if (!d || new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() !== 1) fail('invalid', 'Pick the Monday of the week.');
      const tz = tzOf(p.id);
      if (!canSubmitWeekly(week, tz, now())) fail('invalid', 'You can send the weekly report from Sunday.');
      if (!message.trim() || message.length > 8000) fail('invalid', 'Write the weekly report (up to 8000 characters).');
      const minutes = weeklyMinutes(p.id, week, tz, shifts, Object.fromEntries(reports));
      const w = weekly.find((x) => x.owner === p.id && x.week === week);
      if (w) {
        if (w.status === 'approved') fail('invalid', 'This weekly report was already approved.');
        Object.assign(w, { workedMinutes: minutes, message: message.trim(), status: 'submitted', submittedAt: now(), decidedBy: null, decidedAt: null });
        changed(); return w.id;
      }
      const id = newId('w');
      weekly.push({ id, owner: p.id, week, workedMinutes: minutes, message: message.trim(), status: 'submitted', submittedAt: now(), decidedBy: null, decidedAt: null });
      changed(); return id;
    },
    async approveWeekly(id) { decideWeekly(id, 'approved'); },
    async rejectWeekly(id) { decideWeekly(id, 'rejected'); },

    async createTask(input, people) {
      const p = admin('Only admins can create tasks.');
      const err = validateTask(input, people); if (err) fail('invalid', err);
      const list = checkPeople(people);
      const t: Task = {
        id: newId('t'), title: input.title.trim(), description: input.description.trim(), priority: input.priority, estimateMinutes: input.estimateMinutes,
        grabsFor: input.grabsFor || 'rcm',
        createdBy: p.id, createdAt: now(), assignees: list.map((person) => ({ person, status: 'todo', doneAt: null, updatedAt: now() })),
      };
      tasks.push(t); taskEvent(p.id, t, 'created'); changed();
      return t.id;
    },
    async updateTask(id, input, people) {
      const p = admin('Only admins can change tasks.');
      const t = tasks.find((x) => x.id === id); if (!t) return fail('not_found', 'That task no longer exists.');
      const err = validateTask({ ...input, grabsFor: input.grabsFor || t.grabsFor }, people); if (err) fail('invalid', err);
      const list = checkPeople(people);
      Object.assign(t, { title: input.title.trim(), description: input.description.trim(), priority: input.priority, estimateMinutes: input.estimateMinutes, grabsFor: input.grabsFor || t.grabsFor });
      t.assignees = list.map((person) => t.assignees.find((a) => a.person === person) || { person, status: 'todo', doneAt: null, updatedAt: now() });
      taskEvent(p.id, t, 'edited'); changed();
    },
    async deleteTask(id) {
      const p = admin('Only admins can delete tasks.');
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      tasks = tasks.filter((x) => x.id !== id);
      for (const rp of reports.values()) rp.tasks = rp.tasks.filter((x) => x.taskId !== id);
      taskEvent(p.id, t, 'deleted'); changed();
    },
    async moveTask(id, person, status) {
      const p = writer(); const who = person || p.id;
      if (who !== p.id && p.role !== 'admin') fail('forbidden', 'You can only move your own tasks.');
      if (!STATUSES.includes(status)) fail('invalid', 'Unknown status.');
      const t = tasks.find((x) => x.id === id);
      const a = t?.assignees.find((x) => x.person === who);
      if (!t || !a) return fail('not_found', 'That task is not assigned to this person.');
      a.doneAt = status === 'done' ? (a.status === 'done' ? a.doneAt : now()) : null;
      a.status = status; a.updatedAt = now();
      taskEvent(p.id, t, 'moved', who, status); changed();
    },
    async claimTask(id) {
      const p = writer();
      const t = tasks.find((x) => x.id === id);
      if (!t || (p.role === 'rcm' && t.grabsFor !== 'rcm')) return fail('not_found', 'That task no longer exists.');
      if ((p.role === 'rcm') !== (t.grabsFor === 'rcm')) fail('forbidden', 'This task is up for grabs for RCMs.');
      if (t.assignees.length) fail('invalid', 'Someone already took this task.');
      t.assignees.push({ person: p.id, status: 'todo', doneAt: null, updatedAt: now() });
      taskEvent(p.id, t, 'claimed', p.id, 'todo'); changed();
    },

    async setAvailability(week, owner) {
      const p = writer(); const o = availabilityOwner(p, owner);
      const err = validateCoverage(week); if (err) fail('invalid', err);
      weeks.set(o, normalizeCoverage({ tz: 'UTC', days: week })!.days); changed();
    },
    async setAvailabilityDay(day, slots, owner) {
      const p = writer(); const o = availabilityOwner(p, owner);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('invalid', 'Pick a day.');
      const ex = { ...(exceptions.get(o) || {}) };
      if (slots === null) delete ex[day];
      else {
        const err = validateDaySlots(slots); if (err) fail('invalid', err);
        ex[day] = [...slots].sort((a, b) => a.start - b.start).map((s) => ({ start: s.start, end: s.end }));
      }
      exceptions.set(o, ex); changed();
    },

    async approveShift(id) {
      const p = admin('Only admins can approve requests.');
      const s = shifts.find((x) => x.id === id);
      if (!s) return fail('not_found', 'That request no longer exists.');
      if (s.status !== 'pending') fail('invalid', 'This shift is not waiting for approval.');
      s.status = 'booked'; write(p.id, s.owner, 'approved', s); changed();
    },
    async rejectShift(id) {
      const p = admin('Only admins can reject requests.');
      const s = shifts.find((x) => x.id === id);
      if (!s) return fail('not_found', 'That request no longer exists.');
      if (s.status !== 'pending') fail('invalid', 'This shift is not waiting for approval.');
      shifts = shifts.filter((x) => x.id !== id);
      write(p.id, s.owner, 'rejected', s); changed();
    },
    async deleteLog(id) {
      admin('Only admins can delete history entries.');
      const i = log.findIndex((l) => l.id === id);
      if (i >= 0) log.splice(i, 1);
      changed();
    },
    async markNotificationsSeen() {
      const p = admin('Only admins have notifications.');
      seen.set(p.id, now()); changed();
    },

    async createLogin(l: NewLogin) {
      admin('Only admins can manage logins.');
      const username = normalizeUsername(l.username);
      const e = validateUsername(username) || (!l.fullName.trim() ? 'Full name is required.' : null) || validatePassword(l.password);
      if (e) fail('invalid', e);
      if (byUsername(username)) fail('conflict', 'That username is already taken.');
      const id = newId('u');
      profiles.set(id, { id, username, fullName: l.fullName.trim(), role: l.role, timezone: null, active: true });
      passwords.set(id, l.password); changed();
      return { id, username };
    },
    async resetPassword(userId, password) {
      admin('Only admins can manage logins.');
      const e = validatePassword(password); if (e) fail('invalid', e);
      if (!profiles.has(userId)) fail('not_found', 'No such person.');
      passwords.set(userId, password);
    },
    async updateProfile(id, fullName, role, active) {
      const p = admin('Only admins can change profiles.');
      if (id === p.id && (role !== 'admin' || !active)) fail('invalid', 'You cannot remove your own admin access.');
      const t = profiles.get(id); if (!t) return fail('not_found', 'No such person.');
      Object.assign(t, { fullName: fullName.trim(), role, active }); changed();
    },
  };
  return repo;
}
