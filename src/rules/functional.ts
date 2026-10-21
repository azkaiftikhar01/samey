import type { Evidence } from '../types.js';
import { truncate } from '../util/text.js';
import { axeRan } from './accessibility.js';
import { el, pagesWith, plural, uniqueRoutes } from './helpers.js';
import type { FindingInput, Rule } from './types.js';

export const pageLoadFailed: Rule = {
  id: 'page-load-failed',
  title: 'Page failed to load',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  penalty: 80,
  description: 'A page timed out or errored during navigation.',
  run({ crawl }) {
    return (crawl?.pages ?? [])
      .filter((p) => p.error && !p.desktop)
      .map<FindingInput>((p) => ({
        title: `Page failed to load: ${p.path}`,
        severity: 'critical',
        confidence: 0.9,
        description: `Navigating to ${p.url} failed: ${p.error}`,
        recommendation: 'Open the page locally and check the server log. If it is slow rather than broken, raise --timeout.',
        evidence: [{ type: 'network', route: p.path, detail: p.error }],
        routes: [p.path],
      }));
  },
};

export const brokenLinks: Rule = {
  id: 'broken-internal-links',
  title: 'Broken internal links',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  penalty: 50,
  description: 'Internal links that return an error status or fail to load.',
  run({ crawl }) {
    const links = (crawl?.brokenLinks ?? []).filter((l) => l.from !== '(route hint)');
    if (!links.length) return [];
    const ev: Evidence[] = links.map((l) => ({
      type: 'network',
      route: l.from.startsWith('/') ? l.from : undefined,
      excerpt: l.url,
      detail: l.status ? `HTTP ${l.status}` : (l.error ?? 'request failed'),
    }));
    return [
      {
        severity: 'high',
        confidence: 0.9,
        description: `${plural(links.length, 'internal link')} lead to pages that do not load.`,
        recommendation: 'Fix the target route or update the link. Remove navigation entries for pages that do not exist yet.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const consoleErrors: Rule = {
  id: 'console-errors',
  title: 'JavaScript errors in the console',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  penalty: 45,
  description: 'Uncaught exceptions and console.error output during page load.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const p of crawl?.pages ?? []) for (const e of p.consoleErrors.slice(0, 5)) ev.push({ type: 'console', route: p.path, excerpt: truncate(e, 220) });
    if (!ev.length) return [];
    const uncaught = ev.filter((e) => e.excerpt?.startsWith('Uncaught')).length;
    return [
      {
        severity: uncaught ? 'high' : 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'console error')} on ${plural(uniqueRoutes(ev).length, 'page')}${uncaught ? `, including ${uncaught} uncaught exception${uncaught === 1 ? '' : 's'}` : ''}.`,
        recommendation: 'Open the browser console on each listed page and fix the errors; uncaught exceptions often mean a feature silently does not work.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const failedRequests: Rule = {
  id: 'failed-requests',
  title: 'Failed asset requests',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  description: 'Scripts, styles, images, or API calls that returned errors or failed.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    let critical = 0;
    for (const p of crawl?.pages ?? []) {
      for (const r of p.failedRequests) {
        if (r.resourceType === 'document' && r.url.replace(/\/$/, '') === p.url.replace(/\/$/, '')) continue; // reported as a broken page
        if (/favicon\.ico$/.test(r.url)) continue;
        if (['script', 'stylesheet', 'document'].includes(r.resourceType)) critical++;
        ev.push({ type: 'network', route: p.path, excerpt: truncate(r.url, 140), detail: `${r.resourceType}: ${r.status ? `HTTP ${r.status}` : r.failure}` });
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: critical ? 'high' : 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'request')} failed while loading pages${critical ? `, ${critical} of them scripts, styles, or documents` : ''}.`,
        recommendation: 'Fix the asset paths or remove references to files that do not exist.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const deadLinks: Rule = {
  id: 'placeholder-links',
  title: 'Links that go nowhere',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  description: 'Links with href="#", an empty href, or javascript: URLs.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) {
      for (const l of facts.links) {
        const h = l.href.trim();
        if (h === '#' || h === '' || /^javascript:(?:void\(0\);?|;)?$/i.test(h)) ev.push(el(page, 'desktop', l, l.text || '(no text)', `href="${h}"`));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 5 ? 'high' : 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'link')} point to "#" or nowhere. These look clickable and do nothing, which is common in generated navigation and footers.`,
        recommendation: 'Point each link at a real page, turn it into a button if it triggers an action, or remove it.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const unresponsiveButtons: Rule = {
  id: 'unresponsive-buttons',
  version: 2,
  title: 'Buttons that do nothing',
  category: 'functional',
  needs: 'rendered',
  verified: false,
  description: 'Safe-to-click buttons that produced no navigation, DOM change, or error when clicked.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    const errors: Evidence[] = [];
    for (const p of crawl?.pages ?? []) {
      for (const i of p.interactions) {
        if (i.outcome === 'no-effect') ev.push({ type: 'dom', route: p.path, viewport: 'desktop', selector: i.selector, rect: i.rect, excerpt: i.text });
        if (i.outcome === 'error') errors.push({ type: 'dom', route: p.path, viewport: 'desktop', selector: i.selector, rect: i.rect, excerpt: i.text, detail: i.detail });
      }
    }
    const out: FindingInput[] = [];
    if (ev.length)
      out.push({
        severity: 'medium',
        confidence: 0.6,
        description: `${plural(ev.length, 'button')} produced no visible change when clicked (no navigation, no DOM update). Hover-only or CSS-only effects can cause false positives, so confirm by hand.`,
        recommendation: 'Wire the button to its action, or remove it. If it is a placeholder for a future feature, hide it until the feature exists.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      });
    if (errors.length)
      out.push({
        title: 'Buttons that throw errors',
        severity: 'high',
        confidence: 0.9,
        description: `${plural(errors.length, 'button')} threw a JavaScript error when clicked.`,
        recommendation: 'Fix the click handler; the error message is shown with each item.',
        evidence: errors,
        routes: uniqueRoutes(errors),
      });
    return out;
  },
};

export const emptyControls: Rule = {
  id: 'empty-controls',
  version: 2,
  title: 'Buttons and links without an accessible name',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'Interactive elements with no text, aria-label, or title.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop').filter(({ page }) => !axeRan(page, 'desktop'))) {
      for (const c of facts.controls) if (!c.name.trim()) ev.push(el(page, 'desktop', c, `<${c.tag}>`));
      for (const l of facts.links) if (!l.text.trim() && !facts.controls.some((c) => c.selector === l.selector)) ev.push(el(page, 'desktop', l, `<a href="${truncate(l.href, 60)}">`));
    }
    if (!ev.length) return [];
    return [
      {
        severity: 'high',
        confidence: 0.9,
        description: `${plural(ev.length, 'interactive element')} have no accessible name. Screen readers announce them as just "button" or "link". Icon-only buttons are the usual cause.`,
        recommendation: 'Add an aria-label to icon-only buttons and links, or include visually hidden text.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const brokenImages: Rule = {
  id: 'broken-images',
  title: 'Broken images',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  description: 'Images that failed to load.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop')) for (const i of facts.images) if (i.broken) ev.push(el(page, 'desktop', i, truncate(i.src, 120)));
    if (!ev.length) return [];
    return [
      {
        severity: 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'image')} failed to load.`,
        recommendation: 'Fix the image paths or remove the images.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const missingAlt: Rule = {
  id: 'missing-alt',
  version: 2,
  title: 'Images without alt text',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'Images with no alt attribute.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop').filter(({ page }) => !axeRan(page, 'desktop'))) for (const i of facts.images) if (i.alt === null && !i.decorative) ev.push(el(page, 'desktop', i, truncate(i.src, 120)));
    if (!ev.length) return [];
    return [
      {
        severity: 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'image')} have no alt attribute.`,
        recommendation: 'Describe informative images in alt text; use alt="" for purely decorative ones.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const unlabeledInputs: Rule = {
  id: 'unlabeled-inputs',
  version: 2,
  title: 'Form fields without labels',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'Inputs with no associated label or aria-label. Placeholders are not labels.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop').filter(({ page }) => !axeRan(page, 'desktop'))) for (const i of facts.unlabeledInputs) ev.push(el(page, 'desktop', i, `<${i.type}>`));
    if (!ev.length) return [];
    return [
      {
        severity: 'medium',
        confidence: 0.9,
        description: `${plural(ev.length, 'form field')} have no label. Placeholder text disappears on input and is not announced reliably.`,
        recommendation: 'Add a visible <label for=...> to each field, or aria-label where a visible label truly does not fit.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const headingStructure: Rule = {
  id: 'heading-structure',
  version: 2,
  title: 'Heading structure problems',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'Pages with no h1, several h1s, or skipped heading levels.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'desktop').filter(({ page }) => !axeRan(page, 'desktop'))) {
      const h1 = facts.headings.filter((h) => h.level === 1);
      if (h1.length === 0) ev.push({ type: 'metric', route: page.path, detail: 'no h1' });
      if (h1.length > 1) ev.push({ type: 'metric', route: page.path, detail: `${h1.length} h1 elements` });
      let prev = 0;
      for (const h of facts.headings) {
        if (prev && h.level > prev + 1) {
          ev.push(el(page, 'desktop', h, truncate(h.text, 60), `h${prev} followed by h${h.level}`));
          break;
        }
        prev = h.level;
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: 'low',
        confidence: 0.9,
        description: `${plural(uniqueRoutes(ev).length, 'page')} have heading structure problems. Headings are how assistive technology users skim a page.`,
        recommendation: 'Use exactly one h1 per page and do not skip levels; style headings with CSS instead of picking tags for their size.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const horizontalOverflow: Rule = {
  id: 'horizontal-overflow',
  title: 'Horizontal scrolling on mobile',
  category: 'functional',
  needs: 'rendered',
  verified: true,
  description: 'Content wider than the viewport, which causes sideways scrolling.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const vp of ['mobile', 'desktop'] as const) {
      for (const { page, facts } of pagesWith(crawl, vp)) {
        if (facts.scrollWidth <= facts.width + 1) continue;
        const offenders = facts.overflowing.slice(0, 3);
        if (!offenders.length) ev.push({ type: 'metric', route: page.path, viewport: vp, detail: `page is ${facts.scrollWidth}px wide in a ${facts.width}px viewport` });
        for (const o of offenders) ev.push(el(page, vp, o, undefined, `extends to ${o.right}px in a ${facts.width}px viewport`));
      }
    }
    if (!ev.length) return [];
    const mobile = ev.filter((e) => e.viewport === 'mobile');
    return [
      {
        severity: 'high',
        confidence: 0.9,
        description: `${plural(uniqueRoutes(ev).length, 'page')} scroll sideways${mobile.length ? ' on mobile' : ''}. Elements are wider than the screen.`,
        recommendation: 'Find the listed elements and constrain them: max-width: 100%, flex-wrap, min-width: 0 on flex children, or overflow-x: auto on wide tables and code blocks.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const smallTargets: Rule = {
  id: 'small-touch-targets',
  version: 2,
  title: 'Touch targets too small',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  description: 'Buttons and links smaller than 24x24 CSS pixels on mobile.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'mobile').filter(({ page }) => !axeRan(page, 'mobile'))) for (const t of facts.smallTargets) ev.push(el(page, 'mobile', t, t.text || undefined, `${t.w}x${t.h}px`));
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 6 ? 'medium' : 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'control')} are smaller than 24x24px on mobile (WCAG 2.5.8 minimum).`,
        recommendation: 'Increase padding on small controls so the tappable area is at least 24px, ideally 44px.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const tinyText: Rule = {
  id: 'tiny-text',
  title: 'Text too small to read on mobile',
  category: 'accessibility',
  needs: 'rendered',
  verified: true,
  penalty: 25,
  description: 'Text set below 12px on mobile.',
  run({ crawl }) {
    const ev: Evidence[] = [];
    for (const { page, facts } of pagesWith(crawl, 'mobile')) for (const t of facts.tinyText) ev.push(el(page, 'mobile', t, truncate(t.text, 60), `${t.size}px`));
    if (ev.length < 3) return [];
    return [
      {
        severity: 'low',
        confidence: 0.9,
        description: `${plural(ev.length, 'text element')} are smaller than 12px on mobile.`,
        recommendation: 'Keep body text at 16px and secondary text at 13 to 14px or larger on small screens.',
        evidence: ev,
        routes: uniqueRoutes(ev),
      },
    ];
  },
};

export const functionalRules: Rule[] = [
  pageLoadFailed, brokenLinks, consoleErrors, failedRequests, deadLinks, unresponsiveButtons, emptyControls, brokenImages,
  missingAlt, unlabeledInputs, headingStructure, horizontalOverflow, smallTargets, tinyText,
];
