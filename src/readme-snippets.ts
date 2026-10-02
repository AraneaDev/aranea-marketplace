import type { CatalogEntry, SiteFeed } from './schema.js';

export function renderInstallBlock(entry: CatalogEntry, feed: SiteFeed): string {
  if (entry.kind === 'site') throw new Error(`entry ${entry.id} is site-only and has no README install snippet`);
  const item = feed.entries.find((candidate) => candidate.id === entry.id);
  if (!item) throw new Error(`entry ${entry.id} is missing from site feed`);
  if (!('marketplace' in item.installation)) throw new Error(`entry ${entry.id} is site-only and has no README install snippet`);
  const lines = [
    '<!-- aranea-install:start -->',
    'Install from the Aranea marketplace:',
    '',
    '```sh',
    `claude plugin marketplace add ${feed.marketplaceUrl}`,
    item.installation.marketplace,
    '```',
  ];
  if (item.installation.fallback) lines.push('', 'If marketplace installation is unavailable:', '', '```sh', item.installation.fallback, '```');
  lines.push('<!-- aranea-install:end -->');
  return lines.join('\n');
}
