import { useEffect, useState } from 'react';
import type { Repo, Snapshot } from './data/repo';
import { DAY_MS, addDays, browserTimeZone, dayStartMs, weekStart } from './lib/time';
import { Board } from './ui/Board';
import { Login } from './ui/Login';
import { TimezonePicker } from './ui/TimezonePicker';

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

  return <Board repo={repo} snap={snap} tz={tz} mon={mon} loadError={error} onWeek={(d) => setWeekOffset((w) => (d === null ? 0 : w + d))} />;
}
