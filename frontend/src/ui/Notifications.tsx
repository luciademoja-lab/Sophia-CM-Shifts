import { useEffect, useState } from 'react';
import type { Repo } from '../data/repo';
import { historyText, notificationsFor, type LogEntry, type Profile, type Shift } from '../lib/shifts';
import { dayLabel, hm, rangeLabel } from '../lib/time';
import { errorText } from './errors';
import { Modal } from './Modal';

type Props = {
  repo: Repo; me: Profile; profiles: Record<string, Profile>; tz: string;
  log: LogEntry[]; requests: Shift[]; seenAt: number; onClose: () => void;
};

/** Count shown on the header button: requests to decide plus RCM changes not seen yet. */
export function unreadCount(log: LogEntry[], requests: Shift[], profiles: Record<string, Profile>, me: Profile | null, seenAt: number): number {
  return requests.length + notificationsFor(log, profiles, me, seenAt).filter((n) => n.unread && n.entry.action !== 'requested').length;
}

/** Admins: requests waiting for approval, then changes made by RCMs. */
export function NotificationsModal({ repo, me, profiles, tz, log, requests, seenAt, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [since] = useState(seenAt); // keep the "new" marks while the panel is open
  useEffect(() => { repo.markNotificationsSeen().catch(() => undefined); }, [repo]);
  const name = (id: string | null) => (id && profiles[id]?.fullName) || 'Someone';
  const items = notificationsFor(log, profiles, me, since).slice(0, 60);
  const decide = async (id: string, fn: (id: string) => Promise<void>) => {
    setBusy(id); setError(null);
    try { await fn(id); } catch (e) { setError(errorText(e, tz)); } finally { setBusy(null); }
  };
  const sorted = [...requests].sort((a, b) => a.start - b.start);
  return (
    <Modal label="Notifications" wide onClose={onClose}>
      <div><div className="eyebrow">Admins</div><h2>Notifications</h2></div>
      <section aria-label="Requests waiting for approval">
        <h3>Requests to approve</h3>
        {!sorted.length ? <p className="empty">No requests waiting.</p> : (
          <ul className="notif" data-testid="requests">
            {sorted.map((s) => (
              <li key={s.id} className="unread">
                <span><b>{name(s.owner)}</b> asks for <span className="mono">{rangeLabel(s.start, s.end, tz)}</span></span>
                <div className="row">
                  <button className="btn danger small" type="button" disabled={busy === s.id} onClick={() => decide(s.id, (id) => repo.rejectShift(id))}>Reject</button>
                  <button className="btn primary small" type="button" disabled={busy === s.id} onClick={() => decide(s.id, (id) => repo.approveShift(id))}>Approve</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <p className="err" role="alert">{error}</p>}
      <section aria-label="Changes by RCMs">
        <h3>Changes by RCMs</h3>
        {!items.length ? <p className="empty">Nothing yet.</p> : (
          <ul className="notif">
            {items.map(({ entry, unread }) => (
              <li key={entry.id} className={unread ? 'unread' : ''}>
                <span className="note mono">{dayLabel(entry.at, tz)} {hm(entry.at, tz)}{unread ? ' · new' : ''}</span>
                <span>{historyText(entry, name, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="actions"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
