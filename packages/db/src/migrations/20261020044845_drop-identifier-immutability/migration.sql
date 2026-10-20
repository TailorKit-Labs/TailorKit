-- Custom migration: Drizzle does not model trigger functions. Remove the
-- immutability guards explicitly while retaining format and uniqueness constraints.
DROP TRIGGER organization_keep_short_id ON organization;
--> statement-breakpoint
DROP TRIGGER project_keep_short_id ON project;
--> statement-breakpoint
DROP TRIGGER app_keep_short_id ON app;
--> statement-breakpoint
DROP TRIGGER app_deployment_keep_short_id ON app_deployment;
--> statement-breakpoint
DROP TRIGGER app_keep_slug ON app;
--> statement-breakpoint
DROP FUNCTION tailorkit_keep_short_id();
--> statement-breakpoint
DROP FUNCTION tailorkit_keep_app_slug();
