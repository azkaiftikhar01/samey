export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function num(token: string, scale = 1): number {
  const t = token.trim();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
  return parseFloat(t);
}

function splitArgs(inner: string): { parts: string[]; alpha?: string } {
  const [main, alpha] = inner.split('/');
  const parts = main.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  return { parts, alpha: alpha?.trim() };
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}

function oklabToRgb(L: number, a: number, b: number, alpha: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: clamp255(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp255(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp255(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    a: alpha,
  };
}

function hslToRgb(h: number, s: number, l: number, a: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: clamp255(f(0) * 255), g: clamp255(f(8) * 255), b: clamp255(f(4) * 255), a };
}

/** Parses a single CSS color value. Returns null for keywords it does not know. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  const fn = s.match(/^([a-z]+)\((.*)\)$/);
  if (!fn) return null;
  const [, name, inner] = fn;
  const { parts, alpha } = splitArgs(inner);
  const a = alpha !== undefined ? num(alpha, 1) : parts.length === 4 ? num(parts[3], 1) : 1;

  switch (name) {
    case 'rgb':
    case 'rgba':
      if (parts.length < 3) return null;
      return { r: clamp255(num(parts[0], 255)), g: clamp255(num(parts[1], 255)), b: clamp255(num(parts[2], 255)), a };
    case 'hsl':
    case 'hsla':
      if (parts.length < 3) return null;
      return hslToRgb(parseFloat(parts[0]), num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100), num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100), a);
    case 'oklch': {
      if (parts.length < 3) return null;
      const L = num(parts[0], 1);
      const C = num(parts[1], 0.4);
      const H = (parseFloat(parts[2]) || 0) * (Math.PI / 180);
      return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), a);
    }
    case 'oklab':
      if (parts.length < 3) return null;
      return oklabToRgb(num(parts[0], 1), num(parts[1], 0.4), num(parts[2], 0.4), a);
    case 'color': {
      if (parts[0] !== 'srgb' || parts.length < 4) return null;
      return { r: clamp255(num(parts[1], 1) * 255), g: clamp255(num(parts[2], 1) * 255), b: clamp255(num(parts[3], 1) * 255), a };
    }
    default:
      return null;
  }
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

/** Pulls every color literal out of a CSS value such as a gradient or shadow. */
export function extractColors(value: string): RGB[] {
  const re = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|color)\([^()]*\)/gi;
  const out: RGB[] = [];
  for (const m of value.match(re) ?? []) {
    const c = parseColor(m);
    if (c) out.push(c);
  }
  return out;
}

export type HueFamily =
  | 'neutral'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink';

export function hueFamily(c: RGB): HueFamily {
  const { h, s, l } = rgbToHsl(c);
  if (s < 0.25 || l < 0.08 || l > 0.96) return 'neutral';
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 150) return 'green';
  if (h < 175) return 'teal';
  if (h < 200) return 'cyan';
  if (h < 230) return 'blue';
  if (h < 255) return 'indigo';
  if (h < 285) return 'violet';
  if (h < 320) return 'fuchsia';
  return 'pink';
}

const COOL_SYNTH = new Set<HueFamily>(['blue', 'indigo', 'violet', 'fuchsia', 'pink', 'cyan']);
const CORE_SYNTH = new Set<HueFamily>(['indigo', 'violet', 'fuchsia']);

/**
 * The stock "AI landing page" gradient: two or more saturated stops drawn from the
 * blue-indigo-violet-pink band, with at least one stop in indigo/violet/fuchsia.
 */
export function isStockGradient(value: string): boolean {
  const stops = extractColors(value).filter((c) => c.a > 0.15);
  const families = stops.map(hueFamily).filter((f) => f !== 'neutral');
  if (families.length < 2) return false;
  if (!families.every((f) => COOL_SYNTH.has(f))) return false;
  if (!families.some((f) => CORE_SYNTH.has(f))) return false;
  // A tonal ramp within one family (indigo-500 to indigo-700) is a deliberate choice, not the stock look.
  return new Set(families).size >= 2;
}

export function isSaturated(c: RGB): boolean {
  const { s, l } = rgbToHsl(c);
  return s >= 0.4 && l > 0.15 && l < 0.9;
}

export function toHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');
}
