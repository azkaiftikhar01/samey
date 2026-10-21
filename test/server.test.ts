import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveStaticPath, serveStatic, type RunningServer } from '../src/render/server.js';

const root = path.resolve(__dirname, '../fixtures/sloppy-site');

describe('static server', () => {
  it('resolves clean URLs and never escapes the root', () => {
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveStaticPath(root, '/about')).toBe(path.join(root, 'about.html'));
    expect(resolveStaticPath(root, '/../../package.json')).toBeNull();
    expect(resolveStaticPath(root, '/%2e%2e/%2e%2e/package.json')).toBeNull();
    expect(resolveStaticPath(root, '/nope')).toBeNull();
  });

  let server: RunningServer | undefined;
  afterAll(() => server?.close());

  it('serves files on loopback and 404s missing paths', async () => {
    server = await serveStatic(root);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const ok = await fetch(server.url + 'about');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/html');
    expect((await fetch(server.url + 'careers')).status).toBe(404);
    expect((await fetch(server.url, { method: 'POST' })).status).toBe(405);
  });
});
