// The morning list of new Upwork contracts: parsed from what Aram pastes, then split
// evenly into one task per RCM (one checklist line per poster).

export type ContractLine = { label: string; url: string };

const URL_RE = /https?:\/\/[^\s<>"']+/;
const safe = (u: string) => /^https?:\/\//i.test(u.trim());
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : all; }
  return ENTITIES[e.toLowerCase()] ?? all;
});

/** Reads links from pasted HTML (names with the link embedded) or from plain text lines. */
export function parseContracts(html: string, text: string): ContractLine[] {
  const out: ContractLine[] = [];
  if (html && /<a\s/i.test(html)) {
    const re = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const url = decode(m[1] ?? m[2] ?? '').trim();
      if (!safe(url)) continue;
      out.push({ label: clean(decode(m[3].replace(/<[^>]*>/g, ' '))) || url, url });
    }
  } else {
    for (const line of (text || '').split(/\r?\n/)) {
      const m = URL_RE.exec(line);
      if (!m) continue;
      const label = clean(line.replace(m[0], '').replace(/[\t|,;:–-]+$/, ''));
      out.push({ label: label || m[0], url: m[0] });
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).map((c) => ({ label: c.label.slice(0, 200), url: c.url.slice(0, 1000) }));
}

/** Splits a list in order into `n` parts whose sizes differ by at most one. */
export function splitEvenly<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const size = Math.floor(list.length / n) + (k < list.length % n ? 1 : 0);
    out.push(list.slice(i, i + size));
    i += size;
  }
  return out;
}
