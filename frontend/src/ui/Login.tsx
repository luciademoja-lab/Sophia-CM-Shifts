import { useState, type FormEvent } from 'react';
import type { Repo } from '../data/repo';
import { DEMO_PASSWORD } from '../data/demoSeed';
import { errorText } from './errors';
import { Field } from './Modal';

export function Login({ repo }: { repo: Repo }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await repo.signIn(username, password); } catch (err) { setError(errorText(err, 'UTC')); setBusy(false); }
  }

  return (
    <div className="auth">
      <div>
        <div className="eyebrow">Vik Studios · Recruiter &amp; Community Managers</div>
        <h1>RCM Shifts</h1>
      </div>
      <form className="card" onSubmit={submit}>
        <Field label="Username" htmlFor="login-user">
          <input id="login-user" type="text" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="login-pass">
          <input id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="actions"><button className="btn primary" type="submit" disabled={busy}>Sign in</button></div>
        <p className="note">Your login is created by Lucia or Aram. Lost your password? Ask them to reset it.</p>
      </form>
      {repo.mode === 'demo' && (
        <p className="banner">Demo mode, nothing is saved. Sign in as <b>lucia</b> or <b>aram</b> (admins), or <b>regina</b>, <b>kris</b>, <b>rana</b>, <b>olizhia</b> (RCMs), <b>max</b> or <b>adrien</b> (read-only). Password: <span className="mono">{DEMO_PASSWORD}</span></p>
      )}
    </div>
  );
}
