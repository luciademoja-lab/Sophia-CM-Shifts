import { describe, it, expect } from 'vitest';
import { tourFor } from './tour';

describe('tourFor', () => {
  it('starts with a welcome and ends on the Tutorial button, for every role', () => {
    for (const role of ['admin', 'rcm', 'viewer'] as const) {
      const steps = tourFor(role);
      expect(steps[0].id).toBe('welcome');
      expect(steps[steps.length - 1].target).toBe('tutorial');
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    }
  });
  it('follows a typical week for RCMs: availability, booking, reports, weekly report, tasks', () => {
    const ids = tourFor('rcm').map((s) => s.id);
    expect(ids.indexOf('availability')).toBeLessThan(ids.indexOf('grid'));
    expect(ids.indexOf('hours')).toBeLessThan(ids.indexOf('weekly'));
    expect(ids).toContain('kanban');
    expect(ids).not.toContain('plan');
  });
  it('shows admins the planning and approval tools, and viewers nothing they cannot use', () => {
    const admin = tourFor('admin').map((s) => s.id);
    for (const id of ['plan', 'coverage', 'notifications', 'team', 'newtask', 'dashboard']) expect(admin).toContain(id);
    const viewer = tourFor('viewer');
    expect(viewer.some((s) => s.page !== 'schedule')).toBe(false);
    expect(viewer.map((s) => s.id)).not.toContain('weekly');
  });
});
