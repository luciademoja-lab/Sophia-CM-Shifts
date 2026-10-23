import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDb, failure } from './db';

describe('required coverage', () => {
  let db: TestDb;
  let lucia: string, regina: string;
  const set = (as: string, tz: string, days: unknown) =>
    db.exec({ id: as }, `select set_coverage('${tz}', '${JSON.stringify(days)}'::jsonb)`);
  const get = () => db.rows('super', 'select tz, days from coverage')[0];

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('lucia', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
  });
  afterAll(() => db.drop());

  it('starts empty', () => {
    expect(db.value({ id: regina }, 'select count(*) from coverage')).toBe(0);
  });

  it('lets an admin save several slots per day, with gaps, sorted', () => {
    set(lucia, 'Europe/Rome', { 1: [{ start: 840, end: 1440 }, { start: 420, end: 720 }], 6: [{ start: 600, end: 1080 }] });
    expect(get()).toEqual({ tz: 'Europe/Rome', days: { 1: [{ start: 420, end: 720 }, { start: 840, end: 1440 }], 6: [{ start: 600, end: 1080 }] } });
  });

  it('replaces the whole target on each save and drops empty days', () => {
    set(lucia, 'UTC', { 2: [{ start: 0, end: 60 }], 3: [] });
    expect(get()).toEqual({ tz: 'UTC', days: { 2: [{ start: 0, end: 60 }] } });
    expect(db.value('super', 'select count(*) from coverage')).toBe(1);
  });

  it('is readable by every signed-in user', () => {
    expect(db.value({ id: regina }, 'select tz from coverage')).toBe('UTC');
  });

  it('refuses RCMs', () => {
    expect(failure(() => set(regina, 'UTC', {}))).toMatch(/RCM_FORBIDDEN/);
  });

  it.each([
    ['overlapping slots', { 1: [{ start: 420, end: 720 }, { start: 600, end: 900 }] }],
    ['end before start', { 1: [{ start: 720, end: 600 }] }],
    ['off the quarter hour', { 1: [{ start: 425, end: 600 }] }],
    ['outside the day', { 1: [{ start: 0, end: 1455 }] }],
    ['unknown weekday', { 8: [{ start: 0, end: 60 }] }],
    ['not a list', { 1: { start: 0, end: 60 } }],
  ])('rejects %s', (_label, days) => {
    expect(failure(() => set(lucia, 'UTC', days))).toMatch(/RCM_INVALID/);
  });

  it('rejects unknown time zones', () => {
    expect(failure(() => set(lucia, 'Mars/Olympus', {}))).toMatch(/RCM_INVALID/);
  });
});
