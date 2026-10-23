// Suggested plan for a week: who should cover the required hours that are still open,
// so that the work is shared fairly and RCMs with little availability get all of it.
//
// 1. The required hours are cut into 15-minute slots. Slots already held by a booked
//    shift or a request waiting for approval count as covered.
// 2. Fair targets (water-filling): everyone's total hours move towards the same level,
//    capped by what they can do. Someone free for only one day gets all of that day.
// 3. Slots are filled in time order, keeping the same person while they still have
//    hours to give (long blocks), unless someone else must take every slot left to
//    reach their target.
// 4. Blocks shorter than the minimum are merged into a neighbour who is also free.
import type { Interval } from './coverage';
import type { Shift } from './shifts';

const STEP = 15 * 60_000;

export type PlanInput = {
  /** required coverage of the week, as instants */
  required: Interval[];
  /** every shift of the week (any status) */
  shifts: Shift[];
  /** RCMs who can be suggested, with their availability in the week */
  people: Array<{ id: string; intervals: Interval[] }>;
  /** shortest block to suggest, in minutes (default 30) */
  minMinutes?: number;
};

export type Suggestion = { owner: string; start: number; end: number };
export type PersonPlan = {
  id: string;
  /** availability that falls on required hours still open */
  offeredMinutes: number;
  /** minutes already booked this week (shifts and requests) */
  bookedMinutes: number;
  /** extra minutes the plan gives them */
  targetMinutes: number;
};
export type Plan = {
  requiredMinutes: number;
  coveredMinutes: number;
  /** required minutes that nobody is available for */
  noOneMinutes: number;
  perPerson: PersonPlan[];
  suggestions: Suggestion[];
};

/** Water-filling: how many more minutes each person should get so totals even out. */
export function fairTargets(need: number, people: Array<{ id: string; already: number; capacity: number }>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(people.map((p) => [p.id, 0]));
  const totalCap = people.reduce((m, p) => m + p.capacity, 0);
  if (need <= 0 || !people.length) return out;
  if (totalCap <= need) { for (const p of people) out[p.id] = p.capacity; return out; }
  const give = (level: number) => people.reduce((m, p) => m + Math.min(p.capacity, Math.max(0, level - p.already)), 0);
  let lo = 0, hi = Math.max(...people.map((p) => p.already + p.capacity));
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (give(mid) < need) lo = mid; else hi = mid; }
  // round down to whole slots, then hand out what is left one slot at a time
  let left = need;
  for (const p of people) {
    const v = Math.floor(Math.min(p.capacity, Math.max(0, hi - p.already)) / 15) * 15;
    out[p.id] = v; left -= v;
  }
  const order = [...people].sort((a, b) => (a.already + out[a.id]) - (b.already + out[b.id]) || a.id.localeCompare(b.id));
  while (left > 0) {
    const p = order.find((x) => out[x.id] + 15 <= x.capacity);
    if (!p) break;
    out[p.id] += 15; left -= 15;
    order.sort((a, b) => (a.already + out[a.id]) - (b.already + out[b.id]) || a.id.localeCompare(b.id));
  }
  return out;
}

const covers = (list: Interval[], a: number, b: number) => list.some((x) => x.start <= a && x.end >= b);
const overlaps = (list: Interval[], a: number, b: number) => list.some((x) => x.start < b && a < x.end);

