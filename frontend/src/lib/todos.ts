// To-do templates: checklists the admins write for shifts. A template is either general
// (every shift) or specific: repeating every x hours/days/weeks/months, or one time slot.
// When a specific template applies to a shift it adds to the general one or replaces it.
import type { Shift } from './shifts';

export type RepeatUnit = 'shift' | 'hours' | 'days' | 'weeks' | 'months';
export type Repeat = { unit: RepeatUnit; every: number; from: number };
export type TodoTemplate = {
  id: string;
  title: string;
  items: string[];
  /** for every SCM, or only for `people` */
  everyone: boolean;
  people: string[];
  /** scheduler on: repeats; off (null): only for `slot` */
  repeat: Repeat | null;
  slot: { start: number; end: number } | null;
  /** for specific templates: add to the general checklist or replace it */
  mode: 'add' | 'replace';
};

const H = 3_600_000;
const PERIOD: Record<'hours' | 'days' | 'weeks', number> = { hours: H, days: 24 * H, weeks: 7 * 24 * H };
export const isGeneral = (t: TodoTemplate) => t.repeat?.unit === 'shift';

/** Does the template have an occurrence inside [from, to)? */
export function occursIn(t: TodoTemplate, from: number, to: number): boolean {
  if (!t.repeat) return !!t.slot && t.slot.start < to && from < t.slot.end;
  const r = t.repeat;
  if (r.unit === 'shift') return true;
  if (r.unit === 'months') {
    const a = new Date(r.from);
    const months = (new Date(from).getUTCFullYear() - a.getUTCFullYear()) * 12 + new Date(from).getUTCMonth() - a.getUTCMonth();
    for (let k = Math.max(0, Math.floor((months - 1) / r.every)) * r.every; k <= months + r.every; k += r.every) {
      const occ = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k, a.getUTCDate(), a.getUTCHours(), a.getUTCMinutes());
      if (occ >= from && occ < to) return true;
    }
    return false;
  }
  const p = PERIOD[r.unit] * r.every;
  const k = Math.max(0, Math.ceil((from - r.from) / p));
  return r.from + k * p < to;
}

const appliesTo = (t: TodoTemplate, person: string) => t.everyone || t.people.includes(person);

/** The templates an SCM works through in a shift. */
export function resolveTodos(templates: TodoTemplate[], shift: Shift): TodoTemplate[] {
  const mine = templates.filter((t) => appliesTo(t, shift.owner) && occursIn(t, shift.start, shift.end));
  const general = mine.filter(isGeneral);
  const specific = mine.filter((t) => !isGeneral(t)).sort((a, b) => a.title.localeCompare(b.title));
  return specific.some((t) => t.mode === 'replace') ? specific : [...general, ...specific];
}

export function validateTemplate(t: TodoTemplate): string | null {
  if (!t.title.trim()) return 'Give the template a title.';
  if (!t.items.some((i) => i.trim())) return 'Write at least one line of the checklist.';
  if (t.items.length > 100 || t.items.some((i) => i.length > 300)) return 'The checklist is too long.';
  if (!t.everyone && !t.people.length) return 'Choose who gets this checklist.';
  if (t.repeat) {
    if (!(Number.isInteger(t.repeat.every) && t.repeat.every >= 1 && t.repeat.every <= 365)) return 'Repeat every 1 to 365.';
  } else if (!t.slot || !(t.slot.end > t.slot.start)) return 'Pick the time slot (the end must be after the start).';
  return null;
}

const sharePeople = (a: TodoTemplate, b: TodoTemplate) => a.everyone || b.everyone || a.people.some((p) => b.people.includes(p));
const sameRepeat = (a: Repeat, b: Repeat) => a.unit === b.unit && a.every === b.every && a.from === b.from;

/** Two templates of the same kind cannot cover the same shift of the same person. */
export function templateConflict(t: TodoTemplate, others: TodoTemplate[]): string | null {
  for (const o of others) {
    if (o.id === t.id || !sharePeople(t, o)) continue;
    if (isGeneral(t) && isGeneral(o)) return `“${o.title}” is already the checklist for every shift for some of these people.`;
    if (!t.repeat && !o.repeat && t.slot && o.slot && t.slot.start < o.slot.end && o.slot.start < t.slot.end) return `“${o.title}” already covers the same time for some of these people.`;
    if (t.repeat && o.repeat && !isGeneral(t) && !isGeneral(o) && sameRepeat(t.repeat, o.repeat)) return `“${o.title}” already repeats on the same schedule for some of these people.`;
  }
  return null;
}

export const repeatLabel = (t: TodoTemplate): string => {
  if (!t.repeat) return 'One time slot';
  const r = t.repeat;
  if (r.unit === 'shift') return 'Every shift';
  return `Every ${r.every === 1 ? '' : r.every + ' '}${r.every === 1 ? r.unit.replace(/s$/, '') : r.unit}`;
};
