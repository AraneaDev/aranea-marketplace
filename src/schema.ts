export type LocalSource = { type: 'local'; path: string };
export type GithubSource = { type: 'github'; repository: string; commit: string };
export type SiteOnlySource = { type: 'site-only' };
export type Source = LocalSource | GithubSource | SiteOnlySource;

export type Locale = 'en' | 'nl';
export type SiteMapping = {
  page?: string;
  readme?: string;
  locales?: Partial<Record<Locale, string>>;
};
export type InstallationVariants = {
  fallback?: string;
};
export type NonInstallableInstallation = { type: 'non-installable' };
export type CatalogEntry = {
  id: string;
  kind: 'skill' | 'plugin' | 'site';
  install?: string;
  source: Source;
  site: SiteMapping;
  installation?: InstallationVariants | NonInstallableInstallation;
};

export type Catalog = { marketplace: string; entries: CatalogEntry[] };
export type ValidationProblem = string;

// GitHub plugins are emitted as `url` sources rather than the `github` shorthand:
// the shorthand clones over SSH first, which fails on machines without a GitHub
// key or with port 22 blocked. An https URL always clones over HTTPS, and `sha`
// pins the exact commit.
export type MarketplaceSource = string | { source: 'url'; url: string; sha: string };
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
  install?: string;
  display: { page: string; readme: string };
  source: Source;
  version: { pin?: string };
  locales: Record<Locale, string>;
  installation: { marketplace: string; fallback?: string } | NonInstallableInstallation;
};
export type SiteFeed = {
  version: 1;
  marketplace: string;
  marketplaceUrl: string;
  manifestUrl: string;
  feedUrl: string;
  entries: SiteFeedEntry[];
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
