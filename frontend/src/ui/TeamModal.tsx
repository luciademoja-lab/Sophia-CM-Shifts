import { useState } from 'react';
import type { Repo } from '../data/repo';
import type { Profile, Role } from '../lib/shifts';
import { tzLabel } from '../lib/time';
import { generatePassword } from '../../../backend/supabase/functions/_shared/username.ts';
import { errorText } from './errors';
import { Field, Modal } from './Modal';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'created'; username: string; password: string } | { kind: 'reset'; person: Profile } | { kind: 'reset-done'; person: Profile; password: string };

/** Admins create usernames and passwords to give out to the RCMs. */
export function TeamModal({ repo, me, profiles, onClose }: { repo: Repo; me: Profile; profiles: Record<string, Profile>; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = Object.values(profiles).sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
  const go = (v: View) => { setError(null); setBusy(false); setView(v); };

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e, 'UTC')); } finally { setBusy(false); }
  }

  return (
    <Modal label="Team" wide onClose={onClose}>
      {view.kind === 'list' && (<>
        <div className="panel-head">
          <div><div className="eyebrow">Admin</div><h2>Team</h2></div>
          <button className="btn primary" type="button" onClick={() => go({ kind: 'create' })}>Create login</button>
        </div>
        <table>
          <thead><tr><th>Person</th><th>Time zone</th><th /></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.fullName} {p.role === 'admin' && <span className="pill admin">admin</span>}{p.role === 'viewer' && <span className="pill">read-only</span>} {!p.active && <span className="pill off">inactive</span>}<span className="sub mono">{p.username}</span></td>
                <td>{p.timezone ? tzLabel(p.timezone, Date.now()) : <span className="muted">Not chosen yet</span>}</td>
                <td>
                  <span className="inline" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn small" type="button" onClick={() => go({ kind: 'reset', person: p })}>Reset password</button>
                    {p.id !== me.id && (
                      <button className="btn small" type="button" disabled={busy} onClick={() => run(() => repo.updateProfile(p.id, p.fullName, p.role, !p.active))}>{p.active ? 'Deactivate' : 'Reactivate'}</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="actions"><button className="btn" type="button" onClick={onClose}>Close</button></div>
      </>)}

      {view.kind === 'create' && <CreateLogin repo={repo} onBack={() => go({ kind: 'list' })} onCreated={(username, password) => go({ kind: 'created', username, password })} />}

      {view.kind === 'created' && (<>
        <div><div className="eyebrow">Team</div><h2>Login created</h2><p className="note">Send these to the RCM by Slack direct message. The password is not shown again.</p></div>
        <Credentials username={view.username} password={view.password} />
        <div className="actions"><button className="btn primary" type="button" onClick={() => go({ kind: 'list' })}>Done</button></div>
      </>)}

      {view.kind === 'reset' && (
        <ResetPassword person={view.person} repo={repo} onBack={() => go({ kind: 'list' })} onDone={(password) => go({ kind: 'reset-done', person: view.person, password })} />
      )}

      {view.kind === 'reset-done' && (<>
        <div><div className="eyebrow">Team</div><h2>Password reset</h2><p className="note">Send the new password to {view.person.fullName} by Slack direct message.</p></div>
        <Credentials username={view.person.username} password={view.password} />
        <div className="actions"><button className="btn primary" type="button" onClick={() => go({ kind: 'list' })}>Done</button></div>
      </>)}
    </Modal>
  );
}

function Credentials({ username, password }: { username: string; password: string }) {
  const text = `RCM Shifts: ${location.origin}\nUsername: ${username}\nPassword: ${password}`;
  const [copied, setCopied] = useState(false);
  return (<>
    <div className="creds" data-testid="credentials">{text}</div>
    <div className="actions" style={{ justifyContent: 'flex-start' }}>
      <button className="btn small" type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  </>);
}

function CreateLogin({ repo, onBack, onCreated }: { repo: Repo; onBack: () => void; onCreated: (username: string, password: string) => void }) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [role, setRole] = useState<Role>('rcm');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setError(null);
    try {
      const r = await repo.createLogin({ username, fullName, password, role });
      onCreated(r.username, password);
    } catch (e) { setError(errorText(e, 'UTC')); setBusy(false); }
  }

  return (<>
    <div><div className="eyebrow">Team</div><h2>Create login</h2><p className="note">The RCM chooses their time zone the first time they sign in.</p></div>
    <Field label="Full name" htmlFor="nl-name"><input id="nl-name" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} /></Field>
    <div className="fields two">
      <Field label="Username" htmlFor="nl-user"><input id="nl-user" type="text" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. regina" /></Field>
      <Field label="Role" htmlFor="nl-role">
        <select id="nl-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="rcm">RCM</option><option value="admin">Admin</option><option value="viewer">Read-only (e.g. Max, Adrien)</option>
        </select>
      </Field>
    </div>
    <Field label="Password" htmlFor="nl-pass">
      <div className="inline">
        <input id="nl-pass" type="text" className="mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        <button className="btn" type="button" onClick={() => setPassword(generatePassword())}>Generate</button>
      </div>
    </Field>
    <p className="note">At least 10 characters, with a letter and a number. Usernames use letters, numbers, dots, dashes and underscores.</p>
    {error && <p className="err" role="alert">{error}</p>}
    <div className="actions">
      <button className="btn" type="button" onClick={onBack}>Back</button>
      <button className="btn primary" type="button" disabled={busy} onClick={create}>Create</button>
    </div>
  </>);
}

function ResetPassword({ person, repo, onBack, onDone }: { person: Profile; repo: Repo; onBack: () => void; onDone: (password: string) => void }) {
  const [password, setPassword] = useState(() => generatePassword());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (<>
    <div><div className="eyebrow">Team</div><h2>Reset password</h2><p className="note">New password for {person.fullName} ({person.username}).</p></div>
    <Field label="New password" htmlFor="rp-pass">
      <div className="inline">
        <input id="rp-pass" type="text" className="mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        <button className="btn" type="button" onClick={() => setPassword(generatePassword())}>Generate</button>
      </div>
    </Field>
    {error && <p className="err" role="alert">{error}</p>}
    <div className="actions">
      <button className="btn" type="button" onClick={onBack}>Back</button>
      <button className="btn primary" type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await repo.resetPassword(person.id, password); onDone(password); } catch (e) { setError(errorText(e, 'UTC')); setBusy(false); }
      }}>Reset password</button>
    </div>
  </>);
}
