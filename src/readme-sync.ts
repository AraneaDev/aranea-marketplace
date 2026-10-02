import { createPrivateKey, createSign } from 'node:crypto';
import { readCatalog } from './catalog.js';
import { generateSiteFeed } from './generate.js';
import { renderInstallBlock } from './readme-snippets.js';
import type { CatalogEntry } from './schema.js';

export type MarkerErrorCode =
  | 'missing-start'
  | 'missing-end'
  | 'duplicate-start'
  | 'duplicate-end'
  | 'nested'
  | 'end-before-start';

export type MarkerResult = {
  valid: true;
  startIndex: number;
  endIndex: number;
  endExclusive: number;
  startMarker: string;
  endMarker: string;
} | {
  valid: false;
  error: { code: MarkerErrorCode; message: string };
  startCount: number;
  endCount: number;
};

export class MarkerInspectionError extends Error {
  readonly result: Extract<MarkerResult, { valid: false }>;

  constructor(result: Extract<MarkerResult, { valid: false }>) {
    super(result.error.message);
    this.name = 'MarkerInspectionError';
    this.result = result;
  }
}

function markers(marker: string): { start: string; end: string } {
  const name = marker.replace(/^<!--\s*|\s*-->$/g, '').trim();
  if (!name) throw new TypeError('marker must be a non-empty name');
  return { start: `<!-- ${name}:start -->`, end: `<!-- ${name}:end -->` };
}

function positions(text: string, needle: string): number[] {
  const result: number[] = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    result.push(index);
    from = index + needle.length;
  }
  return result;
}

export function inspectInstallMarkers(readme: string, marker: string): MarkerResult {
  const { start, end } = markers(marker);
  const starts = positions(readme, start);
  const ends = positions(readme, end);
  if (starts.length === 0) return { valid: false, error: { code: 'missing-start', message: `missing ${start}` }, startCount: 0, endCount: ends.length };
  if (ends.length === 0) return { valid: false, error: { code: 'missing-end', message: `missing ${end}` }, startCount: starts.length, endCount: 0 };
  if (starts[0] > ends[0]) return { valid: false, error: { code: 'end-before-start', message: `${end} appears before ${start}` }, startCount: starts.length, endCount: ends.length };
  if (starts.length > 1 && starts[1] < ends[0]) return { valid: false, error: { code: 'nested', message: `nested ${start} markers` }, startCount: starts.length, endCount: ends.length };
  if (starts.length > 1) return { valid: false, error: { code: 'duplicate-start', message: `expected one ${start}, found ${starts.length}` }, startCount: starts.length, endCount: ends.length };
  if (ends.length > 1 && ends[1] < readme.length && (starts.length === 1 && ends[1] > starts[0])) {
    if (starts[0] < ends[0]) return { valid: false, error: { code: 'duplicate-end', message: `expected one ${end}, found ${ends.length}` }, startCount: starts.length, endCount: ends.length };
  }
  return { valid: true, startIndex: starts[0], endIndex: ends[0], endExclusive: ends[0] + end.length, startMarker: start, endMarker: end };
}

export function replaceInstallBlock(readme: string, marker: string, rendered: string): string {
  const result = inspectInstallMarkers(readme, marker);
  if (!result.valid) throw new MarkerInspectionError(result);
  return readme.slice(0, result.startIndex) + rendered + readme.slice(result.endExclusive);
}

export type SyncStatus = 'changed' | 'unchanged' | 'missing-markers' | 'inaccessible' | 'invalid';
export type SyncResult = {
  repository: string;
  entry: string;
  status: SyncStatus;
  changed: boolean;
  message: string;
  pullRequestUrl?: string;
};

type GithubResponse = { response: Response; body: any };

