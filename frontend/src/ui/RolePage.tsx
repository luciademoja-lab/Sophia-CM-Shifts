// The SCM (Success Community Manager) role, October 2026: hiring moved to Lucia and Aram.
const SECTIONS: Array<{ title: string; items: string[] }> = [
  {
    title: 'Your role',
    items: [
      'Manage the Slack channels every day and answer the posters’ questions in their zone channel. Private questions in DMs are yours too: escalate when needed.',
      'Do the daily accounts check.',
      'Handle posters’ issues and escalate technical tickets directly to the founders in #os-tickets.',
      'Create the OS accounts of new posters, and deactivate the accounts of posters who leave.',
      'Onboarding: add new posters to Slack and send them the welcome message with their login to the platform (it is in your daily to-do list).',
      'Hold new posters’ hands during their first few days: make sure they complete their tasks and understand their job.',
      'All four SCMs handle everything, depending on your working schedule. There is no direct manager per poster. You report directly to operations (Aram and Lucia).',
    ],
  },
  {
    title: 'Not your job',
    items: [
      'Hiring, job posts, Upwork messages and contracts, ending contracts and payments: Lucia and Aram take care of them.',
    ],
  },
  {
    title: 'Onboarding to Slack and the OS',
    items: [
      'Send the Slack invite by email only (no alt accounts, no visitors). New posters only see #welcome.',
      'Add the poster to their zone channel: Zone A, Zone B or Zone C.',
      'Send the OS login by DM, at the same time as you add the poster to the channel. The guide, payments included, is public in the zone channel.',
    ],
  },
  {
    title: 'Communication',
    items: [
      'All communication in English, and in Slack only. Payment questions too.',
      'Posters ask in their zone channel. No DMs from posters unless it can only be solved privately.',
      'Use #managers-hq to ask questions and help each other; #managers-updates has the main documents and updates.',
    ],
  },
  {
    title: 'Your shifts and hours',
    items: [
      'When your shift is on, press “Start shift”: you see the to-do list for that shift. Press “End shift” when you stop.',
      'After each shift, add a report: the hours you actually worked and what you did. Pick from Onboarding, Daily accounts check, Posters’ issues (write the posters’ names) and Community management, or link the tasks you worked on.',
      'On Sunday, open “Weekly report”, check the message and send it to the admins. Once it is approved, add those hours to your Upwork contract.',
    ],
  },
];

export function RolePage() {
  return (
    <section className="panel rolepage" data-tour="rolepage">
      <div className="eyebrow">Vik Studios 2.0</div>
      <h2>Success Community Manager</h2>
      <p className="note">Posters post two slideshows a day on TikTok, submit their milestone every Sunday and get paid on Monday. SCMs onboard them and keep the community running, almost 24/7 across our time zones.</p>
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <h3>{s.title}</h3>
          <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ))}
    </section>
  );
}
