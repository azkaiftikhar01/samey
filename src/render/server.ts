import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/** Resolves a request path to a file under root, supporting clean URLs. Never escapes root. */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  const candidates = [target, target + '.html', path.join(target, 'index.html')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Serves a directory over HTTP on 127.0.0.1. Read-only, no directory listings. */
export function serveStatic(root: string, port = 0): Promise<RunningServer> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const file = resolveStaticPath(root, req.url ?? '/');
    if (!file) {
      const notFound = resolveStaticPath(root, '/404.html');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      if (notFound && req.method === 'GET') createReadStream(notFound).pipe(res);
      else res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function portOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

export async function waitForPort(port: number, timeoutMs: number, child?: ChildProcess): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error(`Dev server exited early with code ${child.exitCode}`);
    for (const host of ['127.0.0.1', '::1']) {
      if (await portOpen(port, host)) return host === '::1' ? `http://[::1]:${port}/` : `http://127.0.0.1:${port}/`;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for a server on port ${port}`);
}

/**
 * Starts a user-supplied dev server command. Only ever called when the user passed
 * `--serve`, which is the explicit authorization to execute project code.
 */
export async function startDevServer(command: string, cwd: string, port: number, timeoutMs: number, onLog?: (line: string) => void): Promise<RunningServer> {
  if (await portOpen(port, '127.0.0.1')) {
    throw new Error(`Port ${port} is already in use. Stop the existing server or pass --url to audit it directly.`);
  }
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(port), BROWSER: 'none', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail: string[] = [];
  const capture = (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 20) tail.shift();
      onLog?.(line);
    }
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const kill = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        resolve();
      }
      setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 3000).unref();
    });

  try {
    const url = await waitForPort(port, timeoutMs, child);
    return { url, close: kill };
  } catch (err) {
    await kill();
    const detail = tail.length ? `\nLast output:\n  ${tail.slice(-8).join('\n  ')}` : '';
    throw new Error(`${(err as Error).message}${detail}`);
  }
}
