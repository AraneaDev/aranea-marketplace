import { describe, expect, it } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateArtifacts, generateMarketplace, generateSiteFeed } from '../src/generate.js';
import type { Catalog } from '../src/schema.js';

const catalog: Catalog = {
  marketplace: 'aranea',
  entries: [
    { id: 'zeta', kind: 'plugin', install: 'zeta', source: { type: 'github', repository: 'AraneaDev/zeta', commit: '0123456789abcdef0123456789abcdef01234567' }, site: { page: 'zeta', readme: 'https://github.com/AraneaDev/zeta#readme' } },
    { id: 'alpha', kind: 'skill', install: 'alpha', source: { type: 'local', path: 'skills/alpha' }, site: { page: 'alpha', readme: 'skills/alpha/SKILL.md' } },
  ],
};

describe('catalog generation', () => {
  it('generates deterministic Claude sources for local and GitHub entries', () => {
    expect(generateMarketplace(catalog)).toEqual({
      $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
      name: 'aranea',
      owner: { name: 'AraneaDev' },
      metadata: { description: 'Aranea first-party plugins and skills' },
      plugins: [
        { name: 'alpha', source: './skills/alpha' },
        { name: 'zeta', source: { source: 'github', repo: 'AraneaDev/zeta', ref: '0123456789abcdef0123456789abcdef01234567' } },
      ],
    });
  });

  it('generates site metadata, locale mappings, pins, URL, and install variants', () => {
    const feed = generateSiteFeed(catalog);
    expect(feed.marketplaceUrl).toBe('https://github.com/AraneaDev/aranea-marketplace');
    expect(feed.entries.map(({ id }) => id)).toEqual(['alpha', 'zeta']);
    expect(feed.entries[0]).toMatchObject({
      id: 'alpha',
      display: { page: 'alpha', readme: 'skills/alpha/SKILL.md' },
      version: {},
      locales: { nl: '/skills/alpha', en: '/en/skills/alpha' },
      installation: { marketplace: 'claude plugin install alpha@aranea' },
    });
    expect(feed.entries[1].version).toEqual({ pin: '0123456789abcdef0123456789abcdef01234567' });
  });

  it('keeps repeated generation byte-identical', () => {
    expect(JSON.stringify(generateMarketplace(catalog))).toBe(JSON.stringify(generateMarketplace(catalog)));
    expect(JSON.stringify(generateSiteFeed(catalog))).toBe(JSON.stringify(generateSiteFeed(catalog)));
  });

  it('writes byte-identical artifacts on repeated generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'aranea-artifacts-'));
    try {
      generateArtifacts(catalog, root);
      const first = ['marketplace.json', 'site-feed.json', 'readme-snippets.json']
        .map((name) => readFileSync(join(root, 'generated', name)));
      generateArtifacts(catalog, root);
      const second = ['marketplace.json', 'site-feed.json', 'readme-snippets.json']
        .map((name) => readFileSync(join(root, 'generated', name)));
      expect(second.map((value, index) => value.equals(first[index]))).toEqual([true, true, true]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
