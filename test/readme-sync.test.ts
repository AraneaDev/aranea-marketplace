import { describe, expect, it, vi } from 'vitest';
import {
  inspectInstallMarkers,
  replaceInstallBlock,
  syncRepository,
} from '../src/readme-sync.js';
import type { CatalogEntry } from '../src/schema.js';

const marker = 'aranea-install';
const start = '<!-- aranea-install:start -->';
const end = '<!-- aranea-install:end -->';
const block = `${start}\nold\n${end}`;
const entry: CatalogEntry = {
  id: 'alpheus',
  kind: 'plugin',
  install: 'alpheus',
  source: { type: 'github', repository: 'AraneaDev/alpheus', commit: '0123456789abcdef0123456789abcdef01234567' },
  site: { page: 'alpheus', readme: 'https://github.com/AraneaDev/alpheus#readme' },
};

describe('README install marker inspection', () => {
  it('inspects one valid block', () => {
    expect(inspectInstallMarkers(`before\n${block}\nafter`, marker)).toMatchObject({
      valid: true,
      startIndex: 7,
      endIndex: 41,
    });
  });

  it.each([
    ['missing start', `old\n${end}`, 'missing-start'],
    ['missing end', `${start}\nold`, 'missing-end'],
    ['duplicate blocks', `${block}\n${block}`, 'duplicate-start'],
    ['nested markers', `${start}\n${start}\nold\n${end}\n${end}`, 'nested'],
  ])('reports %s as a structured error', (_name, readme, code) => {
    const result = inspectInstallMarkers(readme, marker);
    expect(result).toMatchObject({ valid: false, error: { code } });
  });

  it('replaces only the inclusive generated region', () => {
    const readme = `prefix\r\n${block}\r\n suffix`;
    const rendered = `${start}\nnew\n${end}`;
    expect(replaceInstallBlock(readme, marker, rendered)).toBe(`prefix\r\n${rendered}\r\n suffix`);
  });

  it('returns byte-identical output when the rendered block is unchanged', () => {
    expect(replaceInstallBlock(`before${block}after`, marker, block)).toBe(`before${block}after`);
  });
});

describe('README synchronization', () => {
  it('reports missing credentials without making a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const oldToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await expect(syncRepository(entry.source.type === 'github' ? entry.source.repository : '', entry, 'dry-run'))
        .resolves.toMatchObject({ status: 'inaccessible' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = oldToken;
      fetchSpy.mockRestore();
    }
  });

  it('reports inaccessible repositories from the GitHub response', async () => {
    const oldToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'dry-run')).resolves.toMatchObject({ status: 'inaccessible' });
    } finally {
      if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = oldToken;
      vi.unstubAllGlobals();
    }
  });

  it('reports missing markers without attempting a write', async () => {
    const oldToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ content: Buffer.from('# no block').toString('base64'), sha: 'readme-sha' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'dry-run')).resolves.toMatchObject({ status: 'missing-markers', changed: false });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = oldToken;
      vi.unstubAllGlobals();
    }
  });

  it('reports unchanged and changed README blocks during dry-run', async () => {
    const oldToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    const current = '<!-- aranea-install:start -->\nInstall from the Aranea marketplace:\n\n```sh\nclaude plugin marketplace add https://github.com/AraneaDev/aranea-marketplace\nclaude plugin install alpheus@aranea\n```\n<!-- aranea-install:end -->';
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ content: Buffer.from(current).toString('base64'), sha: 'readme-sha' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'dry-run')).resolves.toMatchObject({ status: 'unchanged', changed: false });
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ content: Buffer.from(`${start}\nold\n${end}`).toString('base64'), sha: 'readme-sha' }), { status: 200 }));
      await expect(syncRepository('AraneaDev/alpheus', entry, 'dry-run')).resolves.toMatchObject({ status: 'changed', changed: true });
    } finally {
      if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = oldToken;
      vi.unstubAllGlobals();
    }
  });
});
