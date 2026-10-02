import { describe, expect, it } from 'vitest';
import { readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateArtifacts, generateMarketplace, generateSiteFeed, validateMarketplaceManifest } from '../src/generate.js';
import type { Catalog } from '../src/schema.js';

const catalog: Catalog = {
  marketplace: 'aranea',
  entries: [
    { id: 'zeta', kind: 'plugin', install: 'zeta', source: { type: 'github', repository: 'AraneaDev/zeta', commit: '0123456789abcdef0123456789abcdef01234567' }, site: { page: 'zeta', readme: 'https://github.com/AraneaDev/zeta#readme' } },
    { id: 'alpha', kind: 'skill', install: 'alpha', source: { type: 'local', path: 'plugins/alpha' }, site: { page: 'alpha', readme: 'skills/alpha/SKILL.md' } },
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
        { name: 'alpha', source: './plugins/alpha' },
        { name: 'zeta', source: { source: 'github', repo: 'AraneaDev/zeta', ref: '0123456789abcdef0123456789abcdef01234567' } },
      ],
    });
  });

  it('generates site metadata, locale mappings, pins, URL, and install variants', () => {
    const feed = generateSiteFeed(catalog);
    expect(feed.marketplaceUrl).toBe('https://github.com/AraneaDev/aranea-marketplace');
    expect(feed.manifestUrl).toBe('https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/marketplace.json');
    expect(feed.feedUrl).toBe('https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/site-feed.json');
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

  it('validates the generated manifest fixture and local plugin layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'aranea-manifest-'));
    try {
      mkdirSync(join(root, 'plugins/alpha/.claude-plugin'), { recursive: true });
      mkdirSync(join(root, 'plugins/alpha/skills/alpha'), { recursive: true });
      writeFileSync(join(root, 'plugins/alpha/.claude-plugin/plugin.json'), JSON.stringify({ name: 'alpha', description: 'Alpha skill plugin', version: '0.1.0' }));
      writeFileSync(join(root, 'plugins/alpha/skills/alpha/SKILL.md'), '# alpha');
      expect(validateMarketplaceManifest(generateMarketplace(catalog), root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed local layouts and unpinned GitHub sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'aranea-manifest-invalid-'));
    try {
      const localProblems = validateMarketplaceManifest({
        ...generateMarketplace(catalog),
        plugins: [{ name: 'alpha', source: './plugins/alpha' }],
      }, root);
      expect(localProblems.join('\n')).toMatch(/plugin\.json|SKILL\.md/);
      const githubProblems = validateMarketplaceManifest({
        ...generateMarketplace(catalog),
        plugins: [{ name: 'zeta', source: { source: 'github', repo: 'AraneaDev/zeta', ref: 'main' } }],
      }, root);
      expect(githubProblems.join('\n')).toMatch(/40-character SHA/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
