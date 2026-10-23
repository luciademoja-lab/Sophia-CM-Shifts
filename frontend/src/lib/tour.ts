// The guided tour: one bubble per feature, pointing at the part of the page it explains.
// Steps differ by role; `page` switches the tab before the step is shown.
import type { Role } from './shifts';

export type TourPage = 'schedule' | 'tasks' | 'dashboard' | 'role';
export type TourStep = { id: string; target: string | null; page: TourPage; title: string; body: string };

const welcome = (body: string): TourStep => ({ id: 'welcome', target: null, page: 'schedule', title: 'Welcome to RCM Shifts', body });
const end: TourStep = { id: 'end', target: 'tutorial', page: 'schedule', title: 'That’s the tour', body: 'Click “Tutorial” any time to see it again.' };
const week: TourStep = { id: 'week', target: 'week', page: 'schedule', title: 'Pick the week', body: 'Move between weeks with the arrows; “This week” brings you back to today.' };
const tz: TourStep = { id: 'tz', target: 'tz', page: 'schedule', title: 'Your time zone', body: 'Everything is shown in your time zone. Each shift also shows the RCM’s own zone. Use “Change” if you move.' };

const RCM: TourStep[] = [
  welcome('A quick tour of a normal week: say when you can work, book shifts, report your hours on Sunday, and work through your tasks.'),
  tz,
  { id: 'availability', target: 'availability', page: 'schedule', title: '1. Say when you can work', body: 'Set your usual week and any day off or extra hours here. Your availability shows as a green band on the calendar.' },
  { id: 'grid', target: 'grid', page: 'schedule', title: '2. Book your shifts', body: 'Drag on the calendar (or tap) to book. Red stripes are hours that still need someone. Booking outside the required hours or your availability sends a request: an admin approves it before you can work it.' },
  { id: 'legend', target: 'legend', page: 'schedule', title: 'Reading the calendar', body: 'Solid blocks are shifts, dashed ones are requests or shifts that need cover. Click a shift to change it or ask for cover (only before it starts).' },
  { id: 'hours', target: 'hours', page: 'schedule', title: '3. Report each shift', body: 'Once a shift has started, add a report: the hours you actually worked, what you did (onboarding, accounts check, posters’ issues, community) and any tasks you worked on.' },
  { id: 'weekly', target: 'weekly', page: 'schedule', title: '4. Send your week on Sunday', body: 'From Sunday, open the weekly report: it is already written from your reports. Check it and send it. When an admin approves it, add those hours to your Upwork contract.' },
  { id: 'tabs', target: 'tabs', page: 'schedule', title: 'Your pages', body: 'Schedule is the calendar. My tasks has your to-do list. My role sums up the job.' },
  { id: 'kanban', target: 'kanban', page: 'tasks', title: '5. Work through your tasks', body: 'Take tasks from “Up for grabs”, then drag your cards to In progress and Done (or use the menu on the card). The morning Upwork contracts arrive here as a list: tick each poster when they have an OS profile and a Slack invite.' },
  { id: 'role', target: 'rolepage', page: 'role', title: 'Your role', body: 'What RCMs do, and what they don’t, as in the Vik 2.0 guide.' },
  end,
];

const ADMIN: TourStep[] = [
  welcome('A quick tour of the admin side: coverage, assigning shifts, approvals, tasks and the dashboard.'),
  week,
  { id: 'view', target: 'view', page: 'schedule', title: 'Everyone’s availability', body: 'The admin view shows a thin coloured lane per RCM. Pick one RCM to see only their availability.' },
  { id: 'grid', target: 'grid', page: 'schedule', title: 'Assign shifts', body: 'Click or drag on the calendar to create a shift and choose the RCM: 🟢 means available, 🔴 not available (you can still assign). Red stripes are required hours nobody covers yet; dashed blocks are suggestions from the plan.' },
  { id: 'plan', target: 'plan', page: 'schedule', title: 'Suggested plan', body: 'How many hours the week needs, what each RCM offered, and a fair split of the open hours. Assign one suggestion or all of them.' },
  { id: 'hours', target: 'hours', page: 'schedule', title: 'Hours this week', body: 'Offered availability, booked shifts and the hours RCMs reported for each person.' },
  { id: 'coverage', target: 'coverage', page: 'schedule', title: 'Required coverage', body: 'The hours that must always have someone on duty, in the time zone shown here. Edit them to change the red stripes and the plan.' },
  { id: 'history', target: 'history', page: 'schedule', title: 'History', body: 'Every change to shifts. Filter by person, or delete an entry.' },
  { id: 'notifications', target: 'notifications', page: 'schedule', title: 'Notifications', body: 'Shift requests and weekly reports to approve, plus what RCMs changed. The red dot shows what is new.' },
  { id: 'team', target: 'team', page: 'schedule', title: 'Logins', body: 'Create usernames and passwords for RCMs and read-only people, or reset a password.' },
  { id: 'newtask', target: 'newtask', page: 'tasks', title: 'Create tasks', body: 'A regular task (with priority, estimate and the people who do it), or the Hiring & onboarding list: paste the morning Upwork contracts and they are split evenly between the RCMs.' },
  { id: 'kanban', target: 'kanban', page: 'tasks', title: 'The task board', body: 'Up for grabs, To do, In progress, Done. Everyone has their own card. Filter by person with “Show”.' },
  { id: 'dashboard', target: 'dashboard', page: 'dashboard', title: 'Dashboard', body: 'Estimated vs logged time on RCM tasks, tasks completed this week (whole team, RCMs, admins) and the weekly reports.' },
  end,
];

const VIEWER: TourStep[] = [
  welcome('You have read-only access: you can follow the schedule, the hours and the history.'),
  week,
  { id: 'view', target: 'view', page: 'schedule', title: 'Choose the view', body: 'See everyone’s availability at once, or pick one RCM.' },
  { id: 'grid', target: 'grid', page: 'schedule', title: 'The schedule', body: 'Shifts, with each RCM’s time zone. Red stripes are required hours nobody covers yet.' },
  { id: 'hours', target: 'hours', page: 'schedule', title: 'Hours', body: 'Availability offered, shifts booked and hours reported this week.' },
  { id: 'history', target: 'history', page: 'schedule', title: 'History', body: 'Every change to shifts, with the shift reports. Filter it by person.' },
  end,
];

export function tourFor(role: Role): TourStep[] {
  return role === 'admin' ? ADMIN : role === 'rcm' ? RCM : VIEWER;
}
