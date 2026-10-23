import { useEffect, useLayoutEffect, useState } from 'react';
import type { TourPage, TourStep } from '../lib/tour';

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6, GAP = 14, BUBBLE_W = 340;

const SEEN = (username: string) => `rcm-tour-seen:${username}`;
export function tourSeen(username: string): boolean {
  try { return localStorage.getItem(SEEN(username)) === '1' || localStorage.getItem('rcm-tour-skip-all') === '1'; } catch { return true; }
}
function markSeen(username: string) { try { localStorage.setItem(SEEN(username), '1'); } catch { /* private mode */ } }

/** Spotlight + speech bubble with an arrow, one step at a time. */
export function Tour({ steps, username, setPage, onClose }: { steps: TourStep[]; username: string; setPage: (p: TourPage) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [, setTick] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  const close = () => { markSeen(username); onClose(); };

  // switch tab, find the target, bring it into view and measure it
  useLayoutEffect(() => {
    setPage(step.page);
    setRect(null);
    if (!step.target) return;
    let tries = 0, raf = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) { if (tries++ < 30) raf = requestAnimationFrame(find); return; }
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, [i, step, setPage]);

  // keep the spotlight on the target when the window changes
  useEffect(() => {
    const again = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.top, left: r.left, width: r.width, height: r.height }); }
      setTick((t) => t + 1);
    };
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => { window.removeEventListener('resize', again); window.removeEventListener('scroll', again, true); };
  }, [step]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(BUBBLE_W, vw - 32);
  let bubble: { top: number; left: number }, arrow: 'up' | 'down' | null = null, arrowX = 0;
  if (rect) {
    // the tallest targets (the calendar) get the bubble on top of them, inside the view
    const below = rect.top + rect.height + GAP + 190 < vh;
    const above = rect.top - GAP - 190 > 0;
    const left = Math.max(16, Math.min(vw - w - 16, rect.left + rect.width / 2 - w / 2));
    if (below) { bubble = { top: rect.top + rect.height + PAD + GAP, left }; arrow = 'up'; }
    else if (above) { bubble = { top: rect.top - PAD - GAP, left }; arrow = 'down'; }
    else { bubble = { top: Math.max(16, Math.min(vh - 220, rect.top + 24)), left }; }
    arrowX = Math.max(18, Math.min(w - 18, rect.left + rect.width / 2 - left));
  } else bubble = { top: vh / 2 - 110, left: vw / 2 - w / 2 };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tutorial: ${step.title}`} data-testid="tour">
      {rect
        ? <div className="tour-hole" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        : <div className="tour-dim" />}
      <div className={'tour-bubble' + (arrow === 'down' ? ' is-above' : '')} style={{ top: bubble.top, left: bubble.left, width: w }}>
        {arrow && <span className={'tour-arrow ' + arrow} style={{ left: arrowX }} />}
        <div className="eyebrow">Tutorial · {i + 1} / {steps.length}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="linkbtn" onClick={close}>{last ? 'Close' : 'Skip tutorial'}</button>
          <span className="spacer" />
          {i > 0 && <button type="button" className="btn small" onClick={() => setI(i - 1)}>Back</button>}
          <button type="button" className="btn small primary" autoFocus onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
