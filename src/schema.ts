export type LocalSource = { type: 'local'; path: string };
export type GithubSource = { type: 'github'; repository: string; commit: string };
export type Source = LocalSource | GithubSource;

export type SiteMapping = { page?: string; readme?: string };
export type CatalogEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  install: string;
  source: Source;
  site: SiteMapping;
};

export type Catalog = { marketplace: string; entries: CatalogEntry[] };
export type ValidationProblem = string;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
