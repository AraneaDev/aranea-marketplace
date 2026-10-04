import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from './catalog.js';
import type { CatalogEntry } from './schema.js';

// Moves each GitHub plugin's pin to the commit of its latest published release.
// Only forward, and only to a commit Claude Code can install, so a scheduled run
// can be merged without a human looking at it.

export type BumpStatus = 'bump' | 'current' | 'skipped';
export type BumpResult = {
  id: string;
  repository: string;
  status: BumpStatus;
  message: string;
  from?: string;
  to?: string;
  tag?: string;
  version?: string;
};

const apiRoot = () => (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');

async function get(path: string, token: string): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`${apiRoot()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { ok: response.ok, status: response.status, body };
}

/** Swaps one entry's pin in the catalog text, leaving every other byte as it was. */
export function replacePin(catalogText: string, repository: string, from: string, to: string): string {
  const needle = `repository: ${repository}, commit: "${from}"`;
  if (catalogText.split(needle).length !== 2) throw new Error(`expected exactly one "${needle}" in catalog.yml`);
  return catalogText.replace(needle, `repository: ${repository}, commit: "${to}"`);
}

export async function findBump(entry: CatalogEntry, token: string): Promise<BumpResult> {
  if (entry.source.type !== 'github') throw new Error(`${entry.id} is not a GitHub plugin`);
  const { repository, commit: from } = entry.source;
  const base = { id: entry.id, repository };
  const skipped = (message: string): BumpResult => ({ ...base, status: 'skipped', message });

  // releases/latest already leaves out drafts and pre-releases.
  const release = await get(`/repos/${repository}/releases/latest`, token);
  if (!release.ok || typeof release.body?.tag_name !== 'string') return skipped(`no published release (HTTP ${release.status})`);
  const tag: string = release.body.tag_name;

  const tagged = await get(`/repos/${repository}/commits/${encodeURIComponent(tag)}`, token);
  if (!tagged.ok || !/^[0-9a-f]{40}$/.test(tagged.body?.sha ?? '')) return skipped(`could not resolve ${tag} to a commit (HTTP ${tagged.status})`);
  const to: string = tagged.body.sha;
  if (to === from) return { ...base, status: 'current', message: `already at ${tag}` };

  const compare = await get(`/repos/${repository}/compare/${from}...${to}`, token);
  if (!compare.ok) return skipped(`could not compare the pin with ${tag} (HTTP ${compare.status})`);
  if (compare.body?.status !== 'ahead') return skipped(`${tag} is ${compare.body?.status ?? 'unrelated to'} the pinned commit; not moving it`);

  const manifest = await get(`/repos/${repository}/contents/.claude-plugin/plugin.json?ref=${to}`, token);
  if (!manifest.ok || typeof manifest.body?.content !== 'string') return skipped(`${tag} has no .claude-plugin/plugin.json (HTTP ${manifest.status})`);
  let version: unknown;
  try { version = JSON.parse(Buffer.from(manifest.body.content, 'base64').toString('utf8')).version; } catch { version = undefined; }
  if (typeof version !== 'string' || version === '') return skipped(`${tag} has a plugin.json without a version`);

  return { ...base, status: 'bump', from, to, tag, version, message: `${tag} (${to.slice(0, 7)}), version ${version}` };
}

/** The pull request body: one row per bump. */
export function renderSummary(results: BumpResult[]): string {
  const rows = results
    .filter((result) => result.status === 'bump')
    .map((result) => `| ${result.id} | [${result.tag}](https://github.com/${result.repository}/releases/tag/${result.tag}) | ${result.version} | \`${result.from!.slice(0, 7)}\` → \`${result.to!.slice(0, 7)}\` |`);
  return [
    'Moves plugin pins to the commit of each plugin\'s latest published release.',
    '',
    '| Plugin | Release | Version | Commit |',
    '|---|---|---|---|',
    ...rows,
    '',
    'Opened by the scheduled `Bump plugin pins` workflow. Each new commit is ahead of the old pin and carries `.claude-plugin/plugin.json`; this merges itself once `validate` passes.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const root = process.cwd();
  const path = join(root, 'catalog.yml');
  let text = readFileSync(path, 'utf8');
  const targets = loadCatalog(text).entries.filter((entry) => entry.kind === 'plugin' && entry.source.type === 'github');
  const results = await Promise.all(targets.map((entry) => findBump(entry, token)));
  for (const result of results) console.log(`${result.status}\t${result.repository}\t${result.message}`);

  const bumps = results.filter((result) => result.status === 'bump');
  if (process.argv.includes('--write') && bumps.length > 0) {
    for (const bump of bumps) text = replacePin(text, bump.repository, bump.from!, bump.to!);
    writeFileSync(path, text);
  }
  const summaryPath = process.env.BUMP_SUMMARY;
  if (summaryPath && bumps.length > 0) writeFileSync(summaryPath, renderSummary(results));
}

if (process.argv[1]?.endsWith('bump-pins.ts')) await main();
