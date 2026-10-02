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
