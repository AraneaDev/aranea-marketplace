<div align="center">

# Aranea marketplace

**The web every Aranea plugin hangs from.**
**One catalog, from which the install manifest, the site and every install block are spun.**

[![Validate](https://img.shields.io/github/actions/workflow/status/AraneaDev/aranea-marketplace/validate.yml?label=validate)](https://github.com/AraneaDev/aranea-marketplace/actions/workflows/validate.yml)
[![Pin bump](https://img.shields.io/github/actions/workflow/status/AraneaDev/aranea-marketplace/bump-pins.yml?label=pin%20bump)](https://github.com/AraneaDev/aranea-marketplace/actions/workflows/bump-pins.yml)
[![Site](https://img.shields.io/badge/site-aranea--development.nl-0b7285)](https://aranea-development.nl/en/tools)
[![License](https://img.shields.io/github/license/AraneaDev/aranea-marketplace?label=license&color=yellow)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/AraneaDev/aranea-marketplace?label=last%20commit)](https://github.com/AraneaDev/aranea-marketplace/commits/main)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org/)

</div>

> **Aranea** is Latin for a spider, and for the web it spins. A web is one
> thread laid down once and held under tension everywhere it is anchored: pull
> one strand and the whole of it answers.

That is the whole design. One file is written by hand, and everything that tells
somebody how to install an Aranea plugin is drawn from it.

**TL;DR:** `catalog.yml` lists every plugin, skill and site-only tool. From it come the Claude
Code marketplace manifest, the feed the Aranea site builds its install blocks from, and the
install block in each plugin's README. A scheduled workflow moves each plugin's pin to its
latest release and merges the change once validation passes.

## Install

```sh
claude plugin marketplace add https://github.com/AraneaDev/aranea-marketplace
claude plugin install <name>@aranea
```

What there is to install, and what each one does, is on the site:
[tools](https://aranea-development.nl/en/tools) and
[skills](https://aranea-development.nl/en/skills). It is not listed here, because a second
copy of the catalog is the copy that goes stale.

Every GitHub plugin is listed as an `https` git URL pinned to a commit, so Claude Code clones
it over HTTPS at exactly that commit. It needs no SSH key and does not care whether port 22
is open.

## What it holds

Three kinds of entry, each with its own place:

- **Plugins** live in their own repositories. The catalog names the repository and pins the
  commit of a release.
- **Skills** live here, under `plugins/<id>/`. Each is a real plugin root, with
  `.claude-plugin/plugin.json` and `skills/<id>/SKILL.md`, and installs from this
  repository's `main`.
- **Site-only tools** are things you open or run rather than install, such as the MCP
  servers. They appear in the site feed and nowhere else.

## What is generated

`catalog.yml` is the only file edited by hand. `npm run generate` writes the rest, and CI
fails if the checked-in copies differ from what the catalog produces:

| File | Read by |
|---|---|
| [`generated/marketplace.json`](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/marketplace.json), mirrored to `.claude-plugin/marketplace.json` | Claude Code |
| [`generated/site-feed.json`](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/site-feed.json) | the Aranea site, on every build |
| [`generated/readme-snippets.json`](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/readme-snippets.json) | the README synchronization |

These are the default-branch URLs, and they are stable. The site fetches the feed when it
builds and refuses to build on a feed it cannot fetch or validate, so it never falls back to
a stale copy.

## Pins follow releases

Every six hours, `Bump plugin pins` looks up the latest published release of each GitHub
plugin. Drafts and pre-releases do not count. A pin moves only when all of this holds:

- the release commit is ahead of the current pin, so a re-tag or a force-push never moves it
  backwards or sideways;
- the commit carries `.claude-plugin/plugin.json` with a version, so Claude Code can install
  it.

Every move goes into one pull request, `bump/plugin-pins`, which merges itself once
`validate` passes. Nothing in the plugin repositories has to know this happens, and a
repository added to the catalog is covered from its first release. The version Claude Code
shows comes from the plugin's own `plugin.json` at the pinned commit, so it moves with the
pin.

The workflow runs as a GitHub App, because a pull request opened with the workflow's own token
triggers no other workflow, and `validate` would never report. The App needs contents and pull
requests write access on this repository. Its credentials live in the `marketplace-pin-bump`
environment as `PIN_BUMP_APP_ID` and `PIN_BUMP_APP_PRIVATE_KEY`. That environment has no
required reviewers, so a run can finish on its own, and only deploys from protected branches.

## README install blocks

Each plugin README carries its install block between two markers:

```text
<!-- aranea-install:start -->
<!-- aranea-install:end -->
```

`Synchronize marketplace READMEs` keeps what sits between them equal to the generated
snippet. It never touches anything outside the markers, and it never writes without
somebody saying so:

- A push to `main` that changes the catalog or the snippets runs a dry-run and reports which
  READMEs would change. That makes no write.
- A manual run with `approve: true`, approved on the protected `marketplace-readme-sync`
  environment, opens one pull request per README that differs, and reuses it on the next
  run.

Write mode signs in as a GitHub App installed only on the cataloged repositories, with
contents and pull requests write access. Its credentials are the `README_SYNC_APP_ID`,
`README_SYNC_APP_INSTALLATION_ID` and `README_SYNC_APP_PRIVATE_KEY` secrets on that
environment. GitHub rejects secret names that start with `GITHUB_`, which is why they do
not. Site-only entries have no install command, and no block.

## Adding an entry

A plugin in its own repository:

1. Add a `kind: plugin` entry with `source: { type: github, repository: …, commit: "…" }`,
   pinned to the commit of a release.
2. Give it both site routes, `/tools/<id>` and `/en/tools/<id>`.
3. Put the install markers in its README, and install the README App on the repository.

A skill that lives here:

1. Add `plugins/<id>/.claude-plugin/plugin.json` and `plugins/<id>/skills/<id>/SKILL.md`.
2. Add a `kind: skill` entry with `source: { type: local, path: plugins/<id> }` and both
   `/skills/<id>` routes.

A site-only tool takes `kind: site`, `source: { type: site-only }`, no `install`, and
`installation: { type: non-installable }`.

Then run `npm run generate`, commit the catalog and what it generated together, and open a
pull request.

The site needs the entry's pages, in Dutch and English, at the routes the catalog names. Its
build checks both ways: an entry without its pages fails it, and so does a page without an
entry. Merge the catalog first, then add the pages and publish. The site only builds when it
is published, so nothing breaks in between.

## Development

```sh
npm ci
npm test                   # vitest
npm run typecheck
npm run validate           # the catalog and every local plugin layout
npm run generate           # rewrite generated/ from catalog.yml
npm run validate:manifest  # the manifest against Claude Code's marketplace contract
```

Generated files are never edited by hand. Change `catalog.yml` or the plugin sources and
regenerate.

## License

MIT. Each plugin carries its own license in its own repository.

---

Built by [Tim Schipper](https://tim-schipper.nl/en) and released as open source under
[Aranea Development](https://aranea-development.nl).
