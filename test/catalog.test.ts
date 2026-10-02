import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { loadCatalog, validateCatalog } from '../src/catalog.js';

const valid = (overrides = '') => loadCatalog(`
marketplace: aranea
entries:
  - id: local-skill
    kind: skill
    install: local-skill
    source: { type: local, path: plugins/local-skill }
    site: { page: local-skill, readme: README.md }
  - id: github-plugin
    kind: plugin
    install: github-plugin
    source: { type: github, repository: AraneaDev/example, commit: "0123456789abcdef0123456789abcdef01234567" }
    site: { page: github-plugin, readme: https://github.com/AraneaDev/example#readme }
${overrides}`);

let root: string;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe('validateCatalog', () => {
  it('accepts valid local and pinned GitHub entries', () => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    mkdirSync(join(root, 'plugins/local-skill/.claude-plugin'), { recursive: true });
    mkdirSync(join(root, 'plugins/local-skill/skills/local-skill'), { recursive: true });
    writeFileSync(join(root, 'plugins/local-skill/.claude-plugin/plugin.json'), JSON.stringify({ name: 'local-skill', description: 'test', version: '0.1.0' }));
    writeFileSync(join(root, 'plugins/local-skill/skills/local-skill/SKILL.md'), '# skill');
    writeFileSync(join(root, 'README.md'), '# readme');
    expect(validateCatalog(valid(), root)).toEqual([]);
  });

  it.each([
    ['an installable source', `source: { type: local, path: plugins/argos-mcp }\n          installation: { type: non-installable }`, /argos-mcp.*source/],
    ['an installable installation', `source: { type: site-only }\n          installation: { fallback: nope }`, /argos-mcp.*installation/],
  ])('rejects a site-only entry with %s', (_name, shape, pattern) => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    const catalog = loadCatalog(`
      marketplace: aranea
      entries:
        - id: argos-mcp
          kind: site
          site:
            page: argos-mcp
            readme: https://github.com/AraneaDev/Argos-MCP#readme
            locales: { nl: /tools/argos-mcp, en: /en/tools/argos-mcp }
          ${shape}
    `);
    expect(validateCatalog(catalog, root).join('\n')).toMatch(pattern);
  });

  it.each([
    ['source', `source: { type: site-only, repository: AraneaDev/Argos-MCP }\n          installation: { type: non-installable }`, /source.*unknown.*repository/],
    ['installation', `source: { type: site-only }\n          installation: { type: non-installable, fallback: forbidden }`, /installation.*unknown.*fallback/],
  ])('rejects unknown keys in a site-only %s object', (_name, shape, pattern) => {
    expect(() => loadCatalog(`
      marketplace: aranea
      entries:
        - id: argos-mcp
          kind: site
          site:
            page: argos-mcp
            readme: https://github.com/AraneaDev/Argos-MCP#readme
            locales: { nl: /tools/argos-mcp, en: /en/tools/argos-mcp }
          ${shape}
    `)).toThrow(pattern);
  });

  it.each([
    ['duplicate id', `  - id: local-skill\n    kind: skill\n    install: other\n    source: { type: local, path: plugins/local-skill }\n    site: { page: other, readme: README.md }`],
    ['duplicate install name', `  - id: other\n    kind: skill\n    install: local-skill\n    source: { type: local, path: plugins/local-skill }\n    site: { page: other, readme: README.md }`],
  ])('reports %s with the entry and field', (_name, extra) => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    const problems = validateCatalog(valid(`\n${extra}`), root);
    expect(problems.join('\n')).toMatch(/local-skill/);
    expect(problems.join('\n')).toMatch(/id|install/);
  });

  it.each([
    ['missing SKILL.md', (catalog: ReturnType<typeof valid>, dir: string) => { mkdirSync(join(dir, 'plugins/local-skill/.claude-plugin'), { recursive: true }); writeFileSync(join(dir, 'plugins/local-skill/.claude-plugin/plugin.json'), JSON.stringify({ name: 'local-skill', description: 'test', version: '0.1.0' })); return catalog; }, /local-skill.*SKILL\.md/],
    ['malformed repository', (catalog: ReturnType<typeof valid>) => { catalog.entries[1].source = { type: 'github', repository: 'bad/repo/extra', commit: '0123456789abcdef0123456789abcdef01234567' }; return catalog; }, /github-plugin.*repository/],
    ['uppercase SHA', (catalog: ReturnType<typeof valid>) => { (catalog.entries[1].source as any).commit = '0123456789ABCDEF0123456789ABCDEF01234567'; return catalog; }, /github-plugin.*commit/],
    ['short SHA', (catalog: ReturnType<typeof valid>) => { (catalog.entries[1].source as any).commit = '0123456'; return catalog; }, /github-plugin.*commit/],
    ['missing site mapping', (catalog: ReturnType<typeof valid>) => { delete catalog.entries[0].site.page; return catalog; }, /local-skill.*site\.page/],
    ['missing README target', (catalog: ReturnType<typeof valid>, dir: string) => { mkdirSync(join(dir, 'plugins/local-skill/.claude-plugin'), { recursive: true }); mkdirSync(join(dir, 'plugins/local-skill/skills/local-skill'), { recursive: true }); writeFileSync(join(dir, 'plugins/local-skill/.claude-plugin/plugin.json'), JSON.stringify({ name: 'local-skill', description: 'test', version: '0.1.0' })); writeFileSync(join(dir, 'plugins/local-skill/skills/local-skill/SKILL.md'), '# skill'); return catalog; }, /local-skill.*readme/],
  ])('reports %s', (_name, mutate, pattern) => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    const problems = validateCatalog(mutate(valid(), root), root);
    expect(problems.join('\n')).toMatch(pattern);
  });

  it('rejects a local source that escapes the entry skill directory', () => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    writeFileSync(join(root, 'README.md'), '# readme');
    mkdirSync(join(root, 'plugins/other-skill'), { recursive: true });
    writeFileSync(join(root, 'plugins/other-skill/SKILL.md'), '# other skill');
    const catalog = valid();
    catalog.entries[0].source = { type: 'local', path: 'plugins/local-skill/../other-skill' };
    const problems = validateCatalog(catalog, root);
    expect(problems.join('\n')).toMatch(/local-skill.*source\.path/);
  });

  it('rejects a skill backed by GitHub so generation cannot receive plugin-only fields', () => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    writeFileSync(join(root, 'README.md'), '# readme');
    mkdirSync(join(root, 'plugins/local-skill/skills/local-skill'), { recursive: true });
    writeFileSync(join(root, 'plugins/local-skill/skills/local-skill/SKILL.md'), '# skill');
    const catalog = valid();
    catalog.entries[0].source = { type: 'github', repository: 'AraneaDev/example', commit: '0123456789abcdef0123456789abcdef01234567' };
    const problems = validateCatalog(catalog, root);
    expect(problems.join('\n')).toMatch(/local-skill.*kind.*local/);
  });

  it('rejects a plugin backed by a local skill', () => {
    root = mkdtempSync(join(tmpdir(), 'aranea-marketplace-'));
    writeFileSync(join(root, 'README.md'), '# readme');
    mkdirSync(join(root, 'plugins/local-skill/skills/local-skill'), { recursive: true });
    writeFileSync(join(root, 'plugins/local-skill/skills/local-skill/SKILL.md'), '# skill');
    const catalog = valid();
    catalog.entries[1].source = { type: 'local', path: 'plugins/local-skill' };
    const problems = validateCatalog(catalog, root);
    expect(problems.join('\n')).toMatch(/github-plugin.*kind.*github/);
  });
});
