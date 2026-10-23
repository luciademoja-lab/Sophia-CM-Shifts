// The RCM role as described in the Vik Studios 2.0 guide.
const SECTIONS: Array<{ title: string; items: string[] }> = [
  {
    title: 'Your role',
    items: [
      'No job posting, no contract ending, no milestone payments.',
      'Onboard new posters to the OS dashboard and to Slack.',
      'Manage the Slack channels daily, for all posters.',
      'Report directly to operations (Aram and Lucia).',
      'Escalate technical tickets directly to the founders in #os-tickets.',
      'All four RCMs handle everything: all questions, referrals, account creations, and account checks, depending on your working schedule. There is no direct manager per poster.',
    ],
  },
  {
    title: 'Hiring',
    items: [
      'Every morning Aram shares the new Upwork contracts: your share arrives as a task in “My tasks”, one line per poster.',
      'For each poster: open the contract from their name, find the email address they sent in the conversation, paste it when you create their OS profile, and invite them to Slack.',
      'Create the OS account immediately after the offer is accepted.',
      'Your first and only message on Upwork: ask for the email address for the Slack invitation. No other communication on Upwork after the offer is accepted.',
    ],
  },
  {
    title: 'Onboarding to Slack and the OS',
    items: [
      'Send the Slack invite by email only (no alt accounts, no visitors). New posters only see #welcome.',
      'Add the poster to their zone channel: Zone A, Zone B or Zone C.',
      'Send the OS dashboard login instructions by DM, at the same time as you add the poster to the channel. The guide, payments included, is public in the zone channel.',
    ],
  },
  {
    title: 'Communication',
    items: [
      'All communication in English, and in Slack only. Payment questions too.',
      'Posters ask in their zone channel. No DMs from posters unless it can only be solved privately: you own those and escalate when needed.',
      'Use #managers-hq to ask questions and help each other; #managers-updates has the main documents and updates.',
    ],
  },
  {
    title: 'Reporting your hours',
    items: [
      'After each shift, add a report: the hours you actually worked and what you did. Pick from Onboarding, Daily accounts check, Posters’ issues (write the posters’ names) and Community management, or link the tasks you worked on.',
      'On Sunday, open “Weekly report”, check the message and send it to the admins. Once it is approved, add those hours to your Upwork contract.',
    ],
  },
];

export function RolePage() {
  return (
    <section className="panel rolepage">
      <div className="eyebrow">Vik Studios 2.0</div>
      <h2>Recruiter &amp; Community Manager</h2>
      <p className="note">Posters post two slideshows a day on TikTok, submit their milestone every Sunday and get paid on Monday. Our job is to hire them, onboard them and keep the community running, almost 24/7 across our time zones.</p>
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <h3>{s.title}</h3>
          <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      ))}
    </section>
  );
}
