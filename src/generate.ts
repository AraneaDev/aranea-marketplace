import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Catalog, CatalogEntry, MarketplaceManifest, MarketplaceSource, SiteFeed, SiteFeedEntry,
} from './schema.js';
import { renderInstallBlock } from './readme-snippets.js';

export const MARKETPLACE_URL = 'https://github.com/AraneaDev/aranea-marketplace';
export const MANIFEST_URL = 'https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/marketplace.json';
export const FEED_URL = 'https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/site-feed.json';
const CLAUDE_SCHEMA = 'https://anthropic.com/claude-code/marketplace.schema.json';
type MarketplaceContract = {
  schema: string;
  topLevelRequired: string[];
  topLevelProperties: string[];
  ownerRequired: string[];
  ownerProperties: string[];
  metadataRequired: string[];
  metadataProperties: string[];
  pluginRequired: string[];
  pluginProperties: string[];
  localSource: { pathPattern: string; metadataPath: string; metadataRequired: string[]; skillPath: string };
  githubSource: { required: string[]; properties: string[]; source: string; repoPattern: string; refPattern: string };
};

const contract = (): MarketplaceContract => JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/claude-marketplace-contract.json'), 'utf8')) as MarketplaceContract;

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
    manifestUrl: MANIFEST_URL,
    feedUrl: FEED_URL,
    entries: ordered(catalog).map((entry) => feedEntry(catalog, entry)),
  };
}

export function validateMarketplaceManifest(manifest: unknown, root: string): string[] {
  const specification = contract();
  const problems: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be an object'];
  const value = manifest as Record<string, unknown>;
  for (const field of specification.topLevelRequired) if (!(field in value)) problems.push(`manifest.${field} is required`);
  for (const field of Object.keys(value)) if (!specification.topLevelProperties.includes(field)) problems.push(`manifest has unexpected top-level property ${field}`);
  if (value.$schema !== specification.schema) problems.push('manifest.$schema is invalid');
  if (typeof value.name !== 'string' || value.name === '') problems.push('manifest.name must be a non-empty string');
  const owner = value.owner;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) problems.push('manifest.owner must be an object');
  else {
    const ownerValue = owner as Record<string, unknown>;
    for (const field of specification.ownerRequired) if (!(field in ownerValue)) problems.push(`manifest.owner.${field} is required`);
    for (const field of Object.keys(ownerValue)) if (!specification.ownerProperties.includes(field)) problems.push(`manifest.owner has unexpected property ${field}`);
    if (typeof ownerValue.name !== 'string' || ownerValue.name === '') problems.push('manifest.owner.name is required');
  }
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) problems.push('manifest.metadata must be an object');
  else {
    const metadataValue = metadata as Record<string, unknown>;
    for (const field of specification.metadataRequired) if (!(field in metadataValue)) problems.push(`manifest.metadata.${field} is required`);
    for (const field of Object.keys(metadataValue)) if (!specification.metadataProperties.includes(field)) problems.push(`manifest.metadata has unexpected property ${field}`);
    if (typeof metadataValue.description !== 'string' || metadataValue.description === '') problems.push('manifest.metadata.description is required');
  }
  if (!Array.isArray(value.plugins)) return [...problems, 'manifest.plugins must be an array'];
  const names = new Set<string>();
  for (const [index, plugin] of value.plugins.entries()) {
    const location = `manifest.plugins[${index}]`;
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) { problems.push(`${location} must be an object`); continue; }
    const item = plugin as Record<string, unknown>;
    for (const field of specification.pluginRequired) if (!(field in item)) problems.push(`${location}.${field} is required`);
    for (const field of Object.keys(item)) if (!specification.pluginProperties.includes(field)) problems.push(`${location} has unexpected property ${field}`);
    if (typeof item.name !== 'string' || item.name === '') problems.push(`${location}.name is required`);
    else if (names.has(item.name)) problems.push(`${location}.name duplicates ${item.name}`);
    else names.add(item.name);
    const source = item.source;
    if (typeof source === 'string') {
      if (!new RegExp(specification.localSource.pathPattern).test(source)) problems.push(`${location}.source local path must be repository-relative`);
      else {
        const pluginRoot = source.slice(2);
        const metadataPath = join(root, pluginRoot, specification.localSource.metadataPath);
        const skillPath = join(root, pluginRoot, specification.localSource.skillPath.replace('{name}', String(item.name)));
        if (!existsSync(metadataPath)) problems.push(`${location}.source missing ${specification.localSource.metadataPath}: ${source}`);
        else {
          try {
            const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
            for (const field of specification.localSource.metadataRequired) if (typeof metadata[field] !== 'string' || metadata[field] === '') problems.push(`${location}.source plugin.json ${field} is required`);
            if (metadata.name !== item.name) problems.push(`${location}.source plugin.json name must match ${String(item.name)}`);
          } catch { problems.push(`${location}.source plugin.json is invalid JSON: ${source}`); }
        }
        if (!existsSync(skillPath)) problems.push(`${location}.source missing ${specification.localSource.skillPath.replace('{name}', String(item.name))}: ${source}`);
      }
    } else if (source && typeof source === 'object' && !Array.isArray(source)) {
      const github = source as Record<string, unknown>;
      for (const field of specification.githubSource.required) if (!(field in github)) problems.push(`${location}.source.${field} is required`);
      for (const field of Object.keys(github)) if (!specification.githubSource.properties.includes(field)) problems.push(`${location}.source has unexpected property ${field}`);
      if (github.source !== specification.githubSource.source) problems.push(`${location}.source.source must be github`);
      if (typeof github.repo !== 'string' || !new RegExp(specification.githubSource.repoPattern).test(github.repo)) problems.push(`${location}.source.repo is invalid`);
      if (typeof github.ref !== 'string' || !new RegExp(specification.githubSource.refPattern).test(github.ref)) problems.push(`${location}.source.ref must be a lowercase 40-character SHA`);
    } else problems.push(`${location}.source must be a local path or GitHub source`);
  }
  return problems;
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
