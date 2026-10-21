import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { RepoFacts, SourceFile } from '../types.js';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.astro', '.output',
  '.vercel', '.netlify', '.turbo', '.cache', '.parcel-cache', 'coverage', '.unslop', 'vendor', '__pycache__', '.venv', 'venv', 'storybook-static',
]);
const SOURCE_EXT = new Set(['.html', '.htm', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.vue', '.svelte', '.astro', '.css', '.scss', '.sass', '.less', '.mdx']);
const MAX_FILES = 3000;
const MAX_BYTES = 400_000;

const FRAMEWORKS: [string, string][] = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['svelte', 'Svelte'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'],
  ['react-router', 'React Router'], ['react', 'React'], ['vue', 'Vue'], ['solid-js', 'Solid'], ['@angular/core', 'Angular'], ['gatsby', 'Gatsby'],
  ['vite', 'Vite'], ['tailwindcss', 'Tailwind CSS'], ['@shadcn/ui', 'shadcn/ui'], ['framer-motion', 'Framer Motion'], ['motion', 'Motion'],
  ['lucide-react', 'Lucide'], ['@radix-ui/react-slot', 'Radix UI'], ['styled-components', 'styled-components'], ['@emotion/react', 'Emotion'],
];

function walk(root: string, rel: string, out: SourceFile[], state: { count: number; truncated: boolean }): void {
  let entries: string[];
  try {
    entries = readdirSync(path.join(root, rel));
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (state.count >= MAX_FILES) {
      state.truncated = true;
      return;
    }
    const relPath = rel ? `${rel}/${name}` : name;
    const abs = path.join(root, relPath);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (IGNORED_DIRS.has(name) || (name.startsWith('.') && name !== '.storybook')) continue;
      walk(root, relPath, out, state);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!SOURCE_EXT.has(ext) || st.size > MAX_BYTES) continue;
    if (/\.(?:min|bundle)\.(?:js|css)$/.test(name) || /\.d\.ts$/.test(name)) continue;
    if (/(?:^|\/)(?:test|tests|__tests__|e2e|fixtures?)\//.test(relPath) || /\.(?:test|spec|stories)\.[jt]sx?$/.test(name)) continue;
    state.count++;
    out.push({ path: relPath, ext, content: readFileSync(abs, 'utf8') });
  }
}

/** Directory that can be served as a static site without running any project code. */
export function findStaticRoot(root: string, pkg: Record<string, unknown> | null): string | undefined {
  for (const dir of ['out', 'dist', 'build', '_site', 'public_html', 'site']) {
    if (existsSync(path.join(root, dir, 'index.html'))) return path.join(root, dir);
  }
  if (existsSync(path.join(root, 'index.html'))) {
    // A Vite-style index.html points at uncompiled modules and cannot be served as-is.
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    const needsBundler = /<script[^>]+src=["'][^"']+\.(?:tsx?|jsx)["']/.test(html);
    const deps = { ...((pkg?.dependencies as object) ?? {}), ...((pkg?.devDependencies as object) ?? {}) } as Record<string, string>;
    if (!needsBundler && !deps.next && !deps.astro && !deps['@sveltejs/kit']) return root;
  }
  return undefined;
}

export function routeHints(files: SourceFile[]): string[] {
  const routes = new Set<string>();
  for (const f of files) {
    const p = f.path;
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^(?:src\/)?app\/(.*?)\/?page\.(?:tsx|jsx|ts|js|mdx)$/))) {
      const segs = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
      if (!segs.some((s) => s.startsWith('[') || s.startsWith('_'))) routes.add('/' + segs.join('/'));
    } else if ((m = p.match(/^(?:src\/)?pages\/(.*)\.(?:tsx|jsx|ts|js|vue|astro|md|mdx|html)$/))) {
      const r = m[1].replace(/(?:^|\/)index$/, '');
      if (!/\[|^_|\/_|^api(?:\/|$)/.test(r)) routes.add('/' + r);
    } else if ((m = p.match(/^(?:src\/)?routes\/(.*?)\/?\+page\.svelte$/))) {
      const r = m[1].split('/').filter((s) => s && !/^\(.*\)$/.test(s));
      if (!r.some((s) => s.startsWith('['))) routes.add('/' + r.join('/'));
    } else if (/\.html?$/.test(p) && !p.includes('/') && p !== '404.html') {
      routes.add(p === 'index.html' ? '/' : '/' + p.replace(/\.html?$/, ''));
    }
    if (/\.(?:jsx|tsx|js|ts)$/.test(p)) {
      for (const r of f.content.matchAll(/\bpath\s*[:=]\s*["'](\/[a-z0-9/_-]*)["']/gi)) {
        if (!r[1].includes(':') && !r[1].includes('*')) routes.add(r[1]);
      }
    }
  }
  return [...routes].map((r) => r.replace(/\/+$/, '') || '/').filter((r, i, a) => a.indexOf(r) === i).slice(0, 50);
}

export function scanRepo(root: string): RepoFacts {
  const abs = path.resolve(root);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`Not a directory: ${root}`);
  let pkg: Record<string, unknown> | null = null;
  try {
    pkg = JSON.parse(readFileSync(path.join(abs, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  const deps = { ...((pkg?.dependencies as object) ?? {}), ...((pkg?.devDependencies as object) ?? {}) } as Record<string, string>;
  const frameworks = FRAMEWORKS.filter(([dep]) => dep in deps).map(([, label]) => label);
  const packageManager = existsSync(path.join(abs, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(path.join(abs, 'yarn.lock'))
      ? 'yarn'
      : existsSync(path.join(abs, 'bun.lockb')) || existsSync(path.join(abs, 'bun.lock'))
        ? 'bun'
        : existsSync(path.join(abs, 'package-lock.json'))
          ? 'npm'
          : undefined;

  const files: SourceFile[] = [];
  const state = { count: 0, truncated: false };
  walk(abs, '', files, state);
  if (frameworks.length === 0 && files.some((f) => f.ext === '.html')) frameworks.push('Static HTML');

  return {
    root: abs,
    name: (pkg?.name as string) ?? path.basename(abs),
    frameworks,
    packageManager,
    scripts: (pkg?.scripts as Record<string, string>) ?? {},
    files,
    fileCount: files.length,
    truncated: state.truncated,
    routeHints: routeHints(files),
    staticRoot: findStaticRoot(abs, pkg),
  };
}

/** Finds the 1-based line of the first occurrence of `needle` in `content`. */
export function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Locates rendered text in the source tree. Only exact, unique-enough matches are
 * returned so that reported source locations are trustworthy.
 */
export function locateText(files: SourceFile[], text: string, max = 3, pagePath?: string): { file: string; line: number }[] {
  const needle = text.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (needle.length < 12) return [];
  const out: { file: string; line: number }[] = [];
  // When the same text exists in several files, prefer the one named after the page it was seen on.
  const page = (pagePath ?? '').replace(/^\/+|\/+$/g, '').split('/').pop() || 'index';
  const rank = (f: SourceFile) => (path.basename(f.path).replace(/\.[^.]+$/, '') === page || f.path.includes(`/${page}/`) ? 0 : 1);
  for (const f of [...files].sort((a, b) => rank(a) - rank(b))) {
    if (f.ext === '.css' || f.ext === '.scss') continue;
    const { flat, map } = collapse(f.content);
    const idx = flat.indexOf(needle);
    if (idx < 0) continue;
    out.push({ file: f.path, line: lineOf(f.content, map[idx]) });
    if (out.length >= max) break;
  }
  return out;
}

/** Collapses whitespace runs to single spaces, keeping a map back to original offsets. */
function collapse(content: string): { flat: string; map: number[] } {
  const map: number[] = [];
  let flat = '';
  let prevSpace = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const space = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
    if (space && prevSpace) continue;
    flat += space ? ' ' : ch;
    map.push(i);
    prevSpace = space;
  }
  return { flat, map };
}
