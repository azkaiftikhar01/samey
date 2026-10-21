import { createHash } from 'node:crypto';
import type { Evidence, SourceFile } from '../types.js';
import { isStockGradient } from '../util/color.js';
import { findPlaceholders, findStockPhrases, firstEmoji, hasEmoji, truncate } from '../util/text.js';
import { plural } from './helpers.js';
import type { FindingInput, Rule } from './types.js';

const MARKUP = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.mdx']);
const STYLE = new Set(['.css', '.scss', '.sass', '.less']);

function* lines(f: SourceFile): Generator<{ text: string; line: number }> {
  const arr = f.content.split('\n');
  for (let i = 0; i < arr.length; i++) yield { text: arr[i], line: i + 1 };
}

function src(f: SourceFile, line: number, text: string, detail?: string): Evidence {
  return { type: 'source', file: f.path, line, excerpt: truncate(text.trim(), 160), detail };
}

const isComment = (t: string) => /^\s*(?:\/\/|\/\*|\*|<!--|\{\s*\/\*)/.test(t);

/** Text that appears between tags or in string literals; skips attribute names like placeholder= and className=. */
function visibleTextish(line: string): string {
  return line
    .replace(/\b(?:className|class|placeholder|alt|href|src|id|key|style|aria-[\w-]+|data-[\w-]+|type|name|for|htmlFor)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, ' ')
    .replace(/\bimport\b.*$/, ' ');
}

const TW_GRADIENT = /\bbg-(?:gradient|linear)-to-[trbl]{1,2}\b|\bbg-(?:radial|conic)\b/;
const TW_SYNTH_STOP = /\b(?:from|via|to)-(?:indigo|violet|purple|fuchsia|pink)-\d{2,3}\b/;
const TW_TEXT_GRADIENT = /\bbg-clip-text\b.*\btext-transparent\b|\btext-transparent\b.*\bbg-clip-text\b/;

export const srcStockGradient: Rule = {
  id: 'src-stock-gradient',
  title: 'Stock gradients in source',
  category: 'visual',
  needs: 'static',
  verified: false,
  mergeInto: 'stock-gradient',
  description: 'Tailwind gradient utilities and CSS gradients using the indigo/violet/pink band.',
  run({ repo }) {
    const ev: Evidence[] = [];
    for (const f of repo?.files ?? []) {
      for (const { text, line } of lines(f)) {
        if (isComment(text)) continue;
        if (MARKUP.has(f.ext) || f.ext === '.js' || f.ext === '.ts') {
          if (TW_GRADIENT.test(text) && TW_SYNTH_STOP.test(text)) ev.push(src(f, line, text, TW_TEXT_GRADIENT.test(text) ? 'gradient text' : 'gradient'));
          else if (TW_TEXT_GRADIENT.test(text) && TW_SYNTH_STOP.test(text)) ev.push(src(f, line, text, 'gradient text'));
        }
        if ((STYLE.has(f.ext) || MARKUP.has(f.ext)) && /gradient\(/.test(text) && isStockGradient(text)) ev.push(src(f, line, text, 'css gradient'));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 4 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${plural(ev.length, 'line')} in source define blue-violet-pink gradients.`,
        recommendation: 'Replace stock gradient utilities with brand color tokens. Prefer solid fills; use gradients only where they carry meaning.',
        evidence: ev,
      },
    ];
  },
};

export const srcGlow: Rule = {
  id: 'src-glow-effects',
  title: 'Glow and glass utilities in source',
  category: 'visual',
  needs: 'static',
  verified: false,
  mergeInto: 'glow-effects',
  description: 'backdrop-blur, large blur blobs, and colored shadows in source.',
  run({ repo }) {
    const ev: Evidence[] = [];
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext) && !STYLE.has(f.ext)) continue;
      for (const { text, line } of lines(f)) {
        if (isComment(text)) continue;
        if (/\bblur-(?:2xl|3xl|\[\d{2,}px\])\b/.test(text)) ev.push(src(f, line, text, 'blur blob'));
        else if (/\bshadow-(?:indigo|violet|purple|fuchsia|pink|blue|cyan)-\d{2,3}(?:\/\d+)?\b|shadow-\[0_0_\d{2,}px/.test(text)) ev.push(src(f, line, text, 'colored glow'));
        else if (/\bbackdrop-blur(?:-\w+)?\b|backdrop-filter:\s*blur/.test(text)) ev.push(src(f, line, text, 'glass panel'));
      }
    }
    if (ev.length < 3) return [];
    return [
      {
        severity: ev.length >= 8 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${plural(ev.length, 'line')} in source add glows, blur blobs, or glass panels.`,
        recommendation: 'Remove decorative blur and glow utilities; keep neutral, systematic elevation.',
        evidence: ev,
      },
    ];
  },
};

export const srcEmoji: Rule = {
  id: 'src-emoji-icons',
  title: 'Emoji in component markup',
  category: 'visual',
  needs: 'static',
  verified: false,
  mergeInto: 'emoji-icons',
  description: 'Emoji characters in markup and component files.',
  run({ repo }) {
    const ev: Evidence[] = [];
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext) && f.ext !== '.ts' && f.ext !== '.js') continue;
      for (const { text, line } of lines(f)) {
        if (isComment(text) || !hasEmoji(text)) continue;
        if (/console\.(?:log|warn|error)/.test(text)) continue;
        ev.push(src(f, line, text, `emoji ${firstEmoji(text)}`));
      }
    }
    if (ev.length < 2) return [];
    return [
      {
        severity: ev.length >= 5 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${plural(ev.length, 'line')} of markup or content data contain emoji.`,
        recommendation: 'Use a consistent SVG icon set instead of emoji.',
        evidence: ev,
      },
    ];
  },
};

export const srcPlaceholder: Rule = {
  id: 'src-placeholder-content',
  title: 'Placeholder content in source',
  category: 'content',
  needs: 'static',
  verified: true,
  mergeInto: 'placeholder-content',
  description: 'Lorem ipsum, sample names, and example domains in markup.',
  run({ repo }) {
    const ev: Evidence[] = [];
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext) && f.ext !== '.ts' && f.ext !== '.js') continue;
      for (const { text, line } of lines(f)) {
        if (isComment(text)) continue;
        const m = findPlaceholders(visibleTextish(text)).filter((x) => x.phrase !== 'TODO marker');
        if (m.length) ev.push(src(f, line, text, m.map((x) => x.phrase).join(', ')));
      }
    }
    if (!ev.length) return [];
    return [
      {
        severity: ev.length >= 3 ? 'high' : 'medium',
        confidence: 0.6,
        description: `${plural(ev.length, 'line')} in source contain placeholder content.`,
        recommendation: 'Replace placeholders with real content before shipping.',
        evidence: ev,
      },
    ];
  },
};

export const srcStockCopy: Rule = {
  id: 'src-stock-copy',
  title: 'Stock marketing phrases in source',
  category: 'content',
  needs: 'static',
  verified: false,
  mergeInto: 'stock-copy',
  description: 'Stock phrases in markup and content files.',
  run({ repo }) {
    const ev: Evidence[] = [];
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext)) continue;
      for (const { text, line } of lines(f)) {
        if (isComment(text)) continue;
        const m = findStockPhrases(visibleTextish(text));
        if (m.length) ev.push(src(f, line, text, m.map((x) => `"${x.phrase}"`).join(', ')));
      }
    }
    if (ev.length < 2) return [];
    return [
      {
        severity: ev.length >= 6 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${plural(ev.length, 'line')} of copy in source use stock marketing phrases.`,
        recommendation: 'Rewrite with specifics about the product: what it does, for whom, with what result.',
        evidence: ev,
      },
    ];
  },
};

