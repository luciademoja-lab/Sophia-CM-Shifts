import { describe, it, expect } from 'vitest';
import { occursIn, resolveTodos, templateConflict, validateTemplate, type TodoTemplate } from './todos';
import type { Shift } from './shifts';

const H = 3_600_000, D = 24 * H;
const t0 = Date.parse('2026-10-26T00:00:00Z'); // Monday
const shift = (startH: number, hours: number, owner = 'regina'): Shift => ({ id: `s${startH}`, owner, start: t0 + startH * H, end: t0 + (startH + hours) * H, status: 'booked', coversId: null });
const tpl = (id: string, extra: Partial<TodoTemplate> = {}): TodoTemplate => ({
  id, title: id, items: ['Check Zone A'], everyone: true, people: [], repeat: { unit: 'shift', every: 1, from: t0 }, slot: null, mode: 'add', ...extra,
});

describe('occursIn (the template scheduler)', () => {
  it('every shift', () => {
    expect(occursIn(tpl('a'), t0 + 5 * H, t0 + 6 * H)).toBe(true);
  });
  it('every x hours, days and weeks from the start', () => {
    const every6h = tpl('h', { repeat: { unit: 'hours', every: 6, from: t0 + 9 * H } }); // 09, 15, 21, 03…
    expect(occursIn(every6h, t0 + 14 * H, t0 + 16 * H)).toBe(true);
    expect(occursIn(every6h, t0 + 10 * H, t0 + 14 * H)).toBe(false);
    expect(occursIn(every6h, t0, t0 + 8 * H)).toBe(false); // before the first time
    const every2d = tpl('d', { repeat: { unit: 'days', every: 2, from: t0 + 9 * H } });
    expect(occursIn(every2d, t0 + 2 * D + 8 * H, t0 + 2 * D + 12 * H)).toBe(true);
    expect(occursIn(every2d, t0 + 1 * D + 8 * H, t0 + 1 * D + 12 * H)).toBe(false);
    const weekly = tpl('w', { repeat: { unit: 'weeks', every: 1, from: t0 + 9 * H } });
    expect(occursIn(weekly, t0 + 14 * D + 7 * H, t0 + 14 * D + 13 * H)).toBe(true);
  });
  it('every x months on the same day and time', () => {
    const monthly = tpl('m', { repeat: { unit: 'months', every: 1, from: Date.parse('2026-10-26T09:00:00Z') } });
    expect(occursIn(monthly, Date.parse('2026-12-26T08:00:00Z'), Date.parse('2026-12-26T10:00:00Z'))).toBe(true);
    expect(occursIn(monthly, Date.parse('2026-12-27T08:00:00Z'), Date.parse('2026-12-27T10:00:00Z'))).toBe(false);
  });
  it('a single time slot when the scheduler is off', () => {
    const once = tpl('o', { repeat: null, slot: { start: t0 + 9 * H, end: t0 + 11 * H } });
    expect(occursIn(once, t0 + 10 * H, t0 + 14 * H)).toBe(true);
    expect(occursIn(once, t0 + 11 * H, t0 + 14 * H)).toBe(false);
  });
});

describe('resolveTodos (what the SCM sees when starting a shift)', () => {
  const general = tpl('general', { items: ['Daily accounts check'] });
  const onlyKris = tpl('kris', { everyone: false, people: ['kris'], items: ['Kris only'] });
  it('gives each person the templates assigned to them', () => {
    expect(resolveTodos([general, onlyKris], shift(8, 6)).map((t) => t.id)).toEqual(['general']);
    expect(resolveTodos([general, onlyKris], shift(8, 6, 'kris')).map((t) => t.id)).toEqual(['general', 'kris']);
  });
  it('lets a specific template add to the general one, or replace it', () => {
    const adds = tpl('monday', { repeat: null, slot: { start: t0 + 9 * H, end: t0 + 10 * H }, mode: 'add' });
    const replaces = { ...adds, id: 'replace', mode: 'replace' as const };
    expect(resolveTodos([general, adds], shift(8, 6)).map((t) => t.id)).toEqual(['general', 'monday']);
    expect(resolveTodos([general, replaces], shift(8, 6)).map((t) => t.id)).toEqual(['replace']);
    expect(resolveTodos([general, replaces], shift(30, 6)).map((t) => t.id)).toEqual(['general']); // Tuesday: not in the slot
  });
});

describe('validateTemplate and conflicts', () => {
  it('needs a title, at least one line, someone to give it to, and a schedule', () => {
    expect(validateTemplate(tpl('x', { title: ' ' }))).toMatch(/title/);
    expect(validateTemplate(tpl('x', { items: [' '] }))).toMatch(/line/);
    expect(validateTemplate(tpl('x', { everyone: false, people: [] }))).toMatch(/who/);
    expect(validateTemplate(tpl('x', { repeat: { unit: 'hours', every: 0, from: t0 } }))).toMatch(/every/);
    expect(validateTemplate(tpl('x', { repeat: null, slot: null }))).toMatch(/time slot/);
    expect(validateTemplate(tpl('x', { repeat: null, slot: { start: t0 + H, end: t0 } }))).toMatch(/time slot/);
    expect(validateTemplate(tpl('x'))).toBeNull();
  });
  it('stops two templates that would cover the same shift of the same person in the same way', () => {
    const general = tpl('general');
    expect(templateConflict(tpl('again'), [general])).toMatch(/every shift/);
    expect(templateConflict(tpl('kris', { everyone: false, people: ['kris'] }), [general])).toMatch(/every shift/);
    expect(templateConflict(tpl('kris', { everyone: false, people: ['kris'] }), [tpl('r', { everyone: false, people: ['regina'] })])).toBeNull();
    const slot = (id: string, a: number, b: number) => tpl(id, { repeat: null, slot: { start: t0 + a * H, end: t0 + b * H } });
    expect(templateConflict(slot('a', 9, 12), [slot('b', 11, 13)])).toMatch(/same time/);
    expect(templateConflict(slot('a', 9, 12), [slot('b', 12, 13)])).toBeNull();
    expect(templateConflict(slot('a', 9, 12), [general])).toBeNull(); // a specific one may add to or replace the general one
    expect(templateConflict(general, [{ ...general }])).toBeNull(); // editing itself
  });
});
