# TailorKit documentation

This directory contains the TailorKit documentation site. Edit pages in MDX and configure navigation, branding, and site settings in `docs.json`.

## Preview the site

Install dependencies from the repository root, then start the local preview:

```sh
pnpm install
pnpm dev:docs
```

Open the URL printed by the Mintlify CLI. The default is [localhost:3000](http://localhost:3000).

## Edit a page

Use the existing sections to choose where a page belongs:

- `getting-started/`: introduce TailorKit and integrate it into a host product
- `concepts/`: explain slots, views, components, and tools
- `writing-apps/`: create apps against a host contract

Give each page a `title` and `description` in its YAML frontmatter. Use sentence case for headings and root-relative internal links without file extensions, such as `/concepts/slots`. Add new pages to the navigation in `docs.json`.

See the [writing-guidelines skill](../.agents/skills/writing-guidelines/SKILL.md) for prose review and the [Mintlify documentation](https://www.mintlify.com/docs) for MDX components and site configuration.

## Check changes

From this directory, validate the site and check internal links:

```sh
pnpm exec mint validate
pnpm exec mint broken-links
```

From the repository root, run the repository checks:

```sh
pnpm check
```

## Publish changes

Open a pull request for documentation changes. Mintlify publishes updates from the connected default branch after merge.
