import type { Page } from 'playwright';
import type { ViewportFacts, ViewportName } from '../types.js';

/**
 * Runs `fn` inside the page. The function is shipped as source text so that bundler
 * helpers (esbuild's `__name`, used by tsx and vitest) never leak into the browser.
 */
export async function runInPage<A, R>(page: Page, fn: (arg: A) => R, arg: A): Promise<R> {
  const src = `(() => { var __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg)}); })()`;
  return page.evaluate(src) as Promise<R>;
}

export async function extractViewportFacts(page: Page, viewport: ViewportName): Promise<ViewportFacts> {
  return runInPage(page, extractInPage, { viewport }) as Promise<ViewportFacts>;
}

// Everything below executes in the browser. It must not reference anything outside its own body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractInPage(opts: { viewport: ViewportName }): any {
  // Mobile emulation zooms out to fit overflowing content, which inflates innerWidth; clientWidth stays at the device width.
  const W = document.documentElement.clientWidth || window.innerWidth;
  const H = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const MAX_ELEMENTS = 8000;

  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + sx), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) };
  };

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const css = (el: Element) => {
    let s = styleCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = css(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
    return true;
  };

  const cssPath = (el: Element): string => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
        parts.unshift(`#${cur.id}`);
        break;
      }
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };

  const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const ownText = (el: Element) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const bump = (rec: Record<string, number>, key: string) => {
    rec[key] = (rec[key] || 0) + 1;
  };

  const accessibleName = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    const t = textOf(el);
    if (t) return t;
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt')!.trim()) return img.getAttribute('alt')!.trim();
    const svgTitle = el.querySelector('svg title');
    if (svgTitle && svgTitle.textContent!.trim()) return svgTitle.textContent!.trim();
    if (el instanceof HTMLInputElement && el.value) return el.value;
    return '';
  };

  const styles = {
    colors: {} as Record<string, number>,
    backgrounds: {} as Record<string, number>,
    fontSizes: {} as Record<string, number>,
    fontFamilies: {} as Record<string, number>,
    radii: {} as Record<string, number>,
    shadows: {} as Record<string, number>,
    spacing: {} as Record<string, number>,
  };
  const gradients: any[] = [];
  const glows: any[] = [];
  const tinyText: any[] = [];

  const all = Array.from(document.body.querySelectorAll('*')).slice(0, MAX_ELEMENTS);
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;
    if (el.closest('svg') && tag !== 'svg') continue;
    if (!visible(el)) continue;
    const s = css(el);
    const own = ownText(el);
    if (own.length > 0) {
      bump(styles.colors, s.color);
      bump(styles.fontSizes, s.fontSize);
      bump(styles.fontFamilies, s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      const fs = parseFloat(s.fontSize);
      if (fs < 12 && own.length > 3 && tinyText.length < 20) {
        tinyText.push({ selector: cssPath(el), rect: rectOf(el), text: own.slice(0, 80), size: fs });
      }
    }
    if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
      bump(styles.backgrounds, s.backgroundColor);
    }
    if (s.borderTopLeftRadius && s.borderTopLeftRadius !== '0px') bump(styles.radii, s.borderTopLeftRadius);
    if (s.boxShadow && s.boxShadow !== 'none') {
      bump(styles.shadows, s.boxShadow);
      // Large-blur shadows are glow candidates; saturation is judged on the Node side.
      const blurs = Array.from(s.boxShadow.matchAll(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px/g)).map((m) => parseFloat(m[3]));
      if (blurs.some((b) => b >= 24) && glows.length < 60) {
        glows.push({ selector: cssPath(el), rect: rectOf(el), value: s.boxShadow, kind: 'shadow' });
      }
    }
    for (const prop of ['paddingTop', 'paddingLeft', 'marginTop', 'rowGap'] as const) {
      const v = (s as any)[prop] as string;
      if (v && v !== '0px' && v !== 'normal' && v.endsWith('px')) bump(styles.spacing, v);
    }
    const bgImage = s.backgroundImage;
    if (bgImage && bgImage.includes('gradient(') && gradients.length < 80) {
      const r = rectOf(el);
      const clip = s.backgroundClip || (s as any).webkitBackgroundClip || '';
      gradients.push({ selector: cssPath(el), rect: r, value: bgImage, area: r.width * r.height, isText: clip === 'text' });
    }
    const filter = s.filter || '';
    const blurMatch = filter.match(/blur\((\d+(?:\.\d+)?)px\)/);
    if (blurMatch && parseFloat(blurMatch[1]) >= 30 && glows.length < 60) {
      glows.push({ selector: cssPath(el), rect: rectOf(el), value: `filter: ${filter}; background: ${s.backgroundImage !== 'none' ? s.backgroundImage : s.backgroundColor}`, kind: 'blur-blob' });
    }
    const backdrop = s.backdropFilter || (s as any).webkitBackdropFilter || '';
    if (backdrop.includes('blur(') && glows.length < 60) {
      glows.push({ selector: cssPath(el), rect: rectOf(el), value: `backdrop-filter: ${backdrop}`, kind: 'backdrop' });
    }
  }

  // Headings
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .filter(visible)
    .map((el) => ({ selector: cssPath(el), rect: rectOf(el), level: parseInt(el.tagName[1], 10), text: textOf(el).slice(0, 200) }));

  // Controls
  const controlEls = Array.from(
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[href]'),
  ).filter(visible);
  const controls = controlEls
    .filter((el) => el.tagName !== 'A' || /btn|button/i.test(el.className.toString()) || el.getAttribute('role') === 'button')
    .slice(0, 200)
    .map((el) => ({
      selector: cssPath(el),
      rect: rectOf(el),
      tag: el.tagName.toLowerCase(),
      text: textOf(el).slice(0, 120),
      name: accessibleName(el).slice(0, 120),
      href: el.getAttribute('href') ?? undefined,
      type: el.getAttribute('type') ?? undefined,
      inForm: !!el.closest('form'),
    }));

  // Links
  const links = Array.from(document.querySelectorAll('a'))
    .filter(visible)
    .slice(0, 400)
    .map((a) => {
      const raw = a.getAttribute('href');
      let internal = false;
      try {
        internal = raw != null && new URL(a.href, location.href).origin === location.origin;
      } catch {
        internal = false;
      }
      return { selector: cssPath(a), rect: rectOf(a), href: raw ?? '', text: accessibleName(a).slice(0, 120), internal };
    });

  // Images
  const images = Array.from(document.images)
    .filter((img) => visible(img) || (img.complete && img.naturalWidth === 0 && img.getAttribute('src')))
    .slice(0, 200)
    .map((img) => ({
      selector: cssPath(img),
      rect: rectOf(img),
      src: img.currentSrc || img.getAttribute('src') || '',
      alt: img.getAttribute('alt'),
      broken: img.complete && img.naturalWidth === 0 && !!img.getAttribute('src'),
      decorative: img.getAttribute('alt') === '' || img.getAttribute('role') === 'presentation' || img.getAttribute('aria-hidden') === 'true',
    }));

  // Text blocks for copy analysis
  const textBlocks = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dd,dt,td,button,a,label,span,div'))
    .filter((el) => {
      const own = ownText(el);
      if (own.length < 2) return false;
      const tag = el.tagName.toLowerCase();
      if ((tag === 'span' || tag === 'div') && own.length < 12) return false;
      return visible(el);
    })
    .slice(0, 600)
    .map((el) => ({ selector: cssPath(el), rect: rectOf(el), tag: el.tagName.toLowerCase(), text: textOf(el).slice(0, 600) }));

  // Small touch targets (WCAG 2.5.8 minimum is 24x24 CSS px); inline links inside running text are exempt.
  const smallTargets: any[] = [];
  for (const el of controlEls.concat(Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).filter(visible))) {
    const r = el.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    if (el.tagName === 'A') {
      const parent = el.parentElement;
      if (parent && textOf(parent).length > textOf(el).length + 20) continue;
    }
    if (smallTargets.length < 30) {
      smallTargets.push({ selector: cssPath(el), rect: rectOf(el), text: accessibleName(el).slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // Horizontal overflow
  const scrollWidth = document.documentElement.scrollWidth;
  const overflowing: any[] = [];
  if (scrollWidth > W + 1) {
    const clipped = (el: Element) => {
      let p = el.parentElement;
      while (p && p !== document.documentElement) {
        const ox = css(p).overflowX;
        if ((ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') && p.getBoundingClientRect().right <= W + 1) return true;
        p = p.parentElement;
      }
      return false;
    };
    const offenders = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > W + 1 && visible(el) && !clipped(el);
    });
    // Keep the outermost offenders: the element whose parent does not itself overflow.
    const outer = offenders.filter((el) => !offenders.includes(el.parentElement as Element));
    for (const el of outer.slice(0, 10)) {
      overflowing.push({ selector: cssPath(el), rect: rectOf(el), right: Math.round(el.getBoundingClientRect().right) });
    }
  }

  // Unlabeled form fields
  const unlabeledInputs = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;
      if (!visible(el)) return false;
      const labelled = ((el as HTMLInputElement).labels?.length ?? 0) > 0 || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
      return !labelled;
    })
    .slice(0, 20)
    .map((el) => ({ selector: cssPath(el), rect: rectOf(el), type: el.getAttribute('type') || el.tagName.toLowerCase() }));

  // Sections
  const shapeSig = (el: Element, depth: number): string => {
    const tag = el.tagName.toLowerCase();
    if (depth === 0) return tag;
    const kids = Array.from(el.children).filter((c) => !['script', 'style'].includes(c.tagName.toLowerCase())).slice(0, 6);
    return tag + (kids.length ? '[' + kids.map((k) => shapeSig(k, depth - 1)).join(',') + ']' : '');
  };

  const isStyled = (el: Element, parent: Element) => {
    const s = css(el);
    const ps = css(parent);
    return (
      parseFloat(s.borderTopWidth) > 0 ||
      (s.boxShadow && s.boxShadow !== 'none') ||
      (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== ps.backgroundColor) ||
      (s.backgroundImage && s.backgroundImage !== 'none') ||
      parseFloat(s.borderTopLeftRadius) >= 6
    );
  };

  const findRepeatGroup = (root: Element) => {
    let best: { container: Element; items: Element[]; sig: string; styled: boolean } | null = null;
    const queue: [Element, number][] = [[root, 0]];
    while (queue.length) {
      const [node, depth] = queue.shift()!;
      const kids = Array.from(node.children).filter(visible);
      if (kids.length >= 3) {
        const counts = new Map<string, Element[]>();
        for (const k of kids) {
          const sig = shapeSig(k, 2);
          if (!counts.has(sig)) counts.set(sig, []);
          counts.get(sig)!.push(k);
        }
        for (const [sig, items] of counts) {
          if (items.length >= 3 && items.length / kids.length >= 0.6 && sig.includes('[')) {
            const styled = items.filter((i) => isStyled(i, node)).length >= items.length * 0.6;
            if (!best || items.length > best.items.length || (styled && !best.styled)) best = { container: node, items, sig, styled };
          }
        }
      }
      if (depth < 6) for (const k of kids) queue.push([k, depth + 1]);
    }
    return best;
  };

  const sectionInfo = (el: Element, index: number) => {
    const tag = el.tagName.toLowerCase();
    const r = rectOf(el);
    const role = el.getAttribute('role') || '';
    // A <header> that holds the h1 and takes real height is a hero, not site chrome.
    const heroLike = !!el.querySelector('h1') && r.height >= 240;
    const isChrome = ((tag === 'header' || role === 'banner') && !heroLike) || tag === 'footer' || tag === 'nav' || role === 'contentinfo' || role === 'navigation';
    const h = el.querySelector('h1,h2,h3');
    const heading = h ? textOf(h).slice(0, 160) : undefined;
    let centered = false;
    if (h) {
      const hs = css(h);
      const hr = h.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      centered = hs.textAlign === 'center' || (hr.width < er.width * 0.8 && Math.abs(hr.left + hr.width / 2 - (er.left + er.width / 2)) < er.width * 0.03);
    }
    const group = findRepeatGroup(el);
    let columns = 1;
    if (group) {
      const firstTop = group.items[0].getBoundingClientRect().top;
      columns = group.items.filter((i) => Math.abs(i.getBoundingClientRect().top - firstTop) < 8).length;
    }
    const btns = Array.from(el.querySelectorAll('button, a, input[type=submit]')).filter((b) => {
      if (!visible(b)) return false;
      if (b.tagName !== 'A') return true;
      const s = css(b);
      return (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0) && parseFloat(s.paddingLeft) >= 8;
    });
    const imgs = Array.from(el.querySelectorAll('img, svg, video, picture')).filter((m) => visible(m) && m.getBoundingClientRect().width > 16);
    const text = textOf(el);
    const cardCount = group ? group.items.length : 0;
    const flags = {
      hasBlockquote: !!el.querySelector('blockquote, q, figure > blockquote'),
      hasDetails: !!el.querySelector('details, [aria-expanded]'),
      hasPrice: /[$€£]\s?\d/.test(text) && /\/\s?(?:mo|month|yr|year)|per (?:month|year|user)|monthly|annually/i.test(text),
    };
    const sig = [
      isChrome ? tag : 'sec',
      `h${heading ? 1 : 0}`,
      `c${centered ? 1 : 0}`,
      `cols${Math.min(columns, 6)}`,
      `cards${Math.min(cardCount, 8)}`,
      group ? (group.styled ? 'styled' : 'plain') + ':' + group.sig.length.toString(36) : '-',
      `b${Math.min(btns.length, 3)}`,
      `i${imgs.length > 0 ? 1 : 0}`,
      flags.hasBlockquote ? 'q' : '',
      flags.hasDetails ? 'd' : '',
      flags.hasPrice ? 'p' : '',
    ].join('|');
    return {
      index,
      selector: cssPath(el),
      rect: r,
      tag,
      signature: sig,
      heading,
      text: text.slice(0, 500),
      centered,
      columns,
      cardCount,
      cardSignature: group ? group.sig : undefined,
      buttonCount: btns.length,
      imageCount: imgs.length,
      ...flags,
      isChrome,
    };
  };

  const blockKids = (el: Element) => Array.from(el.children).filter((c) => visible(c) && c.getBoundingClientRect().height >= 40);
  let root: Element = document.body;
  for (let i = 0; i < 6; i++) {
    const kids = blockKids(root);
    if (kids.length === 1 && kids[0].getBoundingClientRect().height >= root.getBoundingClientRect().height * 0.8) root = kids[0];
    else break;
  }
  const sectionEls: Element[] = [];
  for (const k of blockKids(root)) {
    const kids = blockKids(k);
    const tall = k.getBoundingClientRect().height > H * 2;
    if ((k.tagName === 'MAIN' || tall) && kids.length >= 3 && !['HEADER', 'FOOTER', 'NAV'].includes(k.tagName)) sectionEls.push(...kids);
    else sectionEls.push(k);
  }
  const sections = sectionEls.slice(0, 40).map(sectionInfo);

  const body = document.body;
  const wordCount = textOf(body).split(/\s+/).filter(Boolean).length;

  return {
    viewport: opts.viewport,
    width: W,
    height: H,
    docHeight: Math.max(body.scrollHeight, document.documentElement.scrollHeight),
    scrollWidth,
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    sections,
    headings,
    controls,
    links,
    images,
    textBlocks,
    gradients,
    glows,
    styles,
    smallTargets,
    tinyText,
    overflowing,
    unlabeledInputs,
    wordCount,
  };
}
