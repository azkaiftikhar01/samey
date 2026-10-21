export interface PhraseMatch {
  phrase: string;
  index: number;
}

/**
 * Stock marketing phrases that carry no product-specific information. Each entry is a
 * label plus a pattern so reports can name the phrase family rather than the regex.
 */
export const STOCK_PHRASES: [string, RegExp][] = [
  ['unlock the power/potential', /\bunlock(?:ing)? (?:the |your )?(?:full )?(?:power|potential)\b/i],
  ['supercharge', /\bsupercharg(?:e|es|ed|ing)\b/i],
  ['revolutionize', /\brevolutioni[sz](?:e|es|ing)\b/i],
  ['seamless', /\bseamless(?:ly)?\b/i],
  ['elevate your', /\belevate (?:your|the)\b/i],
  ['empower', /\bempower(?:s|ing)?\b/i],
  ['next-generation', /\bnext[- ]gen(?:eration)?\b/i],
  ['cutting-edge', /\bcutting[- ]edge\b/i],
  ['game-changing', /\bgame[- ]chang(?:er|ing)\b/i],
  ['all-in-one', /\ball[- ]in[- ]one\b/i],
  ['effortless', /\beffortless(?:ly)?\b/i],
  ['transform your', /\btransform (?:your|the way)\b/i],
  ['to the next level', /\bto the next level\b/i],
  ['built for the future', /\bbuilt for (?:the )?(?:future|modern)\b/i],
  ['harness the power', /\bharness(?:ing)? the power\b/i],
  ['streamline', /\bstreamlin(?:e|es|ed|ing)\b/i],
  ['world-class', /\bworld[- ]class\b/i],
  ['state-of-the-art', /\bstate[- ]of[- ]the[- ]art\b/i],
  ['lightning/blazing fast', /\b(?:lightning|blazing(?:ly)?)[- ]fast\b/i],
  ["in today's fast-paced world", /\bin today'?s (?:fast[- ]paced|digital|ever[- ]changing)\b/i],
  ["whether you're a", /\bwhether you'?re an? \w+/i],
  ['say goodbye to', /\bsay goodbye to\b/i],
  ['look no further', /\blook no further\b/i],
  ['boost your productivity', /\bboost (?:your )?productivity\b/i],
  ['unleash', /\bunleash(?:es|ing)?\b/i],
  ['reimagine', /\breimagin(?:e|ed|ing)\b/i],
  ['at your fingertips', /\bat your fingertips\b/i],
  ['ever-evolving', /\bever[- ]evolving\b/i],
  ['leverage', /\bleverag(?:e|es|ing)\b/i],
  ['innovative solutions', /\binnovative solutions?\b/i],
  ['the future of', /\bthe future of \w+/i],
  ['like never before', /\blike never before\b/i],
  ['made simple', /\bmade (?:simple|easy)\b/i],
  ['delve', /\bdelv(?:e|es|ing)\b/i],
  ['tapestry', /\btapestry\b/i],
];

export function findStockPhrases(text: string): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  for (const [label, re] of STOCK_PHRASES) {
    const m = re.exec(text);
    if (m) out.push({ phrase: label, index: m.index });
  }
  return out;
}

export const PLACEHOLDER_PATTERNS: [string, RegExp][] = [
  ['lorem ipsum', /\blorem ipsum\b|\bdolor sit amet\b/i],
  ['placeholder name', /\b(?:john|jane) (?:doe|smith)\b/i],
  ['placeholder company', /\b(?:acme(?: corp(?:oration)?| inc)?|your company|company name|your brand|brand name)\b/i],
  ['example domain', /\b[\w.-]*@?example\.(?:com|org|net)\b/i],
  ['placeholder text', /\[(?:insert|your|add|placeholder)[^\]]*\]|\{\{\s*\w+\s*\}\}|\bplaceholder text\b/i],
  ['TODO marker', /\b(?:TODO|FIXME|TBD)\b/],
  ['dummy contact', /\b(?:123[- ]456[- ]7890|\(555\) ?\d{3}-\d{4}|555-\d{4}|123 (?:main|fake) st(?:reet)?)\b/i],
];

export function findPlaceholders(text: string): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  for (const [label, re] of PLACEHOLDER_PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ phrase: label, index: m.index });
  }
  return out;
}

export const CLAIM_PATTERNS: [string, RegExp][] = [
  ['trusted by N', /\btrusted by (?:over |more than )?[\d,.]+\s*[kKmM]?\+?/],
  ['N+ users/customers', /\b[\d,.]+\s*[kKmM]?\+\s*(?:happy |satisfied |active )?(?:users|customers|developers|teams|companies|businesses|clients|creators)\b/i],
  ['percentage claim', /\b\d{2,3}(?:\.\d+)?%\s*(?:uptime|satisfaction|faster|more|increase|growth|accuracy|reduction|of (?:users|customers))\b/i],
  ['star rating', /★★★★★|\b(?:4\.\d|5(?:\.0)?)\s*\/\s*5\b|\b5[- ]star\b/i],
  ['N x faster', /\b\d+x (?:faster|more|better|quicker)\b/i],
];

export function findClaims(text: string): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  for (const [label, re] of CLAIM_PATTERNS) {
    const m = re.exec(text);
    if (m) out.push({ phrase: label, index: m.index });
  }
  return out;
}

/** Testimonial attribution like "Sarah Chen, CEO at Nimbus". */
export const ATTRIBUTION = /\b[A-Z][a-z]+ [A-Z][a-z]+\s*[,\-–—|]\s*(?:CEO|CTO|COO|CFO|Founder|Co-founder|Head of|VP|Director|Lead|Manager|Product Manager|Engineer|Designer)\b/;

const EMOJI = /\p{Extended_Pictographic}/u;
export function hasEmoji(text: string): boolean {
  return EMOJI.test(text);
}

export function firstEmoji(text: string): string | undefined {
  return text.match(/\p{Extended_Pictographic}️?/u)?.[0];
}

export const GENERIC_LINK_TEXT = /^(?:learn more|read more|click here|more|here|details|see more|find out more)$/i;

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max = 120): string {
  const t = normalizeText(text);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function snippetAround(text: string, index: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return (start > 0 ? '…' : '') + normalizeText(text.slice(start, end)) + (end < text.length ? '…' : '');
}
