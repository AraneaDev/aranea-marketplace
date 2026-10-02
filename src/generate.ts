import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Catalog, CatalogEntry, MarketplaceManifest, MarketplaceSource, SiteFeed, SiteFeedEntry,
} from './schema.js';
import { renderInstallBlock } from './readme-snippets.js';

export const MARKETPLACE_URL = 'https://github.com/AraneaDev/aranea-marketplace';
const CLAUDE_SCHEMA = 'https://anthropic.com/claude-code/marketplace.schema.json';

const ordered = (catalog: Catalog): CatalogEntry[] => [...catalog.entries].sort((a, b) => a.id.localeCompare(b.id));

export function generateMarketplace(catalog: Catalog): MarketplaceManifest {
  return {
    $schema: CLAUDE_SCHEMA,
    name: catalog.marketplace,
    owner: { name: 'AraneaDev' },
    metadata: { description: 'Aranea first-party plugins and skills' },
    plugins: ordered(catalog).map((entry) => {
      let source: MarketplaceSource;
      if (entry.source.type === 'local') source = `./${entry.source.path}`;
      else source = { source: 'github', repo: entry.source.repository, ref: entry.source.commit };
      return { name: entry.install, source };
    }),
  };
}

function locales(entry: CatalogEntry): Record<'en' | 'nl', string> {
  const section = entry.kind === 'skill' ? 'skills' : 'tools';
  return {
    nl: entry.site.locales?.nl ?? `/${section}/${entry.site.page}`,
    en: entry.site.locales?.en ?? `/en/${section}/${entry.site.page}`,
  };
}

function feedEntry(catalog: Catalog, entry: CatalogEntry): SiteFeedEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    install: entry.install,
    display: { page: entry.site.page!, readme: entry.site.readme! },
    source: entry.source,
    version: entry.source.type === 'github' ? { pin: entry.source.commit } : {},
    locales: locales(entry),
    installation: {
      marketplace: `claude plugin install ${entry.install}@${catalog.marketplace}`,
      ...(entry.installation?.fallback ? { fallback: entry.installation.fallback } : {}),
    },
  };
}

export function generateSiteFeed(catalog: Catalog): SiteFeed {
  return {
    version: 1,
    marketplace: catalog.marketplace,
    marketplaceUrl: MARKETPLACE_URL,
    entries: ordered(catalog).map((entry) => feedEntry(catalog, entry)),
  };
}

export type GeneratedArtifacts = {
  marketplace: MarketplaceManifest;
  siteFeed: SiteFeed;
  readmeSnippets: Record<string, string>;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export function generateArtifacts(catalog: Catalog, root: string): GeneratedArtifacts {
  const marketplace = generateMarketplace(catalog);
  const siteFeed = generateSiteFeed(catalog);
  const readmeSnippets = Object.fromEntries(ordered(catalog).map((entry) => [entry.id, renderInstallBlock(entry, siteFeed)]));
  const generated = join(root, 'generated');
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(generated, 'marketplace.json'), json(marketplace));
  writeFileSync(join(generated, 'site-feed.json'), json(siteFeed));
  writeFileSync(join(generated, 'readme-snippets.json'), json(readmeSnippets));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), json(marketplace));
  return { marketplace, siteFeed, readmeSnippets };
}
