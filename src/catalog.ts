import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import type { Catalog, CatalogEntry, GithubSource, LocalSource, Source, ValidationProblem } from './schema.js';
import { isRecord } from './schema.js';

const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value;
}

export function loadCatalog(text: string): Catalog {
  let raw: unknown;
  try { raw = parse(text); } catch (error) { throw new Error(`catalog YAML is invalid: ${String(error)}`); }
  if (!isRecord(raw)) throw new Error('catalog must be an object');
  const marketplace = requiredString(raw.marketplace, 'marketplace');
  if (!Array.isArray(raw.entries)) throw new Error('entries must be an array');
  const entries: CatalogEntry[] = raw.entries.map((value, index) => {
    const at = `entries[${index}]`;
    if (!isRecord(value)) throw new Error(`${at} must be an object`);
    const kind = requiredString(value.kind, `${at}.kind`);
    if (kind !== 'skill' && kind !== 'plugin' && kind !== 'site') throw new Error(`${at}.kind unknown entry kind: ${kind}`);
    const sourceValue = value.source;
    if (!isRecord(sourceValue)) throw new Error(`${at}.source must be an object`);
    const sourceType = requiredString(sourceValue.type, `${at}.source.type`);
    let source: Source;
    if (sourceType === 'local') {
      source = { type: 'local', path: requiredString(sourceValue.path, `${at}.source.path`) };
    } else if (sourceType === 'github') {
      source = {
        type: 'github',
        repository: requiredString(sourceValue.repository, `${at}.source.repository`).replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, ''),
        commit: requiredString(sourceValue.commit, `${at}.source.commit`),
      };
    } else if (sourceType === 'site-only') {
      source = { type: 'site-only' };
    } else throw new Error(`${at}.source.type unknown source type: ${sourceType}`);
    const site = isRecord(value.site) ? {
      page: typeof value.site.page === 'string' ? value.site.page : undefined,
      readme: typeof value.site.readme === 'string' ? value.site.readme : undefined,
      locales: isRecord(value.site.locales) ? {
        en: typeof value.site.locales.en === 'string' ? value.site.locales.en : undefined,
        nl: typeof value.site.locales.nl === 'string' ? value.site.locales.nl : undefined,
      } : undefined,
    } : {};
    const installation = isRecord(value.installation)
      ? value.installation.type === 'non-installable'
        ? { type: 'non-installable' as const }
        : typeof value.installation.fallback === 'string'
          ? { fallback: value.installation.fallback }
          : {}
      : undefined;
    const install = typeof value.install === 'string' ? value.install : undefined;
    return { id: requiredString(value.id, `${at}.id`), kind, install, source, site, installation };
  });
  return { marketplace, entries };
}

