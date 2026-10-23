import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ onClose, wide, label, children }: { onClose: () => void; wide?: boolean; label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const first = box.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), .btn.primary, .btn');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" data-testid="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={label} ref={box}>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
