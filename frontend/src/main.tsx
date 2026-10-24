import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createRepo } from './data';
import './styles.css';

const repo = createRepo();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {repo ? <App repo={repo} /> : (
      <div className="auth">
        <div><div className="eyebrow">Vik Studios · Success Community Managers</div><h1>SCM Shifts</h1></div>
        <div className="banner err" role="alert">
          This site is not connected to its database yet: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing from the build.
          Add them in Vercel (Settings → Environment Variables) and redeploy.
        </div>
      </div>
    )}
  </StrictMode>,
);
