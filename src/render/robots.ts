/** Minimal robots.txt support: Disallow/Allow rules for `User-agent: *` (or our own agent). */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(txt: string, agent = 'unslop'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow' && value) current.disallow.push(value);
    if (key === 'allow' && value) current.allow.push(value);
  }
  const own = groups.find((g) => g.agents.includes(agent.toLowerCase()));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = own ?? star;
  return { allow: g?.allow ?? [], disallow: g?.disallow ?? [] };
}

function matches(rule: string, path: string): number {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path) ? body.length : -1;
}

/** Longest matching rule wins; Allow wins ties, per RFC 9309. */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const len = matches(r, path);
    if (len > best) {
      best = len;
      allowed = false;
    }
  }
  for (const r of rules.allow) {
    const len = matches(r, path);
    if (len >= best && len >= 0) {
      best = len;
      allowed = true;
    }
  }
  return allowed;
}