export function validateCatalog(catalog: Catalog, root: string): ValidationProblem[] {
  const problems: string[] = [];
  const ids = new Map<string, string>();
  const installs = new Map<string, string>();
  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) problems.push(`${entry.id}.id duplicates ${ids.get(entry.id)}`); else ids.set(entry.id, entry.id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) problems.push(`${entry.id}.id must be lowercase kebab-case`);
    if (!entry.site.page) problems.push(`${entry.id}.site.page is missing`);
    if (!entry.site.readme) problems.push(`${entry.id}.site.readme is missing`);
    if (entry.kind === 'site') {
      if (entry.install !== undefined) problems.push(`${entry.id}.install is not allowed for site-only entries`);
      if (entry.source.type !== 'site-only') problems.push(`${entry.id}.source must be site-only`);
      if (!entry.installation || !('type' in entry.installation) || entry.installation.type !== 'non-installable') problems.push(`${entry.id}.installation must be non-installable`);
      if (!entry.site.locales?.nl || !entry.site.locales.en) problems.push(`${entry.id}.site.locales must include Dutch and English routes`);
      else {
        if (entry.site.locales.nl !== `/tools/${entry.site.page}`) problems.push(`${entry.id}.site.locales.nl must be /tools/${entry.site.page}`);
        if (entry.site.locales.en !== `/en/tools/${entry.site.page}`) problems.push(`${entry.id}.site.locales.en must be /en/tools/${entry.site.page}`);
      }
    } else {
      if (!entry.install) problems.push(`${entry.id}.install is missing`);
      else if (installs.has(entry.install)) problems.push(`${entry.id}.install duplicates ${installs.get(entry.install)}`); else installs.set(entry.install, entry.id);
      if (entry.install && !/^[a-z0-9][a-z0-9-]*$/.test(entry.install)) problems.push(`${entry.id}.install must be lowercase kebab-case`);
      if (entry.installation && 'type' in entry.installation && entry.installation.type === 'non-installable') problems.push(`${entry.id}.installation cannot be non-installable`);
      if (entry.kind === 'skill' && entry.source.type !== 'local') problems.push(`${entry.id}.kind skill requires local source`);
      if (entry.kind === 'plugin' && entry.source.type !== 'github') problems.push(`${entry.id}.kind plugin requires github source`);
    }
    if (entry.source.type === 'local') validateLocal(entry, root, problems);
    else if (entry.source.type === 'github') validateGithub(entry, problems);
  }
  return problems;
}

function validateLocal(entry: CatalogEntry, root: string, problems: string[]) {
  const source = entry.source as LocalSource;
  const expectedPath = `plugins/${entry.id}`;
  if (source.path !== expectedPath) problems.push(`${entry.id}.source.path must be ${expectedPath}: ${source.path}`);
  const pluginFile = join(root, source.path, '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginFile)) problems.push(`${entry.id}.source.path missing .claude-plugin/plugin.json: ${source.path}`);
  else {
    try {
      const metadata = JSON.parse(readFileSync(pluginFile, 'utf8')) as Record<string, unknown>;
      for (const field of ['name', 'description', 'version']) if (typeof metadata[field] !== 'string' || metadata[field] === '') problems.push(`${entry.id}.plugin.json ${field} must be a non-empty string`);
      if (metadata.name !== entry.install) problems.push(`${entry.id}.plugin.json name must be ${entry.install}`);
    } catch { problems.push(`${entry.id}.source.path plugin.json is invalid JSON: ${source.path}`); }
  }
  const skillFile = join(root, source.path, 'skills', entry.id, 'SKILL.md');
  if (!existsSync(skillFile)) problems.push(`${entry.id}.source.path missing skills/${entry.id}/SKILL.md: ${source.path}`);
  if (entry.site.readme && !/^https?:\/\//.test(entry.site.readme) && !existsSync(resolve(root, entry.site.readme))) problems.push(`${entry.id}.site.readme target does not exist: ${entry.site.readme}`);
}

function validateGithub(entry: CatalogEntry, problems: string[]) {
  const source = entry.source as GithubSource;
  if (!REPOSITORY.test(source.repository)) problems.push(`${entry.id}.source.repository is not a GitHub owner/name: ${source.repository}`);
  if (!SHA.test(source.commit)) problems.push(`${entry.id}.source.commit must be a lowercase 40-character SHA`);
  if (entry.site.readme && !/^https?:\/\//.test(entry.site.readme)) problems.push(`${entry.id}.site.readme must be a URL for GitHub entries`);
}

export function readCatalog(root = process.cwd()): Catalog {
  return loadCatalog(readFileSync(join(root, 'catalog.yml'), 'utf8'));
}

if (process.argv[1]?.endsWith('catalog.ts')) {
  const root = process.cwd();
  const catalog = readCatalog(root);
  const problems = validateCatalog(catalog, root);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else if (process.argv.includes('--generate')) {
    const { generateArtifacts } = await import('./generate.js');
    generateArtifacts(catalog, root);
    console.log(`Generated artifacts for ${catalog.entries.length} catalog entries.`);
  }
  else console.log(`Validated ${catalog.entries.length} catalog entries.`);
}
