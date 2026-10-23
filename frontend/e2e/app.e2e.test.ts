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
    await page.getByRole('button', { name: 'Add report' }).click();
    await page.getByLabel('Hours worked').selectOption('4');
    await page.getByLabel('Minutes').selectOption('30');
    await page.getByLabel('What did you do?').fill('Answered Zone A, onboarded 3 posters');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.locator('#history', { hasText: 'Answered Zone A, onboarded 3 posters' }).waitFor();
  }

  it('lets an RCM log hours worked and a report, shown in the history and the hours table', async () => {
    await reportAsRegina();
    expect(await page.locator('#history').innerText()).toContain('Regina Nemeth reported on a shift');
    expect(await page.locator('#history').innerText()).toContain('Worked 4h 30m (booked 6h)');
    const row = page.locator('#hours tr', { hasText: 'Regina Nemeth' });
    expect(await row.innerText()).toContain('4h 30m');
  });

  it('lets the RCM edit their report from the history', async () => {
    await reportAsRegina();
    await page.locator('#history').getByRole('button', { name: 'Edit report' }).first().click();
    await page.getByLabel('Hours worked').selectOption('5');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.locator('#history', { hasText: 'Worked 5h 30m' }).waitFor();
  });

  it('lets admins edit, and keeps other RCMs and viewers read-only', async () => {
    await reportAsRegina();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('kris');
    await page.locator('.shift').first().waitFor();
    expect(await page.locator('#history').innerText()).not.toContain('Answered Zone A'); // RCMs only see their own history
    expect(await page.locator('#history').getByRole('button', { name: /report/ }).count()).toBe(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('max');
    await page.locator('#history', { hasText: 'Answered Zone A' }).waitFor();
    expect(await page.locator('#history').getByRole('button', { name: /report/ }).count()).toBe(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn('lucia');
    await page.locator('#history').getByRole('button', { name: 'Edit report' }).first().click();
    await page.getByLabel('What did you do?').fill('Corrected by Lucia');
    await page.getByRole('button', { name: 'Save report' }).click();
    await page.locator('#history', { hasText: 'Corrected by Lucia' }).waitFor();
    expect(await page.locator('#history').innerText()).toContain("Lucia De Mojà edited the report on Regina Nemeth's shift");
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
    const col = page.locator('.col').nth(3);
    const box = (await col.boundingBox())!;
    const y = box.y + 11 * 4 * 9 + 2; // 09:00 Istanbul, before Rana's 15:00 start
    await page.mouse.move(box.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, y + 11 * 4, { steps: 2 });
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
    expect(await page.getByRole('button', { name: /report|Ask for cover/ }).count()).toBe(0);
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
    await page.locator('.boardwrap').evaluate((el) => { el.scrollTop = 11 * 4 * 14; }); // show the afternoon and evening
    const col = page.locator('.col').nth(4);
    const box = (await col.boundingBox())!;
    await page.mouse.click(box.x + 60, box.y + 11 * 4 * 20 + 2); // Friday 20:00 Rome
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
  it('shows RCMs only their own history', async () => {
    await signIn('rana');
    await page.locator('#history li').first().waitFor();
    expect(await page.locator('#hist-person').count()).toBe(0);
    for (const t of await text('#history li')) expect(t).toMatch(/Rana Barakli|Changes to shifts/);
  });

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

describe('booking (unchanged from the original board)', () => {
  it('books availability by dragging on the grid', async () => {
    await signIn('rana');
    const before = await page.locator('.shift').count();
    const col = page.locator('.col').nth(3);
    const box = (await col.boundingBox())!;
    const y = box.y + 11 * 4 * 16 + 2; // 16:00 Istanbul, inside Rana's availability (15–21)
    await page.mouse.move(box.x + 20, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, y + 11 * 8, { steps: 4 }); // two hours
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
    const col = page.locator('.col').nth(0);
    const box = (await col.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 11 * 4 * 8 + 22); // 08:30 Istanbul, inside Regina's shift
    await page.mouse.down();
    await page.mouse.up();
    // the click lands on Regina's 07:00–13:00 Monday shift, which opens it read-only for Rana
    await page.getByText('Only the person who booked this shift or an admin can change it.').waitFor();
  });
});
