import type { Evidence, SectionFact } from '../types.js';
import { extractColors, isSaturated, isStockGradient } from '../util/color.js';
import { firstEmoji, hasEmoji, truncate } from '../util/text.js';
import { el, inChrome, pagesWith, plural, topEntries, uniqueRoutes } from './helpers.js';
import type { FindingInput, Rule } from './types.js';

export const stockGradient: Rule = {
  id: 'stock-gradient',
  title: 'Stock blue-violet-pink gradients',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Saturated gradients drawn from the indigo/violet/fuchsia/pink band, the default look of generated landing pages.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let textCount = 0;
    let large = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const g of facts.gradients) {
        if (g.area < 400 || !isStockGradient(g.value)) continue;
        if (g.isText) textCount++;
        if (g.area >= facts.width * facts.height * 0.25) large++;
        ev.push(el(page, 'desktop', g, truncate(g.value, 140), g.isText ? 'gradient text' : g.area >= facts.width * facts.height * 0.25 ? 'large background' : 'background'));
      }
    }
    if (!ev.length) return [];
    // One modest gradient is a legitimate choice; it only reads as stock when it dominates or repeats.
    const severity = textCount > 0 || large > 0 || ev.length >= 4 ? 'medium' : ev.length >= 2 ? 'low' : 'info';
    const parts = [plural(ev.length, 'element')];
    if (textCount) parts.push(`${textCount} as gradient text`);
    if (large) parts.push(`${large} covering a large area`);
    return [
      {
        severity,
        confidence: 0.9,
        description: `Found the blue-violet-pink gradient on ${parts.join(', ')}. It is the most recognizable default of AI-generated UIs and makes the site read as a template.`,
        recommendation:
          'Pick a palette from the brand rather than the framework default: one primary hue used with intent, gradients only where they carry meaning. Replace gradient headline text with solid color and weight contrast.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const glowEffects: Rule = {
  id: 'glow-effects',
  title: 'Decorative glows, blur blobs, and glass panels',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Colored large-blur shadows, blurred background orbs, and backdrop-blur glass panels used as decoration.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const counts = { shadow: 0, 'blur-blob': 0, backdrop: 0 };
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const g of facts.glows) {
        if (g.kind === 'shadow' && !extractColors(g.value).some((c) => isSaturated(c) && c.a >= 0.15)) continue;
        // A sticky nav with backdrop blur is a common, legitimate pattern; only count non-chrome panels.
        if (g.kind === 'backdrop' && inChrome(facts, g)) continue;
        counts[g.kind]++;
        ev.push(el(page, 'desktop', g, truncate(g.value, 140), g.kind === 'shadow' ? 'colored glow shadow' : g.kind === 'blur-blob' ? 'blurred decorative blob' : 'glass panel'));
      }
    }
    const total = counts.shadow + counts['blur-blob'] + counts.backdrop;
    if (total < 3) return [];
    const parts: string[] = [];
    if (counts.shadow) parts.push(plural(counts.shadow, 'colored glow shadow'));
    if (counts['blur-blob']) parts.push(plural(counts['blur-blob'], 'blurred background blob'));
    if (counts.backdrop) parts.push(plural(counts.backdrop, 'glass panel'));
    return [
      {
        severity: total >= 8 ? 'medium' : 'low',
        confidence: 0.9,
        description: `Found ${parts.join(', ')}. Layered glows and glass are decoration the content does not ask for, and they flatten hierarchy because everything shines equally.`,
        recommendation: 'Remove decorative blobs and glow shadows. Use elevation sparingly and with neutral shadows; keep at most one deliberate accent effect per page.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

function contentSections(sections: SectionFact[]): SectionFact[] {
  return sections.filter((s) => !s.isChrome);
}

export const cardGridSameness: Rule = {
  id: 'card-grid-sameness',
  version: 2,
  title: 'The same card grid, over and over',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Sections built from the same repeated card composition across the site.',
  run({ crawl }) {
    const bySig = new Map<string, Evidence[]>();
    let cardSections = 0;
    let total = 0;
    const cardEvidence: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const s of contentSections(facts.sections)) {
        total++;
        if (s.cardCount >= 3 && s.cardSignature) {
          cardSections++;
          cardEvidence.push(el(page, 'desktop', s, s.heading ? truncate(s.heading, 80) : undefined, `${s.cardCount} cards`));
          const key = `${s.cardSignature}|${s.columns}`;
          if (!bySig.has(key)) bySig.set(key, []);
          bySig.get(key)!.push(el(page, 'desktop', s, s.heading ? truncate(s.heading, 80) : undefined, `${s.cardCount} cards in ${s.columns} columns`));
        }
      }
    }
    const out: FindingInput[] = [];
    for (const [, ev] of [...bySig].sort((a, b) => b[1].length - a[1].length)) {
      if (ev.length < 3) break;
      out.push({
        severity: ev.length >= 5 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${plural(ev.length, 'section')} use an identical card layout (same structure and column count). Repeating one composition makes every section feel like the previous one.`,
        recommendation:
          'Vary the form to fit the content: a comparison table for plans, a single large example for the main feature, a list for secondary points. Keep cards for content that is genuinely a set of peers.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      });
      if (out.length >= 2) break;
    }
    if (total >= 5 && cardSections / total >= 0.5 && !out.length) {
      out.push({
        title: 'Most sections are card grids',
        severity: 'low',
        confidence: 0.6,
        description: `${cardSections} of ${total} content sections are grids of three or more cards.`,
        recommendation: 'Break the rhythm with sections that use prose, a single image, a table, or a list where the content fits that better.',
        evidence: cardEvidence,
        routes: uniqueRoutes(cardEvidence),
      });
    }
    return out;
  },
};

export const repeatedRhythm: Rule = {
  id: 'repeated-section-rhythm',
  title: 'Consecutive sections with the same layout',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Three or more adjacent sections with an identical layout fingerprint.',
  run({ crawl }) {
    const out: FindingInput[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const secs = contentSections(facts.sections);
      let runStart = 0;
      for (let i = 1; i <= secs.length; i++) {
        if (i < secs.length && secs[i].signature === secs[runStart].signature) continue;
        const len = i - runStart;
        const run = secs.slice(runStart, i);
        // Plain prose sections following each other is normal reading flow, not a repeated composition.
        if (len >= 3 && (run[0].cardCount >= 3 || run[0].columns > 1)) {
          out.push({
            severity: 'low',
            confidence: 0.6,
            description: `${len} consecutive sections on ${page.path} share the same layout (heading, ${run[0].columns} column${run[0].columns === 1 ? '' : 's'}, ${run[0].cardCount ? run[0].cardCount + ' cards' : 'no cards'}). The page reads as a stack of interchangeable blocks.`,
            recommendation: 'Give each section a layout that matches its job, and let the most important one take more space.',
            evidence: run.map((s) => el(page, 'desktop', s, s.heading ? truncate(s.heading, 80) : undefined)),
            routes: [page.path],
          });
        }
        runStart = i;
      }
    }
    return out.slice(0, 3);
  },
};

function jaccard(a: string[], b: string[]): number {
  const A = new Map<string, number>();
  const B = new Map<string, number>();
  for (const x of a) A.set(x, (A.get(x) ?? 0) + 1);
  for (const x of b) B.set(x, (B.get(x) ?? 0) + 1);
  let inter = 0;
  let union = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    inter += Math.min(A.get(k) ?? 0, B.get(k) ?? 0);
    union += Math.max(A.get(k) ?? 0, B.get(k) ?? 0);
  }
  return union ? inter / union : 0;
}

export const crossPageTemplate: Rule = {
  id: 'cross-page-template',
  title: 'Different pages, same template',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Pages with different purposes that share most of their section structure.',
  run({ crawl }) {
    // Pages under the same parent (/blog/a, /blog/b) are expected to share a template; compare one per group.
    const groups = new Map<string, { path: string; sigs: string[]; ev: Evidence }>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      const segs = page.path.split('/').filter(Boolean);
      const group = segs.length > 1 ? segs[0] : page.path;
      if (groups.has(group)) continue;
      const sigs = contentSections(facts.sections).map((s) => s.signature);
      if (sigs.length < 3) continue;
      groups.set(group, { path: page.path, sigs, ev: { type: 'metric', route: page.path, viewport: 'desktop', detail: `${sigs.length} content sections` } });
    }
    const list = [...groups.values()];
    if (list.length < 3) return [];
    const pairs: { a: string; b: string; sim: number }[] = [];
    let sum = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const sim = jaccard(list[i].sigs, list[j].sigs);
        pairs.push({ a: list[i].path, b: list[j].path, sim });
        sum += sim;
      }
    const avg = sum / pairs.length;
    if (avg < 0.5) return [];
    const top = pairs.sort((x, y) => y.sim - x.sim).slice(0, 5);
    return [
      {
        severity: avg >= 0.7 ? 'medium' : 'low',
        confidence: 0.6,
        description: `Across ${list.length} distinct page types, ${Math.round(avg * 100)}% of section structure is shared on average. Pages with different purposes are built from the same blocks in a similar order.`,
        recommendation: 'Design each page around its own task: an about page tells a story, a pricing page compares, a docs page navigates. Reuse components, not whole page skeletons.',
        evidence: top.map((p) => ({ type: 'metric' as const, detail: `${p.a} vs ${p.b}: ${Math.round(p.sim * 100)}% shared structure`, route: p.a })),
        routes: list.map((l) => l.path),
      },
    ];
  },
};

type Kind = 'hero' | 'logos' | 'features' | 'testimonials' | 'pricing' | 'faq' | 'cta';

export function classifySection(s: SectionFact, index: number, total: number): Kind | undefined {
  const h = (s.heading ?? '').toLowerCase();
  const t = s.text.toLowerCase();
  if (index === 0 && s.buttonCount >= 1 && s.heading) return 'hero';
  if (s.hasPrice || /\bpricing\b|\bplans?\b/.test(h)) return 'pricing';
  if (s.hasDetails || /\bfaq\b|frequently asked|questions/.test(h)) return 'faq';
  if (s.hasBlockquote || /testimonial|what (?:our|people|customers)|loved by|wall of love|customers say/.test(h)) return 'testimonials';
  if (/trusted by|used by|backed by|as seen|logos?\b/.test(h || t.slice(0, 80)) || (s.imageCount >= 4 && s.text.length < 160)) return 'logos';
  if (s.cardCount >= 3 && /feature|why|how it works|everything you need|benefits|what you get/.test(h)) return 'features';
  if (s.cardCount >= 3 && index <= 3) return 'features';
  if (index >= total - 2 && s.buttonCount >= 1 && s.text.length < 400) return 'cta';
  return undefined;
}

const CANON: Kind[] = ['hero', 'logos', 'features', 'testimonials', 'pricing', 'faq', 'cta'];

export const stockLandingSequence: Rule = {
  id: 'stock-landing-sequence',
  title: 'Stock SaaS landing page sequence',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  penalty: 25,
  description: 'Home page follows hero, logos, features, testimonials, pricing, FAQ, CTA in that order.',
  run({ crawl }) {
    const first = pagesWith(crawl, 'desktop')[0];
    if (!first) return [];
    const secs = contentSections(first.facts.sections);
    const kinds = secs.map((s, i) => ({ s, k: classifySection(s, i, secs.length) })).filter((x) => x.k);
    // Longest subsequence of the canonical order present on the page.
    const seq: typeof kinds = [];
    let ci = 0;
    for (const x of kinds) {
      const idx = CANON.indexOf(x.k!, ci);
      if (idx >= 0) {
        seq.push(x);
        ci = idx + 1;
      }
    }
    if (seq.length < 5) return [];
    return [
      {
        severity: 'low',
        confidence: 0.6,
        description: `The home page follows the stock sequence: ${seq.map((x) => x.k).join(' → ')}. Using familiar sections is fine on its own; combined with stock visuals it makes the page interchangeable with thousands of others.`,
        recommendation: 'Lead with what is specific: a real product screenshot or demo, a concrete use case, or an opinion. Cut sections that exist only because the template has them.',
        evidence: seq.map((x) => el(first.page, 'desktop', x.s, `${x.k}: ${truncate(x.s.heading ?? '', 70)}`)),
        routes: [first.page.path],
      },
    ];
  },
};

export const centeredEverything: Rule = {
  id: 'centered-everything',
  title: 'Everything is centered',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  penalty: 25,
  description: 'Nearly every section uses a centered heading stack.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let total = 0;
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const s of contentSections(facts.sections)) {
        if (!s.heading) continue;
        total++;
        if (s.centered) ev.push(el(page, 'desktop', s, truncate(s.heading, 80)));
      }
    }
    if (total < 5 || ev.length / total < 0.85) return [];
    return [
      {
        severity: 'low',
        confidence: 0.6,
        description: `${ev.length} of ${total} section headings are centered. Symmetric, centered stacks everywhere remove the reading line and make hierarchy depend only on size.`,
        recommendation: 'Left-align long-form and feature content; reserve centering for one or two moments such as the hero or a closing call to action.',
        evidence: ev.slice(0, 8),
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const emojiIcons: Rule = {
  id: 'emoji-icons',
  version: 2,
  title: 'Emoji used as icons',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Emoji standing in for icons in headings, buttons, and feature cards.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const seen = new Set<string>();
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const b of facts.textBlocks) {
        if (b.text.length > 120 || !hasEmoji(b.text)) continue;
        if (!/^h[1-6]$|^button$|^li$|^a$|^span$|^div$|^p$|^dt$/.test(b.tag)) continue;
        const key = page.path + b.selector;
        if (seen.has(key)) continue;
        seen.add(key);
        ev.push(el(page, 'desktop', b, truncate(b.text, 80), `emoji ${firstEmoji(b.text)}`));
      }
    }
    if (ev.length < 2) return [];
    return [
      {
        severity: ev.length >= 5 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'heading, button, or label')} use emoji as decoration or icons. Emoji render differently on every platform, cannot be styled to the brand, and are a strong signal of generated UI.`,
        recommendation: 'Replace emoji with a consistent SVG icon set (one stroke width, one size scale) or drop the icon entirely where the label is clear.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

const px = (v: string) => parseFloat(v);

export const tokenSprawl: Rule = {
  id: 'token-sprawl',
  version: 2,
  title: 'Inconsistent design tokens',
  category: 'visual',
  needs: 'rendered',
  verified: false,
  description: 'Too many distinct font sizes, radii, shadows, or spacing values off a consistent scale.',
  run({ crawl }) {
    const agg = { fontSizes: {} as Record<string, number>, radii: {} as Record<string, number>, shadows: {} as Record<string, number>, spacing: {} as Record<string, number>, fontFamilies: {} as Record<string, number> };
    const pages = pagesWith(crawl, 'desktop');
    if (!pages.length) return [];
    for (const { facts } of pages) {
      for (const k of Object.keys(agg) as (keyof typeof agg)[]) {
        for (const [v, n] of Object.entries(facts.styles[k])) agg[k][v] = (agg[k][v] ?? 0) + n;
      }
    }
    const out: FindingInput[] = [];
    const metric = (detail: string) => ({ type: 'metric' as const, detail });

    // Group sizes into type-scale steps: values within 8% of a step's first size (fluid clamp() output like
    // 13px and 13.5px) are one step. Sizes used by a single element are ignored as one-offs.
    const sizes = Object.keys(agg.fontSizes).filter((v) => agg.fontSizes[v] > 1).sort((a, b) => px(a) - px(b));
    const steps: string[][] = [];
    for (const v of sizes) {
      const last = steps[steps.length - 1];
      if (last && px(v) <= px(last[0]) * 1.08) last.push(v);
      else steps.push([v]);
    }
    if (steps.length > 10) {
      out.push({
        title: `${steps.length} different text sizes`,
        severity: steps.length > 14 ? 'medium' : 'low',
        confidence: 0.6,
        description: `Text uses ${steps.length} distinct size steps (${steps.map((g) => g.join('/')).join(', ')}). A type scale usually needs 6 to 8 steps; more than that blurs hierarchy.`,
        recommendation: 'Define a type scale as tokens and map every text style to it. Collapse sizes within 1 to 2px of each other.',
        evidence: topEntries(agg.fontSizes, 12).map(([v, n]) => metric(`${v} used by ${n} elements`)),
      });
    }
    const radii = Object.keys(agg.radii).filter((r) => px(r) < 9999 && px(r) > 0);
    if (radii.length > 6) {
      out.push({
        title: `${radii.length} different corner radii`,
        severity: 'low',
        confidence: 0.6,
        description: `Elements use ${radii.length} distinct border radii (${radii.sort((a, b) => px(a) - px(b)).join(', ')}).`,
        recommendation: 'Use two or three radius tokens (for example small controls, cards, and full pills) and apply them by component type.',
        evidence: topEntries(agg.radii, 10).map(([v, n]) => metric(`${v} on ${n} elements`)),
      });
    }
    const shadows = Object.keys(agg.shadows);
    if (shadows.length > 6) {
      out.push({
        title: `${shadows.length} different shadows`,
        severity: 'low',
        confidence: 0.6,
        description: `There are ${shadows.length} distinct box-shadow values. Elevation without a system makes depth meaningless.`,
        recommendation: 'Define two or three elevation levels and use them consistently.',
        evidence: topEntries(agg.shadows, 6).map(([v, n]) => metric(`${truncate(v, 90)} on ${n} elements`)),
      });
    }
    let onGrid = 0;
    let offGrid = 0;
    const offValues: Record<string, number> = {};
    // A value is on-scale if it sits on a 4px grid or on quarter-rem steps of the page's own root size.
    const rem = pages[0].facts.rootFontSize || 16;
    const onStep = (p: number, unit: number) => Math.abs(p / unit - Math.round(p / unit)) < 0.02;
    for (const [v, n] of Object.entries(agg.spacing)) {
      const p = px(v);
      if (p <= 2) continue;
      if (onStep(p, 4) || onStep(p, rem / 4)) onGrid += n;
      else {
        offGrid += n;
        offValues[v] = n;
      }
    }
    // A rem- or em-based system can sit off a 4px grid and still be consistent, so require many distinct
    // values in regular use (3+ elements each) before calling the spacing unsystematic.
    const distinctUsed = Object.entries(agg.spacing).filter(([v, n]) => px(v) > 2 && n >= 3).length;
    if (onGrid + offGrid >= 30 && offGrid / (onGrid + offGrid) > 0.3 && distinctUsed > 12) {
      out.push({
        title: 'Spacing off a consistent scale',
        severity: 'low',
        confidence: 0.35,
        description: `Padding, margin, and gap use ${distinctUsed} distinct values, and ${Math.round((offGrid / (onGrid + offGrid)) * 100)}% are neither multiples of 4px nor quarter steps of the ${rem}px root size.`,
        recommendation: 'Adopt a spacing scale (4px or 8px based) and replace one-off values with tokens.',
        evidence: topEntries(offValues, 8).map(([v, n]) => metric(`${v} used ${n} times`)),
      });
    }
    const families = Object.keys(agg.fontFamilies);
    if (families.length > 3) {
      out.push({
        title: `${families.length} font families`,
        severity: 'low',
        confidence: 0.6,
        description: `Text is set in ${families.length} font families: ${families.join(', ')}.`,
        recommendation: 'Use one family for text and at most one for display or code.',
        evidence: topEntries(agg.fontFamilies, 6).map(([v, n]) => metric(`${v}: ${n} elements`)),
      });
    }
    return out;
  },
};

export const visualRules: Rule[] = [stockGradient, glowEffects, cardGridSameness, repeatedRhythm, crossPageTemplate, stockLandingSequence, centeredEverything, emojiIcons, tokenSprawl];
