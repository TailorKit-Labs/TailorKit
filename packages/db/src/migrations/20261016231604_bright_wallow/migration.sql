ALTER TABLE "organization" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER TABLE "app" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER TABLE "app_deployment" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER INDEX "app_project_id_public_id_unique" RENAME TO "app_project_id_short_id_unique";--> statement-breakpoint
ALTER INDEX "app_deployment_app_id_public_id_unique" RENAME TO "app_deployment_app_id_short_id_unique";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "short_id" varchar(12);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_short_id_key" UNIQUE("short_id");