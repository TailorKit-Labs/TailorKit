# TailorKit CLI

Command-line tools for developing and publishing TailorKit extensions.

`tailorkit agent --host http://localhost:3000/api/tailorkit` can build against a
running local host. Each chat turn reads the host schema locally and sends it to
the remote agent workspace for scaffolding and type generation. The host must be
configured with a TailorKit project; a public host deployment is not required.

To scaffold or regenerate using a serialized host schema JSON file, pass
`--schema` to either command. Paths are relative to `--cwd` (the current directory
by default). The host URL is still required in init or the app config.

```sh
tailorkit init --name my-app --host http://localhost:3000/api/tailorkit --schema ./host.schema.json
tailorkit generate --cwd ./my-app --schema ../host.schema.json
```

Without `--schema`, init and generate fetch the schema from the configured host.
The snapshot provides types and bindings; remote runtime calls to a local host
still require network connectivity.

`tailorkit deploy` continues to authenticate through the configured host using
its existing CLI login. Login and CLI token storage are unchanged.

The app agent receives a separate, signed JWT after the platform authorizes the
agent request forwarded by the host. It lasts one hour from issuance and includes
the platform API URL, project, scope, selected app, and initiating CLI credential
identity. CLI approval does not currently record a user subject ID.

The deployment tool passes this JWT through `TAILORKIT_AGENT_TOKEN` only to the
deployment subprocess. When present, it overrides stored CLI credentials and
routes deployment requests directly to the existing platform endpoints. The
platform verifies the JWT and restricts it to creating and publishing deployments
for the selected app. Expired or invalid JWTs fail without prompting for login.
Start another agent turn to obtain a fresh JWT. Revoking the initiating CLI
credential also revokes agent access; its normal expiry does not shorten the JWT.

`--no-interactive` fails instead of prompting for login, app creation, or a type
check override. `--app-id <id>` pins deployment to an existing app and never
creates a replacement. The JWT is never written to the CLI credential store,
model prompt, or persistent workspace.
