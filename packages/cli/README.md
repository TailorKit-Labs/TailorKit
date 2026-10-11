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
the platform API URL, project, scope, initial app, and initiating CLI credential
identity. CLI approval does not currently record a user subject ID.

`TAILORKIT_AGENT_TOKEN` (or `TAILORKIT_AGENT_TOKEN_FILE`) selects this alternative auth method for every
authenticated CLI command: `login`, `whoami`, `agent`, `preview`, and `deploy`.
The JWT overrides stored credentials and uses the existing platform endpoints.
It grants the same project/scope permissions as its initiating CLI session,
including app selection and creation. Normal session tokens continue to use the
host. `login` verifies a supplied JWT without another browser approval;
`logout` leaves stored sessions alone because environment JWTs are not persisted.

`init`, `generate`, `build`, and `db` keep their existing local behavior. Schema
commands can use `--schema` when the host is unreachable. `agent --schema <path>`
also accepts a local snapshot. The host URL remains runtime configuration;
the JWT's platform URL controls authenticated CLI API requests.

Expired or invalid JWTs fail without prompting for login. Start another agent
turn with a valid CLI session to obtain a fresh JWT. A JWT-authenticated agent
turn keeps the existing deadline; it cannot renew itself. Revoking the initiating
CLI credential also revokes JWT access; normal source expiry does not shorten
the one-hour grant. JWT preview sessions end at that same deadline.

Platform URLs require HTTPS, with HTTP allowed only for `localhost`, `127.0.0.1`,
and `[::1]` development hosts. These rules apply at issuance and client routing.

`--no-interactive` fails instead of prompting for login, app creation, or a type
check override. `--app-id <id>` pins deployment to an existing app and never
creates a replacement. The agent writes its JWT to a mode-600 file in ephemeral `/tmp` and sets the
file path for CLI discovery across sandbox commands. The deploy tool also passes
it to its subprocess. It stays out of the model prompt, persistent Drive, and
normal CLI credential store.
