# Patchsmith authentication

`@patchsmith/auth` manages authentication and access for the Patchsmith platform.

Set `AUTH_PRODUCTION_URL=https://patchsmith.io` in both the Production and Preview environments. Production uses it for auth callbacks and trusted origins; previews use it for the OAuth proxy while keeping their own deployment URLs.

When changing the production domain, update `AUTH_PRODUCTION_URL`, include the new origin in `AUTH_TRUSTED_ORIGINS`, and update the callback URL in each OAuth provider (for GitHub, `https://patchsmith.io/api/auth/callback/github`). Preserve any trusted preview patterns when updating the origin list. Redeploy after changing the environment variables so the auth server receives the new values.
