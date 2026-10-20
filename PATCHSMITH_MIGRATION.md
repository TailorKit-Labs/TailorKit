# Finish the Patchsmith rename

Keep `tailorkit.app` and its subdomains for hosted app assets, RPC, and internal publication. Platform and host integrations use Patchsmith names.

## Prepare hosting before merging

The web rewrites now target `patchsmith-landing.vercel.app` and `patchsmith.mintlify.site`. Provision those origins and check the landing page, pricing, documentation, and their asset routes before deploying. Both origins returned HTTP 404 when this change was prepared.

Rename the Vercel web project to `patchsmith-web` and update its required database-migration check to `Vercel - patchsmith-web: Database Migrations` together with `.github/workflows/db-migrate.yml`. Keep the existing deployment gate enabled during the transition.

## Move published bundles

The runtime's `BUNDLES` binding now targets `patchsmith-app-assets-prod`. Create that private R2 bucket and copy the existing published objects from `tailorkit-app-assets-prod`, preserving object keys and metadata. Verify the copies against the stored bundle checksums. Coordinate publication writes during the copy so newly published objects also reach the replacement bucket.

Switch the platform's `BLOB_BUCKET` and the runtime binding together. Both must access the same complete object set before publication and asset/RPC traffic use the replacement bucket. Keep the source bucket intact while the previous configuration remains a rollback target. Before rolling back the binding, sync objects published since cutover back to the source bucket and switch both sides together.

Keep the `patchsmith-apps-worker` name, `STORES` binding, and `AppInstallation` class stable to preserve installation databases.

## Rename the signing-key ID

The runtime accepts `patchsmith-runtime-2026-10-02` and the previous `tailorkit-runtime-2026-10-02` ID for the existing public key. Deploy that verifier configuration first, then change only the `kid` in the platform's `APP_RUNTIME_SIGNING_KEY` secret to the Patchsmith ID. Keep private key material in the secret store.

Retain the previous verifier entry while older platform deployments remain rollback targets, and for at least six minutes after the last token issued under the previous ID. Remove that compatibility entry in a subsequent cleanup after the rollback window closes.

## Database compatibility

Merge and deploy the separate platform database PR first. Its forward migration renames the two surviving trigger functions to `patchsmith_keep_short_id` and `patchsmith_keep_app_slug`. PostgreSQL preserves their identities and existing trigger bindings, so previous and updated backends keep the same immutability checks. Applied migration files remain unchanged.

The app runtime atomically renames each installation's migration journal to `patchsmith_migrations` during initialization. Existing app data and journal positions/checksums remain intact. A writable `tailorkit_migrations` compatibility view lets older workers read and append to that same journal during rollback. Failed upgrades roll the rename back with the pending app migrations. Keep the legacy table-name reservation until that view and older workers are retired.

## Local development

Docker Compose now uses the `patchsmith` project, `patchsmith-postgres` and `patchsmith-s3` containers, and a `patchsmith` database and bucket. The secondary Compose file under `packages/ui/src/components` also uses a `patchsmith_postgres_data` volume.

Changing the Compose project selects new volume names. Back up existing local databases and objects before starting the new project, stop the old services to release their ports, then restore any data you need into the new database/bucket. Update local `DATABASE_URL` and `BLOB_BUCKET` values accordingly. Changing `POSTGRES_DB` alone does not rename a database in an existing volume.

The worker dev script persists state under `.patchsmith/state`. Move any local state you need from `.tailorkit/state` before starting it. Legacy `.tailorkit*` ignores remain to keep old credentials and state out of commits during the transition.

## Repository metadata

The GitHub repository is `patchsmith-io/Patchsmith`. Existing checkouts can update their remote with:

```sh
git remote set-url origin https://github.com/patchsmith-io/Patchsmith.git
```

Local checkout/worktree directory names are independent of the tracked files. Relocate them separately if needed.

Remaining old names are limited to the retained app domain, applied migrations, upgrade instructions, and the compatibility entries described above. The canonical licenses already identify Patchsmith.
