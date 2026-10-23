import { useEffect, useState } from 'react';
import type { Repo, Snapshot } from './data/repo';
import { DAY_MS, addDays, browserTimeZone, dayStartMs, weekStart } from './lib/time';
import { Board } from './ui/Board';
import { Login } from './ui/Login';
import { TimezonePicker } from './ui/TimezonePicker';
import { AvailabilityForm } from './ui/AvailabilityForm';
import { emptyAvailability } from './lib/availability';

export function App({ repo }: { repo: Repo }) {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const check = () => { repo.session().then(setUid, () => setUid(null)); };
    check();
    return repo.onAuthChange(check);
  }, [repo]);

  if (uid === undefined) return <div className="wrap"><p className="muted">Loading…</p></div>;
  if (!uid) return <Login repo={repo} />;
  return <SignedIn key={uid} repo={repo} />;
}

function SignedIn({ repo }: { repo: Repo }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [skippedAvailability, setSkippedAvailability] = useState(() => { try { return sessionStorage.getItem('rcm-skip-availability') === '1'; } catch { return false; } });

  const tz = snap?.me?.timezone || browserTimeZone();
  const mon = addDays(weekStart(Date.now(), tz), weekOffset * 7);
  // a day of margin on both sides covers every time zone's view of the week
  const from = dayStartMs(mon, tz) - DAY_MS, to = dayStartMs(addDays(mon, 7), tz) + DAY_MS;

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const off = repo.subscribe(() => { clearTimeout(pending); pending = setTimeout(() => setTick((t) => t + 1), 150); });
    return () => { clearTimeout(pending); off(); };
  }, [repo]);

  useEffect(() => {
    let alive = true;
    repo.load(from, to).then(
      (s) => { if (alive) { setSnap(s); setError(null); } },
      () => { if (alive) setError('Lost the connection to the schedule. Reload the page.'); },
    );
    return () => { alive = false; };
  }, [repo, from, to, tick]);

  if (!snap) return <div className="wrap"><p className={error ? 'err' : 'muted'}>{error || 'Loading the schedule…'}</p></div>;

  if (snap.me && !snap.me.timezone) {
    return (
      <div className="auth"><div className="card">
        <TimezonePicker current={null} onSave={async (z) => { await repo.setMyTimezone(z); setTick((t) => t + 1); }} />
      </div></div>
    );
  }

  // Step 2 for RCMs: after the time zone, ask for their availability.
  const myAvailability = snap.me ? snap.availability[snap.me.id] : undefined;
  const noAvailability = !myAvailability || (!Object.keys(myAvailability.week).length && !Object.keys(myAvailability.days).length);
  if (snap.me && snap.me.role === 'rcm' && noAvailability && !skippedAvailability) {
    const me = snap.me;
    return (
      <div className="wrap" style={{ maxWidth: 720 }}><div className="panel">
        <AvailabilityForm repo={repo} me={me} owner={me} availability={myAvailability || emptyAvailability(me.timezone)}
          weekDates={Array.from({ length: 7 }, (_, i) => addDays(mon, i))}
          title="Add your availability"
          intro="Tell us when you can work each week. Admins assign shifts inside these hours, and you can change them any time from “My availability”."
          onDone={() => { setSkippedAvailability(true); setTick((t) => t + 1); }}
          onSkip={() => { try { sessionStorage.setItem('rcm-skip-availability', '1'); } catch { /* private mode */ } setSkippedAvailability(true); }} />
      </div></div>
    );
  }

  return <Board repo={repo} snap={snap} tz={tz} mon={mon} loadError={error} onWeek={(d) => setWeekOffset((w) => (d === null ? 0 : w + d))} />;
}