export function suggestPlan(input: PlanInput): Plan {
  const minSlots = Math.max(1, Math.round((input.minMinutes ?? 30) / 15));
  const taken = input.shifts.filter((s) => s.status === 'booked' || s.status === 'pending');
  const openShifts = input.shifts.filter((s) => s.status === 'open');
  const ids = input.people.map((p) => p.id);
  const avail = new Map(input.people.map((p) => [p.id, p.intervals]));
  const busy = new Map(ids.map((id) => [id, taken.filter((s) => s.owner === id)]));

  // 1. slots
  type Slot = { t: number; candidates: string[] };
  const slots: Slot[] = [];
  let requiredMinutes = 0, coveredMinutes = 0, noOneMinutes = 0;
  for (const r of input.required) {
    for (let t = r.start; t + STEP <= r.end; t += STEP) {
      requiredMinutes += 15;
      if (covers(taken, t, t + STEP)) { coveredMinutes += 15; continue; }
      const openOwner = openShifts.find((s) => s.start <= t && s.end >= t + STEP)?.owner;
      const candidates = ids.filter((id) => id !== openOwner && covers(avail.get(id)!, t, t + STEP) && !overlaps(busy.get(id)!, t, t + STEP));
      if (!candidates.length) { noOneMinutes += 15; continue; }
      slots.push({ t, candidates });
    }
  }

  // 2. fair targets
  const already = (id: string) => busy.get(id)!.reduce((m, s) => m + (s.end - s.start) / 60_000, 0);
  const capacity = (id: string) => slots.filter((s) => s.candidates.includes(id)).length * 15;
  const people = ids.map((id) => ({ id, already: already(id), capacity: capacity(id) }));
  const targets = fairTargets(slots.length * 15, people);

  // 3. fill in time order
  const remaining = new Map(ids.map((id) => [id, targets[id] / 15]));
  const future = new Map(ids.map((id) => [id, capacity(id) / 15]));
  const owners: string[] = [];
  let prev: string | null = null;
  for (const s of slots) {
    const ratio = (id: string) => (future.get(id)! > 0 ? remaining.get(id)! / future.get(id)! : 0);
    const must = s.candidates.filter((id) => remaining.get(id)! > 0 && ratio(id) >= 1);
    let pick: string;
    if (must.length) pick = must.includes(prev ?? '') ? prev! : must[0];
    else if (prev && s.candidates.includes(prev) && remaining.get(prev)! > 0) pick = prev;
    else pick = [...s.candidates].sort((a, b) => ratio(b) - ratio(a) || remaining.get(b)! - remaining.get(a)! || a.localeCompare(b))[0];
    owners.push(pick);
    remaining.set(pick, remaining.get(pick)! - 1);
    for (const id of s.candidates) future.set(id, future.get(id)! - 1);
    prev = pick;
  }

  // 4. merge short blocks into a free neighbour (same contiguous run of slots)
  const runs: Array<{ owner: string; from: number; to: number }> = [];
  owners.forEach((o, i) => {
    const last = runs[runs.length - 1];
    if (last && last.owner === o && slots[i - 1] && slots[i - 1].t + STEP === slots[i].t) last.to = i + 1;
    else runs.push({ owner: o, from: i, to: i + 1 });
  });
  const canTake = (owner: string, run: { from: number; to: number }) => {
    for (let i = run.from; i < run.to; i++) if (!slots[i].candidates.includes(owner)) return false;
    return true;
  };
  const adjacent = (a: { to: number }, b: { from: number }) => b.from === a.to && slots[a.to - 1].t + STEP === slots[b.from].t;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.to - r.from >= minSlots) continue;
    const before = runs[i - 1], after = runs[i + 1];
    if (before && adjacent(before, r) && canTake(before.owner, r)) { before.to = r.to; runs.splice(i, 1); i -= 2; continue; }
    if (after && adjacent(r, after) && canTake(after.owner, r)) { after.from = r.from; runs.splice(i, 1); i -= 1; }
  }
  // neighbours that now belong to the same person become one block
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.owner === r.owner && adjacent(last, r)) last.to = r.to;
    else merged.push({ ...r });
  }

  const suggestions = merged.map((r) => ({ owner: r.owner, start: slots[r.from].t, end: slots[r.to - 1].t + STEP }));
  const given = (id: string) => suggestions.filter((s) => s.owner === id).reduce((m, s) => m + (s.end - s.start) / 60_000, 0);
  return {
    requiredMinutes, coveredMinutes, noOneMinutes,
    perPerson: people.map((p) => ({ id: p.id, offeredMinutes: p.capacity, bookedMinutes: p.already, targetMinutes: given(p.id) })),
    suggestions,
  };
}
