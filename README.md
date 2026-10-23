# RCM Shifts

Availability and coverage board for the Vik Studios recruiters and community managers (RCMs).
It replaces the claude.ai artifact "RCM Shifts" and adds three changes requested by Aram (October 2026):

1. **Logins made by us.** Admins (Lucia, Aram) create a username and password for each RCM from the app (*Team > Create login*) and can reset passwords or deactivate people.
2. **Time zone chosen by the RCM.** At first sign-in each RCM picks their time zone. The board is drawn in it, and every shift shows the owner's zone next to their name (e.g. *Regina Nemeth · Budapest · UTC+2*). It is also shown in the hours table and the CSV export.
3. **Gaps in required hours.** In *Required coverage > Edit*, each day can hold several slots (*+ Add slot*), so a day can be required 07:00–13:00 and 14:00–24:00 with a break in between.

Added after Aram's second round of feedback:

4. **Hours worked and shift reports.** Once a shift has started, its RCM can add a report (from the shift or from the History panel): the hours actually worked, which can be more or less than the booked slot, and what they did. The shift owner and admins can edit it; it appears in the History, in a *Worked* column of the hours table and in the CSV export.
5. **Read-only access for Max and Adrien.** A third role, *viewer*: sees the board, history and reports, chooses a time zone, and cannot change anything (enforced by the database functions, not only hidden in the UI). Create their logins from *Team > Create login* with role *Read-only*.

Everything else works as in the artifact: drag to book, one RCM per slot, ask for cover / take over / give back, uncovered hours in red, history, CSV export.

## Structure

```
RCMshifts/
├── frontend/                 React + TypeScript app (Vite)
│   ├── src/lib/              pure logic: time zones, coverage, shifts   (unit tests next to each file)
│   ├── src/data/             repository: Supabase (live) or in-memory (demo + e2e)
│   ├── src/ui/               React components
│   └── e2e/                  end-to-end tests (Playwright, demo mode)
├── backend/supabase/         Supabase project (run the CLI with --workdir backend)
│   ├── migrations/           tables, RLS, Postgres functions (all writes go through them)
│   ├── functions/admin-users Edge Function: create logins, reset passwords
│   ├── functions/_shared/    rules shared with the app (usernames, passwords, admin-users core)
│   ├── tests/                database tests (fresh database per file, queries run through RLS)
│   └── bootstrap_admins.sql  one-off: make Lucia and Aram admins
├── vite.config.ts  vitest.config.ts  tsconfig.json  vercel.json
```

Changing a password from the database: in the Supabase SQL editor run `select set_password('ladmin', 'new-password-2026');` (works for any username, RCMs included). Admins can also reset passwords from the app (*Team > Reset password*).

How sign-in works: Supabase Auth needs an email, so each username maps to an internal address `username@rcm.vikstudios.com`. No email is ever sent; RCMs only ever see their username. Public sign-up is disabled.

## Run it locally

Requirements: Node 20+ and Git. For the real backend also Docker Desktop (Supabase runs in it) and `psql` (PostgreSQL client) for the database tests.

```bash
npm install
npx playwright install chromium     # once, for the e2e tests

npm test                            # unit tests (logic, demo repository, admin-users core)
npm run dev                         # http://localhost:5173
```

With no Supabase keys the app runs in **demo mode**: in-memory data, nothing saved. Sign in as `lucia` (admin) or `regina`, `kris`, `rana`, `olizhia` (RCMs), password `demo2026pass`. `olizhia` has no time zone yet, so she sees the first-login picker.

### With the real backend (local Supabase)

```bash
npm run db:start                    # starts Postgres, Auth, Studio in Docker and applies the migrations
npm run test:db                     # database tests against it
npm run functions:serve             # in a second terminal: the admin-users function
```

`db:start` prints the API URL and the anon key. Put them in `.env.local` (copy `.env.example`):

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key>
```

Create the first admins: open Studio (http://127.0.0.1:54323) > Authentication > Add user, emails `ladmin@rcm.vikstudios.com` (Lucia) and `aadmin@rcm.vikstudios.com` (Aram), tick *Auto Confirm User*. Then run `backend/supabase/bootstrap_admins.sql` in the SQL editor, with your own passwords. Restart `npm run dev` and sign in as `ladmin`.

### All tests

```bash
npm run test:all                    # unit + database + end-to-end
npm run typecheck
```

## Deploy (later)

1. **GitHub:** create an empty repository and push: `git remote add origin <url> && git push -u origin main`.
2. **Supabase:** create a project, then
   `npx supabase --workdir backend link --project-ref <ref>`,
   `npx supabase --workdir backend db push`,
   `npx supabase --workdir backend functions deploy admin-users`.
   In Authentication > Providers > Email, turn off "Allow new users to sign up". Create the two admins and run `bootstrap_admins.sql` as above.
3. **Vercel:** import the GitHub repository (the settings come from `vercel.json`), add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase > Project Settings > API, deploy. Add the Vercel URL to Supabase > Authentication > URL Configuration.

## How the code is built

Test first, one behaviour per commit: each commit adds a failing test, the code that makes it pass, and nothing else, so `git log` reads as a list of behaviours and `git bisect` finds a regression in a few steps.

- The rules live in two places on purpose: Postgres functions (the source of truth, tested in `backend/supabase/tests`) and the in-memory repository (the same rules for demo mode, tested in `frontend/src/data/memoryRepo.test.ts`). When a rule changes, change both tests first.
- Writes never touch tables directly: RLS lets signed-in users read; the functions check permissions, enforce one RCM per slot (also guaranteed by an exclusion constraint) and write the history in the same transaction.
- Times are stored as UTC instants. Coverage slots are minutes in the coverage time zone. The board converts both into the viewer's chosen zone, DST included (see `frontend/src/lib/time.test.ts`).
