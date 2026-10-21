#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from 'commander';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import pc from 'picocolors';
import { runAudit, toolVersion } from './audit.js';
import { DEFAULTS, loadConfigFile, type AuditOptions } from './config.js';
import { allRules } from './rules/index.js';
import { fullPrompt } from './report/prompt.js';
import { summarize } from './report/terminal.js';

const int = (name: string, min = 1) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new InvalidArgumentError(`${name} must be an integer >= ${min}.`);
  return n;
};

const program = new Command();
program.name('samey').description('Lint your AI-built UI. Finds what looks generic, what is broken, and where to fix it.').version(toolVersion());

program
  .command('audit')
  .description('Audit a local project, a URL, or both')
  .argument('[path]', 'project directory to scan (and serve, if it has a static build)')
  .option('-u, --url <url>', 'audit a running site at this URL')
  .option('--serve [command]', 'start the project dev server with this command (default: npm run dev). Runs project code.')
  .option('--dev', 'development mode: allow --url to point at localhost or a private network address')
  .option('--port <port>', 'port the dev server listens on', int('port'), DEFAULTS.port)
  .option('--max-routes <n>', 'maximum pages to render', int('max-routes'), DEFAULTS.maxRoutes)
  .option('--concurrency <n>', 'pages audited at the same time', int('concurrency'), DEFAULTS.concurrency)
  .option('--timeout <seconds>', 'navigation timeout per page', int('timeout'), DEFAULTS.navTimeoutMs / 1000)
  .option('--route <path...>', 'extra routes to audit, e.g. --route /pricing /about')
  .addOption(new Option('--format <format>', 'report output').choices(['html', 'json', 'both']).default('both'))
  .addOption(new Option('--report <format>', 'alias for --format').choices(['html', 'json', 'both']))
  .option('-o, --out <dir>', 'output directory (default: <path>/.samey or ./.samey)')
  .option('--static-only', 'skip rendering; only scan source files')
  .option('--no-screenshots', 'do not capture screenshots')
  .option('--no-interact', 'do not click any buttons')
  .option('--ignore-robots', 'crawl pages disallowed by robots.txt (only for sites you own)')
  .option('--ignore <rules...>', 'rule ids to skip')
  .option('--fail-above <score>', 'exit with code 1 if the slop score is above this (0 = clean, 100 = worst)', int('fail-above', 0))
  .option('--no-ai', 'never use a local model, even if one is configured')
  .option('--model <name>', 'local Ollama vision model for an advisory critique, e.g. qwen2.5vl:7b')
  .option('--model-endpoint <url>', 'local model server (loopback only)', DEFAULTS.modelEndpoint)
  .option('--json', 'print the JSON report to stdout instead of the summary')
  .option('-q, --quiet', 'only print the final summary')
  .action(async (target: string | undefined, o) => {
    const dir = target ? path.resolve(target) : undefined;
    if (!dir && !o.url) {
      program.error('Pass a project path, --url, or both. Example: samey audit . or samey audit --url https://example.com', { exitCode: 2 });
    }
    let file: Partial<AuditOptions>;
    try {
      file = loadConfigFile(dir);
    } catch (err) {
      console.error(pc.red((err as Error).message));
      process.exit(2);
    }
    const src = (name: string) => program.commands[0].getOptionValueSource(name);
    const pick = <T>(cli: T, name: string, fromFile: T | undefined): T => (src(name) === 'default' && fromFile !== undefined ? fromFile : cli);

    // A dev-server command from the config file is only used when --serve is passed on the command line.
    const serve = o.serve === true ? (file.serve ?? 'npm run dev') : typeof o.serve === 'string' ? o.serve : undefined;
    const quiet = o.quiet || o.json;
    const opts: AuditOptions = {
      ...DEFAULTS,
      path: dir,
      url: o.url,
      serve,
      dev: !!o.dev,
      port: pick(o.port, 'port', file.port),
      maxRoutes: pick(o.maxRoutes, 'maxRoutes', file.maxRoutes),
      concurrency: pick(o.concurrency, 'concurrency', file.concurrency),
      navTimeoutMs: src('timeout') === 'default' && file.navTimeoutMs ? file.navTimeoutMs : o.timeout * 1000,
      pageTimeoutMs: file.pageTimeoutMs ?? DEFAULTS.pageTimeoutMs,
      serverTimeoutMs: file.serverTimeoutMs ?? DEFAULTS.serverTimeoutMs,
      outDir: o.out ? path.resolve(o.out) : path.join(dir ?? process.cwd(), '.samey'),
      formats: (o.report ?? o.format) === 'both' ? ['html', 'json'] : [o.report ?? o.format],
      screenshots: o.screenshots && file.screenshots !== false,
      interact: o.interact && file.interact !== false,
      staticOnly: !!o.staticOnly,
      respectRobots: !o.ignoreRobots && file.respectRobots !== false,
      ignoreRules: [...(file.ignoreRules ?? []), ...(o.ignore ?? [])],
      routes: [...(file.routes ?? []), ...(o.route ?? [])],
      failAbove: o.failAbove ?? file.failAbove,
      ai: o.ai,
      model: o.model ?? file.model,
      modelEndpoint: pick(o.modelEndpoint, 'modelEndpoint', file.modelEndpoint),
      modelTimeoutMs: DEFAULTS.modelTimeoutMs,
      onProgress: quiet ? undefined : (m) => console.error(pc.dim(`  ${m}`)),
    };
    const unknownRules = opts.ignoreRules.filter((r) => !allRules.some((x) => x.id === r));
    if (unknownRules.length) console.error(pc.yellow(`  Unknown rule id${unknownRules.length > 1 ? 's' : ''} in ignore list: ${unknownRules.join(', ')}`));

    try {
      const { report, files, ruleErrors } = await runAudit(opts);
      for (const e of ruleErrors) console.error(pc.yellow(`  Rule ${e.ruleId} failed and was skipped: ${e.message}`));
      if (o.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      else console.log(summarize(report, files));
      if (report.coverage.renderAttempted && !report.coverage.rendered) {
        console.error(pc.red(`  ${report.coverage.renderedNote}`));
        process.exitCode = 2;
        return;
      }
      if (opts.failAbove !== undefined) {
        if (report.score === null) {
          console.error(pc.red(`  --fail-above ${opts.failAbove}: nothing could be scored.`));
          process.exitCode = 1;
        } else if (report.score > opts.failAbove) {
          console.error(pc.red(`  Slop score ${report.score} is above --fail-above ${opts.failAbove}.`));
          process.exitCode = 1;
        }
      }
    } catch (err) {
      console.error(pc.red(`\n  Audit failed: ${(err as Error).message}\n`));
      process.exitCode = 2;
    }
  });

program
  .command('prompt')
  .description('Print a fix prompt for an AI coding agent from the last audit')
  .argument('[path]', 'project directory that was audited', '.')
  .option('-o, --out <dir>', 'output directory used by the audit (default: <path>/.samey)')
  .option('--only-defects', 'leave out design observations and include measured defects only')
  .action((target: string, o) => {
    const file = path.join(o.out ? path.resolve(o.out) : path.join(path.resolve(target), '.samey'), 'report.json');
    let report;
    try {
      report = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(pc.red(`  No report at ${file}. Run \`npx samey-cli audit\` first.`));
      process.exit(2);
    }
    const text = fullPrompt(report, { onlyDefects: !!o.onlyDefects });
    if (!text) {
      console.error('  The last audit found nothing to fix.');
      return;
    }
    process.stdout.write(text);
  });

program
  .command('setup')
  .description('Download the Chromium build that samey uses for rendered checks (about 150 MB, once)')
  .action(() => {
    // Use the Playwright version samey ships with, so the browser always matches it.
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const res = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
    process.exitCode = res.status ?? 2;
  });

program
  .command('rules')
  .description('List every rule samey runs')
  .action(() => {
    for (const r of allRules) {
      console.log(`${pc.bold(r.id.padEnd(26))} ${pc.dim(`[${r.category}, ${r.needs}]`)}\n  ${r.description}`);
    }
  });

program.parseAsync().catch((err) => {
  console.error(pc.red((err as Error).message));
  process.exit(2);
});
