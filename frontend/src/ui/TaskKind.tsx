/** First question when creating a task: a regular task, or the Upwork hiring & onboarding list. */
export function TaskKind({ current, onPick }: { current: 'regular' | 'contracts'; onPick: (k: 'regular' | 'contracts') => void }) {
  return (
    <div className="taskkind" role="radiogroup" aria-label="Kind of task">
      <span className="eyebrow">Kind of task</span>
      <label className={'kind' + (current === 'regular' ? ' on' : '')}>
        <input type="radio" name="task-kind" checked={current === 'regular'} onChange={() => onPick('regular')} />
        <b>Regular task</b><span>One task for the people you pick, or up for grabs.</span>
      </label>
      <label className={'kind' + (current === 'contracts' ? ' on' : '')}>
        <input type="radio" name="task-kind" checked={current === 'contracts'} onChange={() => onPick('contracts')} />
        <b>Hiring &amp; onboarding list</b><span>Paste the new Upwork contracts: they are split evenly between the SCMs, one poster per line.</span>
      </label>
    </div>
  );
}
