import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createRepo } from './data';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App repo={createRepo()} />
  </StrictMode>,
);
