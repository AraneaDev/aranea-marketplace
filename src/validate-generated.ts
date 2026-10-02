import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMarketplaceManifest } from './generate.js';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'generated', 'marketplace.json'), 'utf8')) as unknown;
const problems = validateMarketplaceManifest(manifest, root);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Generated marketplace manifest matches the required schema and source layouts.');
}
