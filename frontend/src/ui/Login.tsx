import { useState, type FormEvent } from 'react';
import type { Repo } from '../data/repo';
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
        <div className="eyebrow">Vik Studios · Success Community Managers</div>
        <h1>SCM Shifts</h1>
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
    </div>
  );
}
