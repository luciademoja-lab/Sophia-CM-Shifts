// End-to-end tests: the built app (dist/) in demo mode, in a headless browser.
// Run with `npm run test:e2e` (builds first). Needs `npx playwright install chromium` once.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(process.env.PROJECT_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'), 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const PASSWORD = 'demo2026pass';

let server: Server, base = '', browser: Browser, page: Page;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(await readFile(join(DIST, 'index.html')));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});

beforeEach(async () => {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Rome', viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
});

async function signIn(username: string, password = PASSWORD) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const text = (sel: string) => page.locator(sel).allInnerTexts();

const R = 22; // px per 15-minute row
/** Scrolls the calendar so `hour` is in view and returns the point of day column `day` at hour:minutes. */
async function slot(day: number, hour: number, minutes = 0) {
  await page.locator('.boardwrap').evaluate((el, top) => { el.scrollIntoView({ block: 'start' }); el.scrollTop = top; }, Math.max(0, (hour - 1) * R * 4));
  const box = (await page.locator('.col').nth(day).boundingBox())!;
  return { x: box.x + 20, y: box.y + R * 4 * hour + R * (minutes / 15) + 2 };
}

describe('logins made by us', () => {
  it('signs in with a username and password', async () => {
    await signIn('lucia');
    await page.getByText('Signed in as Lucia De Mojà').waitFor();
    expect(await page.getByRole('heading', { name: 'RCM Shifts' }).isVisible()).toBe(true);
  });

  it('rejects a wrong password', async () => {
    await signIn('lucia', 'wrong-password-1');
    await page.getByText('Wrong username or password.').waitFor();
  });

  it('lets an admin create a username and password that the RCM can then use', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Team' }).click();
    await page.getByRole('button', { name: 'Create login' }).click();
    await page.getByLabel('Full name').fill('Test Recruiter');
    await page.getByLabel('Username').fill('test.rcm');
    await page.getByLabel('Password', { exact: true }).fill('welcome2026x');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByText('Login created').waitFor();
    expect(await page.getByTestId('credentials').innerText()).toContain('test.rcm');
    expect(await page.getByTestId('credentials').innerText()).toContain('welcome2026x');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('test.rcm', 'welcome2026x');
    await page.getByText('Choose your time zone').waitFor();
  });

  it('does not show team management to RCMs', async () => {
    await signIn('regina');
    await page.getByText('Signed in as Regina Nemeth').waitFor();
    expect(await page.getByRole('button', { name: 'Team' }).count()).toBe(0);
  });
});

