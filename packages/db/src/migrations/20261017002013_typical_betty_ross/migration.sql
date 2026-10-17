ALTER TABLE "app" ADD COLUMN "slug" varchar(64) DEFAULT ('app-' || pg_catalog.gen_random_uuid()::text) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_project_id_slug_unique" ON "app" ("project_id","slug");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');