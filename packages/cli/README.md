# TailorKit CLI

Use the TailorKit command-line interface (CLI) to create, develop, and publish extensions. You can also ask the app agent to build against a running host.

## Build against a local host

Start a conversation with the agent using your local host URL:

```sh
tailorkit agent --host http://localhost:3000/api/tailorkit
```

Each turn reads the host schema locally and sends it to the remote agent workspace for scaffolding and type generation. Configure the host with a TailorKit project before starting. The host does not need a public deployment.

## Generate from a schema file

Pass `--schema` to `init` or `generate` to use a serialized host schema instead of fetching it from the host. Paths resolve relative to `--cwd`, which defaults to the current directory:

```sh
tailorkit init --name my-app \
  --host http://localhost:3000/api/tailorkit \
  --schema ./host.schema.json
tailorkit generate --cwd ./my-app --schema ../host.schema.json
```

The host URL is still required by `init` or the app configuration. A schema snapshot supplies types and bindings; remote runtime calls still need network access to the host. `agent --schema your_schema_path` also accepts a local snapshot.

## Authenticate CLI commands

By default, `tailorkit deploy` authenticates through the configured host using your CLI login. App agents use a separate, signed JSON Web Token (JWT) issued after the platform authorizes the request forwarded by the host.

The JWT lasts one hour from issuance. It identifies the platform API URL, project, scope, initial app, and initiating CLI credential. CLI approval does not record a user subject ID.

Set `TAILORKIT_AGENT_TOKEN` or `TAILORKIT_AGENT_TOKEN_FILE` to use this JWT for authenticated commands: `login`, `whoami`, `agent`, and `deploy`. It overrides stored credentials and routes requests to the platform. The JWT grants the same project and scope permissions as its initiating CLI session, including app selection and creation.

`login` verifies a supplied JWT without browser approval. Environment JWTs are not persisted, so `logout` leaves stored sessions alone. Without a JWT, session tokens use the host. The local `init`, `generate`, `build`, and `db` commands retain their behavior.

Expired or invalid JWTs fail without prompting for login. Start another agent turn with a valid CLI session to obtain a fresh JWT. A turn authenticated with a JWT retains that token’s deadline and cannot renew it. Revoking the initiating CLI credential also revokes JWT access; normal source expiry does not shorten the one-hour grant.

Platform URLs require HTTPS. HTTP is allowed only for the development hosts `localhost`, `127.0.0.1`, and `[::1]`. Both token issuance and client routing enforce these rules.

## Deploy without prompts

Use these options to control unattended deployments:

- `--no-interactive`: fail instead of prompting for login, app creation, or a typecheck override
- `--app-id your_app_id`: deploy to an existing app; never create a replacement

The app agent keeps its JWT in the host process. Its deployment tool builds without credentials in the sandbox, then uploads and publishes through the host. The token stays out of the model prompt, sandbox filesystem and environment, persistent Drive, and CLI credential store.

## Resume a conversation

Each `tailorkit agent` invocation starts a new conversation. Follow-up messages in that invocation share a thread. When the chat closes, the CLI prints its `threadId`.

To resume it, supply the app and thread IDs:

```sh
tailorkit agent --host http://localhost:3000/api/tailorkit \
  --app your_app_id --thread your_thread_id
```

App source is shared across threads. Only one thread can edit an app at a time.