describe('read-only access (Max, Adrien)', () => {
  it('shows the board but no way to change it', async () => {
    await signIn('max');
    await page.getByText('You have read-only access').first().waitFor();
    expect(await page.getByRole('button', { name: 'Team' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Edit' }).count()).toBe(0);
    expect(await page.locator('.col.can-book').count()).toBe(0);
    expect(await page.locator('.shift .x').count()).toBe(0);
    await page.locator('.shift', { hasText: 'Kris Arévalo' }).first().click();
    await page.getByRole('button', { name: 'Close' }).waitFor();
    expect(await page.getByRole('button', { name: /Take this shift|Delete shift|Save/ }).count()).toBe(0);
  });
});

describe('time zone chosen by the RCM', () => {
  it('asks at first login and shows the board in that zone', async () => {
    await signIn('olizhia');
    await page.getByText('Choose your time zone').waitFor();
    await page.getByLabel('Your time zone').selectOption('Asia/Jakarta');
    await page.getByRole('button', { name: 'Save time zone' }).click();
    await page.getByText('Add your availability').waitFor();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.getByText('Times shown in your time zone: Asia/Jakarta').waitFor();
  });

  it('shows each RCM\'s time zone next to their name in the calendar', async () => {
    await signIn('lucia');
    await page.locator('.shift').first().waitFor();
    const blocks = await text('.shift');
    expect(blocks.some((b) => b.includes('Regina Nemeth') && b.includes('Budapest'))).toBe(true);
    expect(blocks.some((b) => b.includes('Kris Arévalo') && b.includes('Bogota'))).toBe(true);
  });

  it('shows the zone in the hours table too', async () => {
    await signIn('lucia');
    await page.locator('#hours table').waitFor();
    expect((await page.locator('#hours').innerText())).toContain('Istanbul');
  });
});

describe('required hours with gaps', () => {
  it('adds a second slot to a day with the + button and saves it', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Edit' }).click();
    const monday = page.getByTestId('cov-day-1');
    await monday.getByRole('button', { name: 'Remove slot' }).nth(1).click();
    await monday.getByRole('button', { name: 'Remove slot' }).first().click();
    await monday.getByRole('button', { name: 'Add slot' }).click();
    await monday.getByLabel('Monday slot 1 from').selectOption('540');
    await monday.getByLabel('Monday slot 1 until').selectOption('720');
    await monday.getByRole('button', { name: 'Add slot' }).click();
    await monday.getByLabel('Monday slot 2 from').selectOption('900');
    await monday.getByLabel('Monday slot 2 until').selectOption('1080');
    await page.getByRole('button', { name: 'Save target' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.locator('#coverage', { hasText: '09:00–12:00, 15:00–18:00' }).waitFor();
  });

  it('refuses overlapping slots', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Edit' }).click();
    const monday = page.getByTestId('cov-day-1');
    await monday.getByLabel('Monday slot 2 from').selectOption('720');
    await page.getByRole('button', { name: 'Save target' }).click();
    await page.getByText('Monday: slots').waitFor();
  });
});

describe('hours worked and shift reports', () => {
  // Regina's demo shift on Monday 07:00–13:00 (Rome) has already started this week.
  async function reportAsRegina() {
    await signIn('regina');
    await page.locator('.shift', { hasText: 'Regina Nemeth (you)' }).first().click();
    await page.getByTestId('overlay').getByRole('button', { name: 'Add report' }).click();
    await page.getByLabel('Hours worked').selectOption('4');
    await page.getByLabel('Minutes').selectOption('30');
    await page.getByLabel('Onboarding').check();
    await page.getByLabel('Anything more specific? (optional)').fill('Answered Zone A, onboarded 3 posters');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.locator('#my-reports, [data-testid="my-reports"]', { hasText: 'Answered Zone A, onboarded 3 posters' }).waitFor();
  }

  it('lets an RCM log hours worked and a report, shown in their hours table', async () => {
    await reportAsRegina();
    expect(await page.getByTestId('my-reports').innerText()).toContain('Worked 4h 30m (booked 6h) · Onboarding · Answered Zone A');
    const row = page.locator('#hours tr', { hasText: 'Regina Nemeth' });
    expect(await row.innerText()).toContain('4h 30m');
  });

  it('shows RCMs only their own hours, and no history or required coverage', async () => {
    await signIn('regina');
    await page.locator('.shift').first().waitFor();
    expect(await page.locator('#hours tbody tr').count()).toBe(1);
    expect(await page.locator('#history').count()).toBe(0);
    expect(await page.locator('#coverage').count()).toBe(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.locator('#history').waitFor();
    expect(await page.locator('#hours tbody tr').count()).toBeGreaterThan(1);
  });

  it("only offers the four kinds of work and needs the posters' names for posters' issues", async () => {
    await signIn('regina');
    await page.getByTestId('my-reports').getByRole('button', { name: 'Add report' }).first().click();
    expect(await page.getByRole('group', { name: 'What did you do?' }).getByRole('checkbox').count()).toBe(4);
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.getByText('Tick at least one kind of work, or link a task.').waitFor();
    await page.getByLabel("Posters' issues").check();
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.getByText('Write the names of the posters who had issues.').waitFor();
    await page.getByLabel('Posters who had issues (required)').fill('Ana, Bo');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.getByTestId('my-reports').getByText("Posters' issues (Ana, Bo)").waitFor();
  });

  it('links time to tasks instead of ticking kinds of work, and lets the RCM delete the report', async () => {
    await signIn('regina');
    await page.getByTestId('my-reports').getByRole('button', { name: 'Add report' }).first().click();
    await page.getByRole('button', { name: 'Link task' }).click();
    await page.getByLabel(/Clean up the Zone B channel/).check();
    await page.getByLabel(/Check new OS accounts/).check();
    await page.getByLabel('Minutes on Clean up the Zone B channel').selectOption('120');
    await page.getByLabel('Minutes on Check new OS accounts').selectOption('60');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'My tasks' }).click();
    await page.getByTestId('task-card').filter({ hasText: 'Clean up the Zone B channel' }).getByText('logged 2h').waitFor();
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.getByTestId('my-reports').getByRole('button', { name: 'Delete report' }).click();
    await page.getByTestId('my-reports').getByRole('button', { name: 'Click again to delete' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="my-reports"]')?.textContent?.includes('Worked'));
  });

  it('lets admins edit any report; viewers stay read-only', async () => {
    await reportAsRegina();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('max');
    await page.locator('#history', { hasText: 'Answered Zone A' }).waitFor();
    expect(await page.locator('#history').getByRole('button', { name: /report/ }).count()).toBe(0);
    expect(await page.getByRole('button', { name: /Tasks/ }).count()).toBe(0); // no task page for viewers
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.locator('#history').getByRole('button', { name: 'Edit report' }).first().click();
    await page.getByLabel('Anything more specific? (optional)').fill('Corrected by Lucia');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.locator('#history', { hasText: 'Corrected by Lucia' }).waitFor();
    expect(await page.locator('#history').innerText()).toContain("Lucia De Mojà edited the report on Regina Nemeth's shift");
  });
});

describe('weekly report', () => {
  // Pretend it is Sunday afternoon of this week (the demo builds its week around the clock).
  async function onSunday() {
    const d = new Date();
    const toSunday = (7 - (d.getUTCDay() || 7)) % 7;
    await page.clock.install({ time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + toSunday, 15, 0) });
    await page.reload();
  }
  async function onWednesday() {
    const d = new Date();
    const back = (d.getUTCDay() || 7) - 3;
    await page.clock.install({ time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 15, 0) });
    await page.reload();
  }
  async function reportMonday() {
    await page.getByTestId('my-reports').getByRole('button', { name: 'Add report' }).first().click();
    await page.getByLabel('Hours worked').selectOption('5');
    await page.getByLabel('Community management').check();
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
  }

  it('cannot be sent before Sunday', async () => {
    await onWednesday();
    await signIn('regina');
    await reportMonday();
    await page.getByRole('button', { name: /^Weekly report/ }).click();
    await page.getByTestId('weekly-closed').waitFor();
    expect(await page.getByRole('button', { name: 'Send to admins' }).isDisabled()).toBe(true);
  });

  it('is pre-written from the reported hours, sent on Sunday, approved by an admin, then logged on Upwork', async () => {
    await onSunday();
    await signIn('regina');
    await reportMonday();
    await page.getByRole('button', { name: /^Weekly report/ }).click();
    await page.getByTestId('weekly-total').filter({ hasText: /^5h$/ }).waitFor();
    const msg = await page.getByLabel('Message to the admins').inputValue();
    expect(msg).toContain('Hours worked: 5h (1 shift reported)');
    expect(msg).toContain('Community management');
    expect(msg).toContain('Not reported yet:'); // Tuesday has no report
    await page.getByRole('button', { name: 'Send to admins' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    // the week is now locked for the RCM
    await page.getByTestId('my-reports').getByText('Sent in the weekly report').first().waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('aram');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByTestId('weekly-requests').getByText('Regina Nemeth', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Approve hours' }).click();
    await page.getByText('No weekly reports waiting.').waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('regina');
    await page.getByRole('button', { name: /^Weekly report/ }).click();
    expect(await page.getByTestId('weekly-approved').innerText()).toContain('Approved by Aram Hamawandy. Now add 5h for this week to your Upwork contract.');
  });
});

describe('tasks', () => {
  it('shows RCMs their tasks and the ones up for grabs, never the admins\' tasks', async () => {
    await signIn('regina');
    await page.getByRole('button', { name: 'My tasks' }).click();
    const titles = await page.getByTestId('task-card').allInnerTexts();
    expect(titles.some((t) => t.includes('Clean up the Zone B channel'))).toBe(true);
    expect(titles.some((t) => t.includes('Update the pinned links'))).toBe(true);
    expect(titles.some((t) => t.includes('Plan December hiring'))).toBe(false);
    expect(titles.some((t) => t.includes('Welcome message for Zone C'))).toBe(false); // Rana's
  });

  it('lets an RCM take a task up for grabs and move cards (select or drag), and admins see it', async () => {
    await signIn('regina');
    await page.getByRole('button', { name: 'My tasks' }).click();
    await page.getByRole('list', { name: 'Up for grabs' }).getByRole('button', { name: 'Take it' }).click();
    await page.getByRole('list', { name: 'To do' }).getByText('Update the pinned links in #managers-hq').waitFor();
    await page.getByLabel('Move Update the pinned links in #managers-hq').selectOption('in_progress');
    await page.getByRole('list', { name: 'In progress' }).getByText('Update the pinned links').waitFor();
    const card = page.getByTestId('task-card').filter({ hasText: 'Clean up the Zone B channel' });
    await card.dragTo(page.locator('.kcol[data-status="done"]'));
    await page.getByRole('list', { name: 'Done' }).getByText('Clean up the Zone B channel').waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.getByTestId('notif-badge').waitFor();
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.getByRole('list', { name: 'Done' }).getByText('Clean up the Zone B channel').waitFor();
    await page.getByRole('button', { name: 'Dashboard' }).click();
    expect(await page.getByTestId('done-total').innerText()).toBe('1');
    expect(await page.getByTestId('done-regina').innerText()).toBe('1');
    expect(await page.getByTestId('done-rcms').innerText()).toBe('1');
    expect(await page.getByTestId('done-admins').innerText()).toBe('0');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByText('Regina Nemeth took “Update the pinned links in #managers-hq” from the tasks up for grabs').waitFor();
  });

  it('lets admins create a task with priority and estimate for several people, each with their own status', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Review Zone A guide');
    await page.getByLabel('Priority').selectOption('urgent');
    await page.getByLabel('Estimated hours').selectOption('2');
    await page.getByLabel('Estimated minutes').selectOption('30');
    await page.getByRole('group', { name: 'Assigned to' }).getByLabel('Kris Arévalo').check();
    await page.getByRole('group', { name: 'Assigned to' }).getByLabel('Rana Barakli').check();
    await page.getByRole('button', { name: 'Create task' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.getByTestId('task-card').filter({ hasText: 'Review Zone A guide' }).nth(1).waitFor();
    expect(await page.getByTestId('task-card').filter({ hasText: 'Review Zone A guide' }).count()).toBe(2);
    await page.getByLabel('Move Review Zone A guide for Kris Arévalo').selectOption('done');
    await page.getByRole('list', { name: 'Done' }).getByText('Review Zone A guide').waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('rana');
    await page.getByRole('button', { name: 'My tasks' }).click();
    const card = page.getByRole('list', { name: 'To do' }).getByTestId('task-card').filter({ hasText: 'Review Zone A guide' });
    expect(await card.innerText()).toContain('URGENT');
    expect(await card.innerText()).toContain('Est. 2h 30m');
  });

  it('asks whether a task without assignees is up for grabs for RCMs or admins', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Tasks', exact: true }).click();
    const grabs = page.getByRole('list', { name: 'Up for grabs' });
    expect(await grabs.getByText('For admins').count()).toBe(1); // demo admin task
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Check the bot answers');
    await page.getByRole('button', { name: 'Create task' }).click();
    await page.getByText('Choose whether this task is up for grabs for RCMs or for admins.').waitFor();
    await page.getByLabel(/^Admins/).check();
    await page.getByRole('button', { name: 'Create task' }).click();
    await grabs.getByTestId('task-card').filter({ hasText: 'Check the bot answers' }).getByRole('button', { name: 'Take it' }).click();
    await page.getByRole('list', { name: 'To do' }).getByText('Check the bot answers').waitFor();
    await page.getByLabel('Move Check the bot answers for Lucia De Mojà').selectOption('done');
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await page.getByTestId('done-admins').filter({ hasText: /^1$/ }).waitFor();
    expect(await page.getByTestId('done-total').innerText()).toBe('1');
    expect(await page.getByTestId('done-rcms').innerText()).toBe('0');
    expect(await page.locator('.barrow.team').innerText()).toContain('no completed tasks'); // admins left out of speed
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('regina');
    await page.getByRole('button', { name: 'My tasks' }).click();
    const titles = await page.getByTestId('task-card').allInnerTexts();
    expect(titles.some((t) => t.includes('Review the Upwork message templates'))).toBe(false);
    expect(titles.some((t) => t.includes('Update the pinned links'))).toBe(true);
  });

  it('shows the RCM role page to RCMs only', async () => {
    await signIn('kris');
    await page.getByRole('button', { name: 'My role' }).click();
    await page.getByRole('heading', { name: 'Recruiter & Community Manager', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.locator('.shift').first().waitFor();
    expect(await page.getByRole('button', { name: 'My role' }).count()).toBe(0);
  });
});

describe('availability and assigning shifts', () => {
  it('asks a new RCM for availability after the time zone and shows it on the board', async () => {
    await signIn('olizhia');
    await page.getByLabel('Your time zone').selectOption('Asia/Jakarta');
    await page.getByRole('button', { name: 'Save time zone' }).click();
    await page.getByText('Add your availability').waitFor();
    const monday = page.getByTestId('av-day-1');
    await monday.getByRole('button', { name: 'Add slot' }).click();
    await monday.getByLabel('Monday slot 1 from').selectOption('540');
    await monday.getByLabel('Monday slot 1 until').selectOption('1020');
    await page.getByRole('button', { name: 'Copy Monday to all days' }).click();
    await page.getByRole('button', { name: 'Save availability' }).click();
    await page.getByText('Times shown in your time zone: Asia/Jakarta').waitFor();
    expect(await page.locator('.avail').count()).toBe(7);
    expect(await page.getByRole('button', { name: 'My availability' }).count()).toBe(1);
    expect(await page.locator('#view-pick').count()).toBe(0); // RCMs only see their own availability
  });

  it('lets an RCM change one day only, e.g. a day off', async () => {
    await signIn('regina');
    await page.getByRole('button', { name: 'My availability' }).click();
    const firstDay = page.locator('[data-testid^="av-date-"]').first();
    await firstDay.getByRole('checkbox').check();
    await firstDay.getByRole('button', { name: 'Remove slot' }).click();
    await page.getByRole('button', { name: 'Save availability' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('.avail').length === 5); // usually Mon–Sat, Monday now off
  });

  async function requestAsRana() {
    await signIn('rana');
    await page.getByRole('button', { name: 'Next week' }).click();
    const { x, y } = await slot(3, 9); // 09:00 Istanbul, before Rana's 15:00 start
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + R * 4, { steps: 2 });
    await page.mouse.up();
    await page.getByTestId('availability-warning').waitFor();
    await page.getByTestId('request-warning').waitFor();
    await page.getByRole('button', { name: 'Send request' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.locator('.shift.is-pending').waitFor();
  }

  it('turns an RCM booking outside their availability into a request they cannot report on yet', async () => {
    await requestAsRana();
    await page.locator('.shift.is-pending').click();
    await page.getByTestId('pending-note').waitFor();
    expect(await page.getByTestId('overlay').getByRole('button', { name: /report|Ask for cover/ }).count()).toBe(0);
    await page.getByRole('button', { name: 'Withdraw request' }).waitFor();
  });

  it('notifies admins, who approve the request from the notifications panel', async () => {
    await requestAsRana();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.getByTestId('notif-badge').waitFor();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByTestId('requests').getByText('Rana Barakli asks for').waitFor();
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByText('No requests waiting.').waitFor();
    expect(await page.getByText('Changes by RCMs').count()).toBe(1);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.locator('.shift', { hasText: 'Rana Barakli' }).first().waitFor();
    expect(await page.locator('.shift.is-pending').count()).toBe(0);
    expect(await page.getByTestId('notif-badge').count()).toBe(0);
  });

  it('lets admins reject a request from the shift itself', async () => {
    await requestAsRana();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('aram');
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.locator('.shift.is-pending').click();
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.shift.is-pending'));
  });

  it('shows admins everyone\'s availability and lets them assign outside it with a warning', async () => {
    await signIn('lucia');
    await page.locator('.lane').first().waitFor();
    expect(await page.locator('#view-pick option').allInnerTexts()).toEqual(["Admin view: everyone's availability", 'Kris Arévalo', 'Olizhia Mairuhu', 'Rana Barakli', 'Regina Nemeth']);
    const p = await slot(4, 20); // Friday 20:00 Rome
    await page.mouse.click(p.x + 40, p.y);
    expect(await page.getByLabel('RCM').locator('option').allInnerTexts()).toContain('🔴 Regina Nemeth');
    await page.getByLabel('RCM').selectOption({ label: '🔴 Regina Nemeth' });
    await page.getByText("Outside Regina Nemeth's availability. You can still assign it.").waitFor();
    await page.getByRole('button', { name: 'Book shift' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.locator('.shift', { hasText: 'Regina Nemeth' }).nth(2).waitFor();
  });

  it('lets admins and viewers switch to one RCM\'s view', async () => {
    await signIn('max');
    await page.locator('#view-pick').selectOption({ label: 'Kris Arévalo' });
    await page.locator('.avail').first().waitFor();
    expect(await page.locator('.lane').count()).toBe(0);
    expect(await page.getByRole('button', { name: /availability/ }).count()).toBe(0); // viewers cannot edit it
  });
});

describe('history, plan and past days', () => {
  it('lets admins filter the history by person (not viewers) and delete entries', async () => {
    await signIn('lucia');
    const options = await page.locator('#hist-person option').allInnerTexts();
    expect(options).toContain('Regina Nemeth');
    expect(options).not.toContain('Max');
    expect(options.some((o) => /Adrien/.test(o))).toBe(false);
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.locator('#plan li').first().getByRole('button', { name: 'Assign' }).click();
    await page.locator('#history li', { hasText: 'Lucia De Mojà' }).first().waitFor();
    await page.locator('#hist-person').selectOption({ label: 'Regina Nemeth' });
    for (const t of await text('#history li')) expect(t).toMatch(/Regina Nemeth|Changes to shifts/);
    await page.locator('#hist-person').selectOption({ label: 'Lucia De Mojà' });
    for (const t of await text('#history li')) expect(t).toContain('Lucia De Mojà');
    const before = await page.locator('#history li:not(.empty)').count();
    await page.locator('#history').getByRole('button', { name: 'Delete this entry' }).first().click();
    await page.locator('#history').getByRole('button', { name: 'Click again to delete this entry' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('#history li:not(.empty)').length === n - 1, before);
  });

  it('lets viewers filter the history but not delete it', async () => {
    await signIn('max');
    await page.locator('#hist-person').waitFor();
    expect(await page.locator('#history .del').count()).toBe(0);
  });

  it('shows admins the week plan with suggestions they can assign', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Next week' }).click();
    const plan = page.locator('#plan');
    await plan.getByText('Required', { exact: true }).waitFor();
    const items = plan.getByRole('list', { name: 'Suggested shifts' }).locator('li');
    await items.first().waitFor();
    expect(await page.locator('.ghost').count()).toBeGreaterThan(0);
    const n = await items.count();
    await items.first().getByRole('button', { name: 'Assign' }).click();
    await page.waitForFunction((k) => document.querySelectorAll('#plan li').length !== k, n);
    expect(await page.locator('#plan').count()).toBe(1);
  });

  it('opens a suggestion from the grid with the RCM already picked', async () => {
    await signIn('lucia');
    await page.getByRole('button', { name: 'Next week' }).click();
    const g = page.locator('.ghost').first();
    await g.scrollIntoViewIfNeeded();
    const label = (await g.getAttribute('aria-label'))!;
    await g.click();
    const who = label.replace('Suggested: ', '').split(',')[0];
    expect(await page.getByLabel('RCM').locator('option:checked').innerText()).toContain(who);
  });

  it('hides plan and notifications from RCMs and viewers', async () => {
    await signIn('regina');
    await page.locator('.shift').first().waitFor();
    expect(await page.locator('#plan').count()).toBe(0);
    expect(await page.getByRole('button', { name: /^Notifications/ }).count()).toBe(0);
  });
});

describe('live updates and time zones', () => {
  it('clears the notification dot once the panel is opened, even with requests still waiting', async () => {
    await signIn('rana');
    await page.getByRole('button', { name: 'Next week' }).click();
    const p = await slot(3, 9); // 09:00 Istanbul: outside Rana's hours
    await page.mouse.click(p.x, p.y);
    await page.getByRole('button', { name: 'Send request' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.getByTestId('notif-badge').waitFor();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByTestId('requests').waitFor();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="notif-badge"]'));
  });

  it('redraws the calendar when you change your time zone', async () => {
    await signIn('lucia');
    await page.getByText('Times shown in your time zone: Europe/Rome').waitFor();
    const before = await page.locator('.shift').first().getAttribute('style');
    await page.getByRole('button', { name: 'Change' }).click();
    await page.getByLabel('Your time zone').selectOption('America/Bogota');
    await page.getByRole('button', { name: 'Save time zone' }).click();
    await page.getByText('Times shown in your time zone: America/Bogota').waitFor();
    await page.waitForFunction((b) => document.querySelector('.shift')?.getAttribute('style') !== b, before);
  });

  it('explains the time change when the required hours are set in another zone', async () => {
    await page.clock.install({ time: Date.parse('2026-10-23T12:00:00Z') });
    await page.reload();
    await signIn('kris'); // Bogota, required hours in Rome time
    expect(await page.getByTestId('dst-note').innerText()).toContain('from this day they show 1 hour later in your time zone');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia'); // Rome: Sunday 25 Oct has 25 hours
    await page.locator('.dayhead .dst', { hasText: 'clocks −1h' }).waitFor();
    expect(await page.getByTestId('dst-note').count()).toBe(0);
  });
});

describe('booking (unchanged from the original board)', () => {
  it('books availability by dragging on the grid', async () => {
    await signIn('rana');
    const before = await page.locator('.shift').count();
    const { x, y } = await slot(3, 16); // 16:00 Istanbul, inside Rana's availability (15–21)
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + R * 8, { steps: 4 }); // two hours
    await page.mouse.up();
    await page.getByRole('button', { name: 'Book shift' }).click();
    await page.getByTestId('overlay').waitFor({ state: 'hidden' });
    await page.locator('.shift', { hasText: '16:00–18:15' }).waitFor();
    expect(await page.locator('.shift').count()).toBe(before + 1);
    expect(await page.locator('.shift', { hasText: '16:00–18:15' }).innerText()).toContain('Rana Barakli');
  });

  it('refuses a second RCM in the same slot', async () => {
    await signIn('rana');
    await page.locator('.shift', { hasText: 'Regina Nemeth' }).first().waitFor();
    const p = await slot(0, 8, 30); // 08:30 Istanbul, inside Regina's shift
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    // the click lands on Regina's 07:00–13:00 Monday shift, which opens it read-only for Rana
    await page.getByText('Only the person who booked this shift or an admin can change it.').waitFor();
  });
});
