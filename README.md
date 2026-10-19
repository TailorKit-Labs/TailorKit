<div align="center">
  <img alt="PatchSmith" src="apps/web/public/brand/mark-auto.svg" height="96">
  <h1>PatchSmith</h1>
  <p>Let users build the features they want with AI.</p>
  <p>
    <a href="https://patchsmith.io/docs">Documentation</a> ·
    <a href="https://patchsmith.io">Website</a>
  </p>
</div>

PatchSmith lets customers, partners, and AI agents build apps inside your SaaS product. Apps use the design system, data, and tools you choose to expose. PatchSmith hosts and sandboxes their code.

PatchSmith runs as a hosted platform. This repository contains its SDKs, framework packages, and platform source code. Self-hosting is unsupported.

## Extend your product

Choose how customers and partners extend your product:

- **Extend your app**: let customers add the features and workflows they need to the product they already use.
- **Partner integrations**: give third parties a supported way to build and publish integrations for your platform.
- **Build features with AI**: turn a plain-language idea into a working extension built from your product primitives.
- **Native product UI**: render extensions with your components so every new feature looks and feels built in.
- **Sandboxed runtime**: run third-party and AI-generated code away from your core application runtime.
- **Managed infrastructure**: deploy extensions through PatchSmith’s content delivery network (CDN).
- **Framework support**: use a framework-neutral extension protocol, with an official React adapter available today.

## How it works

The host defines the capabilities available to sandboxed apps:

1. Define a host contract with scopes, components, views, slots, and tools.
2. Build apps against that contract.
3. Authenticate host requests and return the caller’s named scopes.
4. Render installed apps with `RenderSlot`.
5. PatchSmith loads app code in an opaque-origin iframe sandbox and passes UI descriptions and events across the host boundary.

Apps describe UI. The host renders the real UI and keeps control of sensitive work.

## Documentation

Use these guides to integrate PatchSmith or build an app:

- [Overview](https://patchsmith.io/docs/getting-started/introduction) explains the PatchSmith model and core terminology.
- [Installation](https://patchsmith.io/docs/getting-started/installation) walks through a host integration.
- [Writing apps](https://patchsmith.io/docs/writing-apps/overview) covers the app-side runtime and generated bindings.
- [App file routing](./packages/app/README.md) explains view filenames, root shells, and shared slot layouts.

## Contributing

Use the [playground guide](./playground/README.md) to run a local host and try app development. Follow [AGENTS.md](./AGENTS.md) for implementation and verification rules, and [RELEASING.md](./RELEASING.md) for public-package changes. Report vulnerabilities privately using the [security policy](./SECURITY.md).

## License

PatchSmith uses per-package licensing. The hosted platform and server-side infrastructure use the Business Source License 1.1. SDKs, framework packages, client libraries, and developer tooling use Apache-2.0.

For the exact license that applies to a package, see its `package.json` and `LICENSE.md`. See [LICENSE.md](./LICENSE.md) for the repository overview.
