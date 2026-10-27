// Board templates. Task dates are day offsets from the project start date (day 0, ideally a Monday).
// `who` is 'owner' (the studio owner) or 'designer' (first active member); labels are matched by name.

export const TEMPLATES = {
  website: {
    name: 'Website project (6–8 weeks)',
    description: 'Discovery → Design → Build → Review → Launch, from the standard website contract timeline.',
    groups: [
      { name: 'Discovery', color: '#8b8d98' },
      { name: 'Design', color: '#d6409f' },
      { name: 'Build', color: '#0090ff' },
      { name: 'Review', color: '#f5a524' },
      { name: 'Launch', color: '#30a46c' },
    ],
    tasks: [
      { group: 'Discovery', title: 'Kickoff and content audit', who: 'owner', priority: 'high', labels: ['Web'], start: 0, due: 1,
        subtasks: ['Kickoff call', 'List existing pages and content', 'Agree what gets migrated'] },
      { group: 'Discovery', title: 'Sitemap', who: 'owner', priority: 'high', labels: ['Web'], start: 1, due: 3,
        subtasks: ['Draft sitemap', 'Client sign-off on sitemap'] },
      { group: 'Discovery', title: 'Client to deliver content and assets', who: 'owner', priority: 'urgent', labels: ['Admin'], start: 0, due: 4,
        description: 'The timeline depends on receiving these on time (contract, section 4).',
        subtasks: ['Logo files', 'Photos', 'Page copy', 'Domain, DNS and hosting logins'] },

      { group: 'Design', title: 'Homepage design', who: 'designer', priority: 'high', labels: ['Web'], start: 7, due: 11,
        subtasks: ['Desktop layout', 'Mobile layout'] },
      { group: 'Design', title: 'Key interior page designs', who: 'designer', priority: 'medium', labels: ['Web'], start: 10, due: 16,
        subtasks: ['About', 'Services', 'Contact', 'Other pages from the sitemap', 'Mobile versions'] },
      { group: 'Design', title: 'Design sign-off', who: 'owner', priority: 'high', labels: ['Admin'], start: 17, due: 18,
        subtasks: ['Share designs', 'Collect feedback', 'Written approval from client'] },

      { group: 'Build', title: 'Full site build', who: 'owner', priority: 'high', labels: ['Web'], start: 21, due: 32,
        subtasks: ['Set up hosting/CMS', 'Build templates', 'Build all pages', 'Forms and integrations'] },
      { group: 'Build', title: 'Content migration', who: 'owner', priority: 'medium', labels: ['Web'], start: 28, due: 36,
        subtasks: ['Move page copy', 'Optimise and upload images', 'Set up redirects from old URLs'] },
      { group: 'Build', title: 'Mobile testing', who: 'designer', priority: 'high', labels: ['Web'], start: 35, due: 39,
        subtasks: ['iPhone', 'Android', 'Tablet', 'Fix layout issues'] },

      { group: 'Review', title: 'Client walkthrough', who: 'owner', priority: 'high', labels: ['Admin'], start: 42, due: 42,
        subtasks: ['Book the call', 'Walk through every page', 'Log revision requests'] },
      { group: 'Review', title: 'Revisions', who: 'designer', priority: 'high', labels: ['Web'], start: 43, due: 45, subtasks: [] },
      { group: 'Review', title: 'Final QA', who: 'owner', priority: 'high', labels: ['Web'], start: 45, due: 46,
        subtasks: ['Broken links', 'Forms send correctly', 'Page speed', 'Page titles and meta descriptions', 'Browser check'] },

      { group: 'Launch', title: 'Domain cutover and DNS', who: 'owner', priority: 'urgent', labels: ['Web'], start: 49, due: 50,
        subtasks: ['Lower DNS TTL beforehand', 'Point domain to new host', 'SSL certificate live', 'Email records still working'] },
      { group: 'Launch', title: 'Go-live support', who: 'owner', priority: 'high', labels: ['Admin'], start: 50, due: 51,
        subtasks: ['Live-site check', 'Client handover and logins', 'Confirm sign-off'] },
    ],
  },
};

/** YYYY-MM-DD `days` after the ISO date `start` (calendar days, timezone-safe). */
export function offsetDate(start, days) {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
