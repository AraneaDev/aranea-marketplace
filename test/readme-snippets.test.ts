import { describe, expect, it } from 'vitest';
import { generateSiteFeed } from '../src/generate.js';
import { renderInstallBlock } from '../src/readme-snippets.js';
import type { CatalogEntry } from '../src/schema.js';

const entry: CatalogEntry = {
  id: 'alpheus', kind: 'plugin', install: 'alpheus',
  source: { type: 'github', repository: 'AraneaDev/alpheus', commit: '0123456789abcdef0123456789abcdef01234567' },
  site: { page: 'alpheus', readme: 'https://github.com/AraneaDev/alpheus#readme' },
};

describe('README install snippets', () => {
  it('renders a complete canonical marketplace install block', () => {
    const block = renderInstallBlock(entry, generateSiteFeed({ marketplace: 'aranea', entries: [entry] }));
    expect(block).toBe([
      '<!-- aranea-install:start -->',
      'Install from the Aranea marketplace:',
      '',
      '```sh',
      'claude plugin marketplace add https://github.com/AraneaDev/aranea-marketplace',
      'claude plugin install alpheus@aranea',
      '```',
      '<!-- aranea-install:end -->',
    ].join('\n'));
  });

  it('includes a catalog-declared fallback command', () => {
    const fallback = { ...entry, installation: { fallback: 'git clone https://github.com/AraneaDev/alpheus' } };
    const block = renderInstallBlock(fallback, generateSiteFeed({ marketplace: 'aranea', entries: [fallback] }));
    expect(block).toContain('git clone https://github.com/AraneaDev/alpheus');
  });
});
