ALTER TABLE "app" ADD COLUMN "slug" varchar(32) DEFAULT ('app-' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 28)) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_project_id_slug_unique" ON "app" ("project_id","slug");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');