const apiRoot = () => (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
const token = () => process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const headers = (value: string) => ({ Authorization: `Bearer ${value}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

async function githubRequest(path: string, init: RequestInit, auth: string): Promise<GithubResponse> {
  const response = await fetch(`${apiRoot()}${path}`, { ...init, headers: { ...headers(auth), ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { response, body };
}

async function appToken(): Promise<string | undefined> {
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!appId || !installationId || !privateKey) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })).toString('base64url');
  const signing = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signing);
  const jwt = `${signing}.${signer.sign(createPrivateKey(privateKey)).toString('base64url')}`;
  const response = await fetch(`${apiRoot()}/app/installations/${installationId}/access_tokens`, { method: 'POST', headers: headers(jwt) });
  if (!response.ok) return undefined;
  const body = await response.json() as { token?: string };
  return body.token;
}

function result(repository: string, entry: CatalogEntry, status: SyncStatus, message: string, changed = status === 'changed'): SyncResult {
  return { repository, entry: entry.id, status, changed, message };
}

function readmeUrl(repository: string): string { return `/repos/${repository}/readme`; }
function branchName(repository: string): string {
  return `aranea/marketplace-readme/${repository.replace(/[^A-Za-z0-9_.-]+/g, '-')}`;
}

export async function syncRepository(repository: string, entry: CatalogEntry, mode: 'dry-run' | 'write'): Promise<SyncResult> {
  if (entry.kind === 'site' || !entry.install) return result(repository, entry, 'invalid', 'site-only or non-installable catalog entry cannot produce an install block', false);
  if (entry.source.type !== 'github' || entry.source.repository !== repository) return result(repository, entry, 'invalid', 'repository is not the explicitly cataloged GitHub source', false);
  const auth = mode === 'dry-run' ? token() : await appToken();
  if (!auth) return result(repository, entry, 'inaccessible', mode === 'dry-run' ? 'GitHub token is not configured; no request made' : 'GitHub App credentials are not configured; no request made', false);
  let readme: GithubResponse;
  try { readme = await githubRequest(readmeUrl(repository), {}, auth); } catch (error) { return result(repository, entry, 'inaccessible', `README could not be fetched: ${String(error)}`, false); }
  if (!readme.response.ok || typeof readme.body?.content !== 'string') return result(repository, entry, 'inaccessible', `README request failed with HTTP ${readme.response.status}`, false);
  const text = Buffer.from(readme.body.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const inspected = inspectInstallMarkers(text, 'aranea-install');
  if (!inspected.valid) return result(repository, entry, 'missing-markers', inspected.error.message, false);
  const rendered = renderInstallBlock(entry, generateSiteFeed({ marketplace: 'aranea', entries: [entry] }));
  const updated = replaceInstallBlock(text, 'aranea-install', rendered);
  if (updated === text) return result(repository, entry, 'unchanged', 'README install block is already current', false);
  if (mode === 'dry-run') return result(repository, entry, 'changed', 'README install block would change in a pull request');

  const branch = branchName(repository);
  const repoInfo = await githubRequest(`/repos/${repository}`, {}, auth);
  if (!repoInfo.response.ok || typeof repoInfo.body?.default_branch !== 'string') return result(repository, entry, 'inaccessible', `repository metadata request failed with HTTP ${repoInfo.response.status}`, false);
  const base = repoInfo.body.default_branch as string;
  const baseRef = await githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(base)}`, {}, auth);
  if (!baseRef.response.ok || typeof baseRef.body?.object?.sha !== 'string') return result(repository, entry, 'inaccessible', `default branch ref request failed with HTTP ${baseRef.response.status}`, false);
  const existingRef = await githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, {}, auth);
  if (existingRef.response.status === 404) {
    const created = await githubRequest(`/repos/${repository}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.body.object.sha }) }, auth);
    if (!created.response.ok) return result(repository, entry, 'inaccessible', `branch creation failed with HTTP ${created.response.status}`, false);
  } else if (!existingRef.response.ok) return result(repository, entry, 'inaccessible', `branch lookup failed with HTTP ${existingRef.response.status}`, false);
  const contents = await githubRequest(`${readmeUrl(repository)}?ref=${encodeURIComponent(branch)}`, {}, auth);
  if (!contents.response.ok || typeof contents.body?.sha !== 'string') return result(repository, entry, 'inaccessible', `branch README request failed with HTTP ${contents.response.status}`, false);
  const update = await githubRequest(readmeUrl(repository), { method: 'PUT', body: JSON.stringify({ message: 'docs: synchronize marketplace install block', content: Buffer.from(updated).toString('base64'), sha: contents.body.sha, branch }) }, auth);
  if (!update.response.ok) return result(repository, entry, 'inaccessible', `README update failed with HTTP ${update.response.status}`, false);
  const pulls = await githubRequest(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${repository.split('/')[0]}:${branch}`)}&base=${encodeURIComponent(base)}`, {}, auth);
  if (!pulls.response.ok) return result(repository, entry, 'inaccessible', `pull request lookup failed with HTTP ${pulls.response.status}`, true);
  let pull = Array.isArray(pulls.body) ? pulls.body[0] : undefined;
  if (!pull) {
    const created = await githubRequest(`/repos/${repository}/pulls`, { method: 'POST', body: JSON.stringify({ title: 'docs: synchronize marketplace install block', head: branch, base, body: 'Automated update of the Aranea marketplace install block.' }) }, auth);
    if (!created.response.ok) return result(repository, entry, 'inaccessible', `pull request creation failed with HTTP ${created.response.status}`, true);
    pull = created.body;
  }
  return { ...result(repository, entry, 'changed', 'README updated and pull request created or reused'), pullRequestUrl: pull?.html_url };
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--mode=write') ? 'write' : 'dry-run';
  const catalog = readCatalog(process.cwd());
  const targets = catalog.entries.filter((entry) => entry.kind !== 'site' && entry.source.type === 'github');
  const results = await Promise.all(targets.map((entry) => syncRepository(entry.source.type === 'github' ? entry.source.repository : '', entry, mode)));
  for (const item of results) console.log(`${item.status}\t${item.repository}\t${item.message}`);
  if (mode === 'write' && results.some((item) => item.status === 'inaccessible' || item.status === 'missing-markers')) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('readme-sync.ts')) await main();
