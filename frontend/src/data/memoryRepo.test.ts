import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryRepo } from './memoryRepo';
import type { Repo } from './repo';

const H = 3_600_000;
const t0 = Date.parse('2026-10-26T00:00:00Z');
const users = [
  { username: 'lucia', fullName: 'Lucia De Mojà', role: 'admin' as const, password: 'demo2026pass', timezone: 'Europe/Rome' },
  { username: 'regina', fullName: 'Regina Nemeth', role: 'rcm' as const, password: 'demo2026pass', timezone: null },
  { username: 'kris', fullName: 'Kris Arévalo', role: 'rcm' as const, password: 'demo2026pass', timezone: 'America/Bogota' },
  { username: 'max', fullName: 'Max', role: 'viewer' as const, password: 'demo2026pass', timezone: 'Europe/Paris' },
];

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as { code: string }).code; }
  return 'no error';
}

describe('memoryRepo (demo mode, same rules as the database)', () => {
  let repo: Repo;
  const ids: Record<string, string> = {};
  const as = async (u: string) => { await repo.signOut(); await repo.signIn(u, 'demo2026pass'); };
  const snap = () => repo.load(t0 - 24 * H, t0 + 8 * 24 * H);

  beforeEach(async () => {
    repo = createMemoryRepo({ users });
    await as('lucia');
    for (const p of Object.values((await snap()).profiles)) ids[p.username] = p.id;
  });

  it('signs in with username and password only', async () => {
    await repo.signOut();
    expect(await repo.session()).toBeNull();
    expect(await code(repo.signIn('regina', 'wrong-password1'))).toBe('bad_login');
    await repo.signIn('  Regina ', 'demo2026pass');
    expect(await repo.session()).toBe(ids.regina);
    expect((await snap()).me?.username).toBe('regina');
  });

  it('saves the time zone chosen at first login', async () => {
    await as('regina');
    expect((await snap()).me?.timezone).toBeNull();
    await repo.setMyTimezone('Europe/Budapest');
    expect((await snap()).me?.timezone).toBe('Europe/Budapest');
    expect(await code(repo.setMyTimezone('Mars/Olympus'))).toBe('invalid');
  });

  it('books, enforces one RCM per slot, and logs', async () => {
    await as('regina');
    await repo.bookShift(t0 + 8 * H, t0 + 10 * H);
    await as('kris');
    expect(await code(repo.bookShift(t0 + 9 * H, t0 + 11 * H))).toBe('overlap');
    await repo.bookShift(t0 + 10 * H, t0 + 12 * H);
    const s = await snap();
    expect(s.shifts.map((x) => x.owner)).toEqual([ids.regina, ids.kris]);
    expect(s.log.map((l) => l.action)).toEqual(['booked', 'booked']);
  });

  it('only owners and admins change a shift; only admins book for others', async () => {
    await as('regina');
    const id = await repo.bookShift(t0 + 8 * H, t0 + 10 * H);
    await as('kris');
    expect(await code(repo.deleteShift(id))).toBe('forbidden');
    expect(await code(repo.bookShift(t0 + 1 * H, t0 + 2 * H, ids.regina))).toBe('forbidden');
    await as('lucia');
    await repo.updateShift(id, t0 + 8 * H, t0 + 9 * H, ids.kris);
    expect((await snap()).shifts[0]).toMatchObject({ owner: ids.kris, end: t0 + 9 * H });
  });

  it('runs the cover flow: ask, take, give back', async () => {
    await as('regina');
    const id = await repo.bookShift(t0 + 8 * H, t0 + 10 * H);
    await repo.askCover(id);
    await as('kris');
    const cover = await repo.takeShift(id);
    let s = await snap();
    expect(s.shifts.find((x) => x.id === id)?.status).toBe('covered');
    expect(s.shifts.find((x) => x.id === cover)).toMatchObject({ owner: ids.kris, coversId: id, status: 'booked' });
    await repo.deleteShift(cover);
    s = await snap();
    expect(s.shifts.find((x) => x.id === id)?.status).toBe('open');
    expect(s.log.map((l) => l.action)).toEqual(['booked', 'ask', 'took', 'gaveback']);
  });

  it('only admins set coverage, and slots are validated', async () => {
    await repo.setCoverage('Europe/Rome', { 1: [{ start: 840, end: 1440 }, { start: 420, end: 720 }] });
    expect((await snap()).coverage).toEqual({ tz: 'Europe/Rome', days: { 1: [{ start: 420, end: 720 }, { start: 840, end: 1440 }] } });
    expect(await code(repo.setCoverage('UTC', { 1: [{ start: 420, end: 800 }] }))).toBe('invalid');
    await as('regina');
    expect(await code(repo.setCoverage('UTC', {}))).toBe('forbidden');
  });

  it('lets admins create logins that can sign in, and reset passwords', async () => {
    const { id, username } = await repo.createLogin({ username: 'Rana', fullName: 'Rana Barakli', password: 'rana2026pass', role: 'rcm' });
    expect(username).toBe('rana');
    expect(await code(repo.createLogin({ username: 'rana', fullName: 'X', password: 'rana2026pass', role: 'rcm' }))).toBe('conflict');
    expect(await code(repo.createLogin({ username: 'ra', fullName: 'X', password: 'rana2026pass', role: 'rcm' }))).toBe('invalid');
    await repo.resetPassword(id, 'newpass2026x');
    await repo.signOut();
    await repo.signIn('rana', 'newpass2026x');
    expect((await snap()).me?.fullName).toBe('Rana Barakli');
    expect(await code(repo.createLogin({ username: 'zed', fullName: 'Z', password: 'zed2026passw', role: 'rcm' }))).toBe('forbidden');
  });

  it('blocks deactivated logins', async () => {
    await repo.updateProfile(ids.kris, 'Kris Arévalo', 'rcm', false);
    await repo.signOut();
    expect(await code(repo.signIn('kris', 'demo2026pass'))).toBe('bad_login');
  });

  it('gives viewers read-only access', async () => {
    await as('regina');
    const id = await repo.bookShift(t0 + 8 * H, t0 + 10 * H);
    await as('max');
    expect((await snap()).shifts).toHaveLength(1);
    await repo.setMyTimezone('Europe/Berlin');
    expect(await code(repo.bookShift(t0 + 12 * H, t0 + 13 * H))).toBe('forbidden');
    expect(await code(repo.deleteShift(id))).toBe('forbidden');
    expect(await code(repo.setCoverage('UTC', {}))).toBe('forbidden');
    expect(await code(repo.createLogin({ username: 'zed', fullName: 'Z', password: 'zed2026passw', role: 'rcm' }))).toBe('forbidden');
    await as('lucia');
    expect(await code(repo.bookShift(t0 + 12 * H, t0 + 13 * H, ids.max))).toBe('invalid');
  });

  it('lets the owner and admins report hours worked, once the shift has started', async () => {
    const now = Date.now(), past = now - 5 * H;
    await as('regina');
    const id = await repo.bookShift(past, past + 3 * H);
    const later = await repo.bookShift(now + 24 * H, now + 26 * H);
    await repo.saveReport(id, 150, 'Answered #zone-a');
    expect(await code(repo.saveReport(later, 60, 'too early'))).toBe('invalid');
    expect(await code(repo.saveReport(id, 1500, 'x'))).toBe('invalid');
    let s = await repo.load(past - H, now + 48 * H);
    expect(s.reports[id]).toMatchObject({ owner: ids.regina, workedMinutes: 150, notes: 'Answered #zone-a', updatedBy: ids.regina });
    expect(s.log.pop()).toMatchObject({ action: 'reported', shiftId: id });
    await as('kris');
    expect(await code(repo.saveReport(id, 10, 'not mine'))).toBe('forbidden');
    await as('max');
    expect(await code(repo.saveReport(id, 10, 'read only'))).toBe('forbidden');
    await as('lucia');
    await repo.saveReport(id, 120, 'Corrected');
    s = await repo.load(past - H, now + 48 * H);
    expect(s.reports[id]).toMatchObject({ workedMinutes: 120, updatedBy: ids.lucia });
    await repo.deleteReport(id);
    expect((await repo.load(past - H, now + 48 * H)).reports[id]).toBeUndefined();
  });

  it('notifies subscribers on every change', async () => {
    let n = 0;
    const off = repo.subscribe(() => n++);
    await repo.bookShift(t0, t0 + H);
    off();
    await repo.bookShift(t0 + H, t0 + 2 * H);
    expect(n).toBe(1);
  });
});
