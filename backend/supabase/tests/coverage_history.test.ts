import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDb } from './db';

describe('coverage history', () => {
  let db: TestDb;
  let lucia: string, regina: string, max: string;
  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    max = db.createUser('max', 'Max', 'viewer');
  });
  afterAll(() => db.drop());

  it('keeps every version of the required coverage, for admins and viewers', () => {
    db.exec({ id: lucia }, `select set_coverage('Europe/Rome', '{"1":[{"start":420,"end":780}]}'::jsonb)`);
    db.exec({ id: lucia }, `select set_coverage('Europe/Rome', '{"1":[{"start":480,"end":720}]}'::jsonb)`);
    expect(db.rows('super', 'select tz, days from coverage_versions order by id')).toEqual([
      { tz: 'Europe/Rome', days: { 1: [{ start: 420, end: 780 }] } },
      { tz: 'Europe/Rome', days: { 1: [{ start: 480, end: 720 }] } },
    ]);
    expect(db.value({ id: max }, 'select count(*) from coverage_versions')).toBe(2);
    expect(db.value({ id: regina }, 'select count(*) from coverage_versions')).toBe(0);
  });
});
