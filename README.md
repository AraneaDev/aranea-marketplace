# Aranea marketplace

`catalog.yml` is the only hand-maintained registry. The checked-in files under
`generated/` are deterministic projections of that catalog:

- [marketplace manifest](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/marketplace.json)
- [site feed](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/site-feed.json)
- [README snippets](https://raw.githubusercontent.com/AraneaDev/aranea-marketplace/main/generated/readme-snippets.json)

The manifest and feed URLs above are stable default-branch repository URLs once
this repository is published. They are not CI artifact URLs. CI validates the
catalog, plugin layouts, generated manifest schema, and checked-in output, but
does not publish an expiring replacement for these files.

First-party skills are real Claude plugin roots under `plugins/<id>/`, each with
`.claude-plugin/plugin.json` and `skills/<id>/SKILL.md`. The generated manifest
and feed are derived outputs; edit `catalog.yml` and source plugin files instead.

## README synchronization

Installable `skill` and `plugin` entries may opt into synchronized README
blocks. Site-only entries are intentionally excluded because they do not have
an installation command. The generated region is delimited by:

```text
<!-- aranea-install:start -->
<!-- aranea-install:end -->
```

The synchronization workflow runs validation and a read-only dry-run first.
It does not make GitHub requests locally when credentials are absent. Write
mode requires a GitHub App installation restricted to the repositories named
by the catalog, with these permissions:

- Repository contents: read and write (to read and commit only `README.md` on
  the synchronization branch).
- Pull requests: read and write (to find, create, and reuse one PR per
  repository).
- Metadata: read (GitHub's mandatory repository metadata permission).

Configure the workflow secrets `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`,
and `GITHUB_APP_PRIVATE_KEY`. The App should be installed only on the explicit
catalog repositories. Dry-run mode accepts `GITHUB_TOKEN` or `GH_TOKEN`; with
neither token, every target is reported as inaccessible without a network
request.
