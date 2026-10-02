import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/catalog.js';

describe('loadCatalog', () => {
  it('loads a local skill and a pinned GitHub plugin while preserving the SHA', () => {
    const catalog = loadCatalog(`
      marketplace: aranea
      entries:
        - id: security-audit
          kind: skill
          install: security-audit
          source:
            type: local
            path: skills/security-audit
          site: { page: security-audit, readme: README.md }
        - id: alpheus
          kind: plugin
          install: alpheus
          source:
            type: github
            repository: AraneaDev/alpheus
            commit: "d6958ba04e6aff488e522a40b4c3f30d37313553"
          site: { page: alpheus, readme: README.md }
    `);

    expect(catalog.marketplace).toBe('aranea');
    expect(catalog.entries[1].source).toEqual({
      type: 'github',
      repository: 'AraneaDev/alpheus',
      commit: 'd6958ba04e6aff488e522a40b4c3f30d37313553',
    });
  });

  it('rejects unknown entry kinds and source types', () => {
    expect(() => loadCatalog(`marketplace: aranea\nentries:\n  - id: x\n    kind: mystery\n    install: x\n    source: { type: nowhere }`)).toThrow(/kind|source/);
  });
});
