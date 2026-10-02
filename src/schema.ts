export type LocalSource = { type: 'local'; path: string };
export type GithubSource = { type: 'github'; repository: string; commit: string };
export type Source = LocalSource | GithubSource;

export type Locale = 'en' | 'nl';
export type SiteMapping = {
  page?: string;
  readme?: string;
  locales?: Partial<Record<Locale, string>>;
};
export type InstallationVariants = {
  fallback?: string;
};
export type CatalogEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  install: string;
  source: Source;
  site: SiteMapping;
  installation?: InstallationVariants;
};

export type Catalog = { marketplace: string; entries: CatalogEntry[] };
export type ValidationProblem = string;

export type MarketplaceSource = string | { source: 'github'; repo: string; ref: string };
export type MarketplaceManifest = {
  $schema: string;
  name: string;
  owner: { name: string };
  metadata: { description: string };
  plugins: Array<{ name: string; source: MarketplaceSource }>;
};

export type SiteFeedEntry = {
  id: string;
  kind: CatalogEntry['kind'];
  install: string;
  display: { page: string; readme: string };
  source: Source;
  version: { pin?: string };
  locales: Record<Locale, string>;
  installation: { marketplace: string; fallback?: string };
};
export type SiteFeed = {
  version: 1;
  marketplace: string;
  marketplaceUrl: string;
  entries: SiteFeedEntry[];
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