export const arbitraryValues: Rule = {
  id: 'arbitrary-values',
  title: 'Hard-coded style values bypassing tokens',
  category: 'visual',
  needs: 'static',
  verified: false,
  penalty: 25,
  description: 'Tailwind arbitrary values and raw hex colors in components instead of design tokens.',
  run({ repo }) {
    const ev: Evidence[] = [];
    let arbitrary = 0;
    let hex = 0;
    const perFile = new Map<string, number>();
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext)) continue;
      for (const { text, line } of lines(f)) {
        if (isComment(text)) continue;
        const a = text.match(/\b[a-z-]+-\[(?:#[0-9a-f]{3,8}|\d+(?:\.\d+)?(?:px|rem|em)|rgba?\([^\]]+\))\]/gi) ?? [];
        const h = (text.match(/(?<![\w&])#[0-9a-f]{6}\b|(?<![\w&])#[0-9a-f]{3}\b/gi) ?? []).filter(() => /style|color|fill|stroke|background/i.test(text));
        if (a.length || h.length) {
          arbitrary += a.length;
          hex += h.length;
          perFile.set(f.path, (perFile.get(f.path) ?? 0) + a.length + h.length);
          if (ev.length < 12) ev.push(src(f, line, text, [...a, ...h].slice(0, 4).join(' ')));
        }
      }
    }
    const total = arbitrary + hex;
    if (total < 15) return [];
    const worst = [...perFile].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([p, n]) => `${p} (${n})`);
    return [
      {
        severity: total >= 40 ? 'medium' : 'low',
        confidence: 0.6,
        description: `${total} hard-coded style values in components (${arbitrary} arbitrary utilities, ${hex} raw hex colors). Most in ${worst.join(', ')}.`,
        recommendation: 'Move repeated values into theme tokens (Tailwind theme or CSS custom properties) so the design stays consistent and changes in one place.',
        evidence: ev,
      },
    ];
  },
};

const SHINGLE = 5;

export const duplicatedMarkup: Rule = {
  id: 'duplicated-markup',
  title: 'Copy-pasted component markup',
  category: 'visual',
  needs: 'static',
  verified: false,
  penalty: 25,
  description: 'Identical blocks of markup repeated within or across files instead of a shared component.',
  run({ repo }) {
    const blocks = new Map<string, { file: string; line: number; text: string }[]>();
    for (const f of repo?.files ?? []) {
      if (!MARKUP.has(f.ext)) continue;
      const raw = f.content.split('\n');
      const sig: { t: string; line: number }[] = [];
      raw.forEach((l, i) => {
        // Compare structure, not wording: three hand-written cards that differ only in text are still a copy-paste.
        const t = l.trim().replace(/>[^<>{}]*</g, '><').replace(/>[^<>{}]+$/, '>');
        // Every HTML page starts with the same document boilerplate; that is not copied component markup.
        if (/^<(?:!doctype|\/?html|\/?head|meta|link|title|\/?body|script\b[^>]*\bsrc=)/i.test(t)) return;
        if (t.length >= 12 && /[<>]/.test(t)) sig.push({ t, line: i + 1 });
      });
      for (let i = 0; i + SHINGLE <= sig.length; i++) {
        const win = sig.slice(i, i + SHINGLE);
        // Ignore windows that span a big gap; they are not one contiguous block.
        if (win[SHINGLE - 1].line - win[0].line > SHINGLE * 3) continue;
        const key = createHash('sha1').update(win.map((w) => w.t).join('\n')).digest('hex');
        if (!blocks.has(key)) blocks.set(key, []);
        const list = blocks.get(key)!;
        const last = list[list.length - 1];
        if (last && last.file === f.path && win[0].line - last.line < SHINGLE) continue; // overlapping window
        list.push({ file: f.path, line: win[0].line, text: win[0].t });
      }
    }
    const clusters = [...blocks.values()].filter((l) => l.length >= 3 || new Set(l.map((x) => x.file)).size >= 2);
    if (!clusters.length) return [];
    // Collapse overlapping clusters: keep one per first-location.
    const seenLoc = new Set<string>();
    const kept: typeof clusters = [];
    for (const c of clusters.sort((a, b) => b.length - a.length)) {
      const k = `${c[0].file}:${Math.floor(c[0].line / 20)}`;
      if (seenLoc.has(k)) continue;
      seenLoc.add(k);
      kept.push(c);
      if (kept.length >= 5) break;
    }
    const ev: Evidence[] = kept.flatMap((c) => c.slice(0, 3).map((x) => ({ type: 'source' as const, file: x.file, line: x.line, excerpt: truncate(x.text, 120), detail: `block repeated ${c.length} times` })));
    const out: FindingInput[] = [
      {
        severity: 'low',
        confidence: 0.6,
        description: `${plural(kept.length, 'block')} of markup (${SHINGLE}+ lines) are repeated with the same structure${kept.some((c) => new Set(c.map((x) => x.file)).size > 1) ? ' across files' : ''}. Copy-pasted sections drift apart over time and make the design inconsistent.`,
        recommendation: 'Extract the repeated block into a component and render it from data.',
        evidence: ev,
      },
    ];
    return out;
  },
};

export const staticRules: Rule[] = [srcStockGradient, srcGlow, srcEmoji, srcPlaceholder, srcStockCopy, arbitraryValues, duplicatedMarkup];
