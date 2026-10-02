import type { CatalogEntry, SiteFeed } from './schema.js';

export function renderInstallBlock(entry: CatalogEntry, feed: SiteFeed): string {
  const item = feed.entries.find((candidate) => candidate.id === entry.id);
  if (!item) throw new Error(`entry ${entry.id} is missing from site feed`);
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
