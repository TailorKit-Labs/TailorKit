ALTER TABLE "project" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');--> statement-breakpoint
ALTER TABLE "app_deployment" ADD CONSTRAINT "app_deployment_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');