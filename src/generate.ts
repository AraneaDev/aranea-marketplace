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
  const problems: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be an object'];
  const value = manifest as Record<string, unknown>;
  if (value.$schema !== CLAUDE_SCHEMA) problems.push('manifest.$schema is invalid');
  if (typeof value.name !== 'string' || value.name === '') problems.push('manifest.name must be a non-empty string');
  const owner = value.owner;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner) || typeof (owner as Record<string, unknown>).name !== 'string') problems.push('manifest.owner.name is required');
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof (metadata as Record<string, unknown>).description !== 'string') problems.push('manifest.metadata.description is required');
  if (!Array.isArray(value.plugins)) return [...problems, 'manifest.plugins must be an array'];
  const names = new Set<string>();
  for (const [index, plugin] of value.plugins.entries()) {
    const at = `manifest.plugins[${index}]`;
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) { problems.push(`${at} must be an object`); continue; }
    const item = plugin as Record<string, unknown>;
    if (typeof item.name !== 'string' || item.name === '') problems.push(`${at}.name is required`);
    else if (names.has(item.name)) problems.push(`${at}.name duplicates ${item.name}`);
    else names.add(item.name);
    const source = item.source;
    if (typeof source === 'string') {
      if (!source.startsWith('./')) problems.push(`${at}.source local path must be repository-relative`);
      else {
        const pluginRoot = source.slice(2);
        const metadataPath = join(root, pluginRoot, '.claude-plugin', 'plugin.json');
        const skillPath = join(root, pluginRoot, 'skills', String(item.name), 'SKILL.md');
        if (!existsSync(metadataPath)) problems.push(`${at}.source missing .claude-plugin/plugin.json: ${source}`);
        else {
          try {
            const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
            for (const field of ['name', 'description', 'version']) if (typeof metadata[field] !== 'string' || metadata[field] === '') problems.push(`${at}.source plugin.json ${field} is required`);
            if (metadata.name !== item.name) problems.push(`${at}.source plugin.json name must match ${String(item.name)}`);
          } catch { problems.push(`${at}.source plugin.json is invalid JSON: ${source}`); }
        }
        if (!existsSync(skillPath)) problems.push(`${at}.source missing skills/${String(item.name)}/SKILL.md: ${source}`);
      }
    } else if (source && typeof source === 'object' && !Array.isArray(source)) {
      const github = source as Record<string, unknown>;
      if (github.source !== 'github') problems.push(`${at}.source.source must be github`);
      if (typeof github.repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github.repo)) problems.push(`${at}.source.repo is invalid`);
      if (typeof github.ref !== 'string' || !/^[0-9a-f]{40}$/.test(github.ref)) problems.push(`${at}.source.ref must be a lowercase 40-character SHA`);
    } else problems.push(`${at}.source must be a local path or GitHub source`);
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
