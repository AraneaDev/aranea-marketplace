import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  inspectInstallMarkers,
  replaceInstallBlock,
  replaceInstallBlockBytes,
  syncRepository,
} from '../src/readme-sync.js';
import type { CatalogEntry } from '../src/schema.js';

const marker = 'aranea-install';
const start = '<!-- aranea-install:start -->';
const end = '<!-- aranea-install:end -->';
const block = `${start}\nold\n${end}`;
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const entry: CatalogEntry = {
  id: 'alpheus',
  kind: 'plugin',
  install: 'alpheus',
  source: { type: 'github', repository: 'AraneaDev/alpheus', commit: '0123456789abcdef0123456789abcdef01234567' },
  site: { page: 'alpheus', readme: 'https://github.com/AraneaDev/alpheus#readme' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function installWriteFetch(responses: Response[]): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected GitHub request');
    return response;
  });
}

function writeAuth(): () => void {
  const oldAppId = process.env.GITHUB_APP_ID;
  const oldInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const oldPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_APP_INSTALLATION_ID = '2';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  return () => {
    if (oldAppId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = oldAppId;
    if (oldInstallationId === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID; else process.env.GITHUB_APP_INSTALLATION_ID = oldInstallationId;
    if (oldPrivateKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = oldPrivateKey;
  };
}

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

  it('preserves non-ASCII bytes outside the generated region', () => {
    const before = Buffer.from('voor\u00a0');
    const after = Buffer.from('\u00a0na');
    const readme = Buffer.concat([before, Buffer.from(block), after]);
    const replaced = replaceInstallBlockBytes(readme, marker, Buffer.from(`${start}\nnew\n${end}`));

    expect(replaced.subarray(0, before.length)).toEqual(before);
    expect(replaced.subarray(replaced.length - after.length)).toEqual(after);
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

  it('updates an existing branch from its README and reuses its pull request', async () => {
    const restoreAuth = writeAuth();
    const defaultReadme = `main-only\n${block}\nmain-tail`;
    const branchReadme = `branch-only\n${block}\nbranch-tail`;
    const fetchSpy = installWriteFetch([
      jsonResponse({ token: 'app-token' }),
      jsonResponse({ content: Buffer.from(defaultReadme).toString('base64') }),
      jsonResponse({ default_branch: 'main' }),
      jsonResponse({ object: { sha: 'base-sha' } }),
      jsonResponse({ object: { sha: 'branch-sha' } }),
      jsonResponse({ content: Buffer.from(branchReadme).toString('base64'), sha: 'branch-readme-sha' }),
      jsonResponse({ content: { sha: 'updated' } }),
      jsonResponse([{ html_url: 'https://github.com/AraneaDev/alpheus/pull/7' }]),
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'write')).resolves.toMatchObject({
        status: 'changed',
        pullRequestUrl: 'https://github.com/AraneaDev/alpheus/pull/7',
      });
      const update = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(update).toBeDefined();
      const payload = JSON.parse(update![1].body as string);
      expect(Buffer.from(payload.content, 'base64').toString('utf8')).toBe(`branch-only\n${start}\nInstall from the Aranea marketplace:\n\n\`\`\`sh\nclaude plugin marketplace add https://github.com/AraneaDev/aranea-marketplace\nclaude plugin install alpheus@aranea\n\`\`\`\n${end}\nbranch-tail`);
      expect(fetchSpy.mock.calls.some(([url, init]) => String(url).endsWith('/pulls') && init?.method === 'POST')).toBe(false);
    } finally {
      restoreAuth();
      vi.unstubAllGlobals();
    }
  });

  it('does not PUT when an existing branch already contains the rendered block', async () => {
    const restoreAuth = writeAuth();
    const current = '<!-- aranea-install:start -->\nInstall from the Aranea marketplace:\n\n```sh\nclaude plugin marketplace add https://github.com/AraneaDev/aranea-marketplace\nclaude plugin install alpheus@aranea\n```\n<!-- aranea-install:end -->';
    const fetchSpy = installWriteFetch([
      jsonResponse({ token: 'app-token' }),
      jsonResponse({ content: Buffer.from(`${start}\nold\n${end}`).toString('base64') }),
      jsonResponse({ default_branch: 'main' }),
      jsonResponse({ object: { sha: 'base-sha' } }),
      jsonResponse({ object: { sha: 'branch-sha' } }),
      jsonResponse({ content: Buffer.from(`branch-only\n${current}\nbranch-tail`).toString('base64'), sha: 'branch-readme-sha' }),
      jsonResponse([{ html_url: 'https://github.com/AraneaDev/alpheus/pull/7' }]),
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'write')).resolves.toMatchObject({
        status: 'unchanged',
        changed: false,
        pullRequestUrl: 'https://github.com/AraneaDev/alpheus/pull/7',
      });
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    } finally {
      restoreAuth();
      vi.unstubAllGlobals();
    }
  });

  it('rejects a non-UTF-8 README before any branch write', async () => {
    const restoreAuth = writeAuth();
    const fetchSpy = installWriteFetch([
      jsonResponse({ token: 'app-token' }),
      jsonResponse({ content: Buffer.from([0xc3, 0x28]).toString('base64') }),
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(syncRepository('AraneaDev/alpheus', entry, 'write')).resolves.toMatchObject({ status: 'invalid', changed: false });
      expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    } finally {
      restoreAuth();
      vi.unstubAllGlobals();
    }
  });
});
