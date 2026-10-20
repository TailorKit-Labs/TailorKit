-- Custom SQL migration file, put your code below! --
-- Custom migration: Drizzle does not model trigger functions. Renaming preserves
-- their OIDs, so existing triggers and overlapping backend versions keep working.
ALTER FUNCTION tailorkit_keep_short_id() RENAME TO patchsmith_keep_short_id;
--> statement-breakpoint
ALTER FUNCTION tailorkit_keep_app_slug() RENAME TO patchsmith_keep_app_slug;
