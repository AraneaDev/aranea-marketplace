import { afterEach, describe, expect, it, vi } from 'vitest';
import { findBump, renderSummary, replacePin } from '../src/bump-pins.js';
import type { CatalogEntry } from '../src/schema.js';

const OLD = '1111111111111111111111111111111111111111';
const NEW = '2222222222222222222222222222222222222222';

const entry: CatalogEntry = {
  id: 'alpheus',
  kind: 'plugin',
  install: 'alpheus',
  source: { type: 'github', repository: 'AraneaDev/alpheus', commit: OLD },
  site: { page: 'alpheus', readme: 'https://github.com/AraneaDev/alpheus#readme' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const pluginJson = (version: string) => json({ content: Buffer.from(JSON.stringify({ name: 'alpheus', version })).toString('base64'), encoding: 'base64' });

/** Routes each GitHub API path to a canned response, and fails loudly on any other request. */
function route(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected request ${path}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('replacePin', () => {
  const catalog = [
    'entries:',
    `  - id: alpheus`,
    `    source: { type: github, repository: AraneaDev/alpheus, commit: "${OLD}" }`,
    `  - id: ariadne`,
    `    source: { type: github, repository: AraneaDev/ariadne, commit: "${OLD}" }`,
    '',
  ].join('\n');

  it('rewrites only the commit of the named repository and leaves every other byte alone', () => {
    const updated = replacePin(catalog, 'AraneaDev/alpheus', OLD, NEW);
    expect(updated).toBe(catalog.replace(`AraneaDev/alpheus, commit: "${OLD}"`, `AraneaDev/alpheus, commit: "${NEW}"`));
    expect(updated).toContain(`AraneaDev/ariadne, commit: "${OLD}"`);
  });

  it('refuses when the pin it was told to replace is not there', () => {
    expect(() => replacePin(catalog, 'AraneaDev/alpheus', NEW, OLD)).toThrow(/exactly one/);
    expect(() => replacePin(catalog, 'AraneaDev/missing', OLD, NEW)).toThrow(/exactly one/);
  });
});

describe('findBump', () => {
  it('proposes the latest release when it is ahead and carries a plugin manifest', async () => {
    route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.3.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.3.0': () => json({ sha: NEW }),
      [`/repos/AraneaDev/alpheus/compare/${OLD}...${NEW}`]: () => json({ status: 'ahead' }),
      [`/repos/AraneaDev/alpheus/contents/.claude-plugin/plugin.json?ref=${NEW}`]: () => pluginJson('0.3.0'),
    });
    expect(await findBump(entry, 'token')).toEqual({
      id: 'alpheus', repository: 'AraneaDev/alpheus', status: 'bump', from: OLD, to: NEW, tag: 'v0.3.0', version: '0.3.0',
      message: `v0.3.0 (${NEW.slice(0, 7)}), version 0.3.0`,
    });
  });

  it('reports current when the release is the pinned commit, without further requests', async () => {
    const fetchMock = route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.2.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.2.0': () => json({ sha: OLD }),
    });
    expect((await findBump(entry, 'token')).status).toBe('current');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips a repository with no published release', async () => {
    route({ '/repos/AraneaDev/alpheus/releases/latest': () => json({ message: 'Not Found' }, 404) });
    expect(await findBump(entry, 'token')).toMatchObject({ status: 'skipped', message: expect.stringMatching(/no published release/) });
  });

  // A force-pushed or re-tagged release must never move the pin backwards or sideways.
  it.each(['behind', 'diverged', 'identical'])('skips a release that is %s the pin', async (status) => {
    route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.3.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.3.0': () => json({ sha: NEW }),
      [`/repos/AraneaDev/alpheus/compare/${OLD}...${NEW}`]: () => json({ status }),
    });
    expect(await findBump(entry, 'token')).toMatchObject({ status: 'skipped', message: expect.stringContaining(status) });
  });

  it('skips a release without .claude-plugin/plugin.json, which Claude Code could not install', async () => {
    route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.3.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.3.0': () => json({ sha: NEW }),
      [`/repos/AraneaDev/alpheus/compare/${OLD}...${NEW}`]: () => json({ status: 'ahead' }),
      [`/repos/AraneaDev/alpheus/contents/.claude-plugin/plugin.json?ref=${NEW}`]: () => json({ message: 'Not Found' }, 404),
    });
    expect(await findBump(entry, 'token')).toMatchObject({ status: 'skipped', message: expect.stringMatching(/plugin\.json/) });
  });

  it('skips a release whose plugin.json has no version', async () => {
    route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.3.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.3.0': () => json({ sha: NEW }),
      [`/repos/AraneaDev/alpheus/compare/${OLD}...${NEW}`]: () => json({ status: 'ahead' }),
      [`/repos/AraneaDev/alpheus/contents/.claude-plugin/plugin.json?ref=${NEW}`]: () => json({ content: Buffer.from('{"name":"alpheus"}').toString('base64') }),
    });
    expect(await findBump(entry, 'token')).toMatchObject({ status: 'skipped', message: expect.stringMatching(/version/) });
  });

  it('sends the token to the GitHub API', async () => {
    const fetchMock = route({
      '/repos/AraneaDev/alpheus/releases/latest': () => json({ tag_name: 'v0.2.0' }),
      '/repos/AraneaDev/alpheus/commits/v0.2.0': () => json({ sha: OLD }),
    });
    await findBump(entry, 'secret-token');
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });
});

describe('renderSummary', () => {
  it('lists each bump with its old and new commit and release link', () => {
    const summary = renderSummary([
      { id: 'alpheus', repository: 'AraneaDev/alpheus', status: 'bump', from: OLD, to: NEW, tag: 'v0.3.0', version: '0.3.0', message: '' },
      { id: 'ariadne', repository: 'AraneaDev/ariadne', status: 'current', message: 'already at v0.0.11' },
    ]);
    expect(summary).toContain('| alpheus | [v0.3.0](https://github.com/AraneaDev/alpheus/releases/tag/v0.3.0) | 0.3.0 | `1111111` → `2222222` |');
    expect(summary).not.toContain('ariadne |');
  });
});
