export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'visual' | 'content' | 'functional' | 'accessibility' | 'technical';
export type FindingSource = 'rendered' | 'static' | 'model';
export type ViewportName = 'desktop' | 'mobile';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Evidence {
  /** `dom` is an element on a rendered page; `network` and `console` extend the base set. */
  type: 'screenshot' | 'dom' | 'source' | 'metric' | 'text' | 'network' | 'console';
  route?: string;
  /** Other routes where the identical evidence was seen (a shared component). */
  alsoOn?: string[];
  viewport?: ViewportName;
  selector?: string;
  rect?: Rect;
  /** Relative to the project root, posix separators, validated to stay inside it. */
  file?: string;
  line?: number;
  excerpt?: string;
  /** Relative to the report directory. */
  screenshotPath?: string;
  metric?: Record<string, number | string>;
  detail?: string;
}

export interface Finding {
  /** Stable for the same rule and evidence: `${ruleId}-${fingerprint prefix}`. */
  id: string;
  ruleId: string;
  ruleVersion: number;
  category: Category;
  title: string;
  description: string;
  severity: Severity;
  /** 0 to 1. How sure the rule is that the observation is real, separate from how much it matters. */
  confidence: number;
  evidence: Evidence[];
  recommendation: string;
  /** Hash of rule id and evidence identity (not routes), used for deduplication. */
  fingerprint: string;
  /** True for measured defects; false for design observations that need judgment. */
  verified: boolean;
  source: FindingSource;
  routes?: string[];
  /** Model findings are advisory candidates and never affect the score. */
  advisory?: boolean;
}

// ---------------------------------------------------------------------------
// Rendered facts (produced by the browser extractor)
// ---------------------------------------------------------------------------

export interface ElementRef {
  selector: string;
  rect: Rect;
}

export interface GradientFact extends ElementRef {
  value: string;
  area: number;
  isText: boolean;
}

export interface GlowFact extends ElementRef {
  value: string;
  kind: 'shadow' | 'blur-blob' | 'backdrop';
}

export interface SectionFact extends ElementRef {
  index: number;
  tag: string;
  /** Coarse layout fingerprint used for sameness comparisons. */
  signature: string;
  heading?: string;
  text: string;
  centered: boolean;
  columns: number;
  cardCount: number;
  cardSignature?: string;
  buttonCount: number;
  imageCount: number;
  hasBlockquote: boolean;
  hasDetails: boolean;
  hasPrice: boolean;
  isChrome: boolean; // header/nav/footer
}

export interface HeadingFact extends ElementRef {
  level: number;
  text: string;
}

export interface ControlFact extends ElementRef {
  tag: string;
  text: string;
  name: string;
  href?: string;
  type?: string;
  inForm: boolean;
}

export interface LinkFact extends ElementRef {
  href: string;
  text: string;
  internal: boolean;
}

export interface ImageFact extends ElementRef {
  src: string;
  alt: string | null;
  broken: boolean;
  decorative: boolean;
}

export interface TextBlock extends ElementRef {
  tag: string;
  text: string;
}

export interface StyleCounts {
  colors: Record<string, number>;
  backgrounds: Record<string, number>;
  fontSizes: Record<string, number>;
  fontFamilies: Record<string, number>;
  radii: Record<string, number>;
  shadows: Record<string, number>;
  spacing: Record<string, number>;
}

export interface ViewportFacts {
  viewport: ViewportName;
  width: number;
  height: number;
  docHeight: number;
  scrollWidth: number;
  screenshot?: string;
  screenshotHeight?: number;
  lang: string | null;
  title: string;
  metaDescription: string | null;
  sections: SectionFact[];
  headings: HeadingFact[];
  controls: ControlFact[];
  links: LinkFact[];
  images: ImageFact[];
  textBlocks: TextBlock[];
  gradients: GradientFact[];
  glows: GlowFact[];
  styles: StyleCounts;
  smallTargets: (ElementRef & { text: string; w: number; h: number })[];
  tinyText: (ElementRef & { text: string; size: number })[];
  overflowing: (ElementRef & { right: number })[];
  unlabeledInputs: (ElementRef & { type: string })[];
  wordCount: number;
}

export interface InteractionResult extends ElementRef {
  text: string;
  outcome: 'navigated' | 'changed' | 'no-effect' | 'error' | 'skipped';
  detail?: string;
}

export interface PageFacts {
  url: string;
  path: string;
  status: number | null;
  loadMs: number;
  error?: string;
  consoleErrors: string[];
  failedRequests: { url: string; status?: number; failure?: string; resourceType: string }[];
  desktop?: ViewportFacts;
  mobile?: ViewportFacts;
  interactions: InteractionResult[];
}

export interface CrawlResult {
  baseUrl: string;
  pages: PageFacts[];
  skipped: { url: string; reason: string }[];
  brokenLinks: { from: string; url: string; status: number | null; error?: string }[];
  discovered: number;
  limitHit: boolean;
  network: { blocked: { url: string; reason: string }[]; requests: number; bytes: number; budgetExceeded: boolean };
}

// ---------------------------------------------------------------------------
// Static (repository) facts
// ---------------------------------------------------------------------------

export interface SourceFile {
  path: string; // relative to project root, posix separators
  ext: string;
  content: string;
}

export interface RepoFacts {
  root: string;
  name?: string;
  frameworks: string[];
  packageManager?: string;
  scripts: Record<string, string>;
  files: SourceFile[];
  fileCount: number;
  truncated: boolean;
  routeHints: string[];
  staticRoot?: string; // directory that can be served as a static site
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface CategoryScore {
  category: Category;
  /** 0 = no slop indicators found, 100 = many or severe. null = not measured. */
  score: number | null;
  weight: number;
  /** Sum of weighted penalties before saturation. */
  penalty: number;
  deductions: { findingId: string; ruleId: string; penalty: number }[];
}

export interface Coverage {
  staticAnalysis: boolean;
  rendered: boolean;
  /** A rendered target existed and the browser ran, whether or not any page loaded. */
  renderAttempted: boolean;
  renderedNote?: string;
  pagesAudited: number;
  pagesFailed: number;
  routeLimitHit: boolean;
  skipped: { url: string; reason: string }[];
  interactions: boolean;
  /** Requests the network policy refused (sample), e.g. a page referencing a private address. */
  blockedRequests: { url: string; reason: string }[];
  networkBudgetExceeded: boolean;
  model: { enabled: boolean; name?: string; note?: string };
  /** Plain-language list of everything that limits how complete this scan is. */
  limitations: string[];
}

export interface AuditReport {
  schemaVersion: 1;
  scanId: string;
  tool: { name: 'unslop'; version: string };
  generatedAt: string;
  durationMs: number;
  /** A short hash of the project path or URL origin, safe to share. */
  project: { id: string; name?: string };
  target: { path?: string; url?: string };
  /** Overall slop score: 0 = few indicators, 100 = many or severe. null when nothing was measured. */
  score: number | null;
  categories: CategoryScore[];
  findings: Finding[];
  coverage: Coverage;
  versions: { scoring: string; rules: Record<string, number>; model?: string };
  viewports: { name: ViewportName; width: number; height: number }[];
  failedRoutes: { url: string; reason: string }[];
  repo?: { name?: string; frameworks: string[]; fileCount: number; truncated: boolean };
  pages: {
    url: string;
    path: string;
    status: number | null;
    error?: string;
    title?: string;
    screenshots: Partial<Record<ViewportName, { file: string; width: number; height: number }>>;
  }[];
}
