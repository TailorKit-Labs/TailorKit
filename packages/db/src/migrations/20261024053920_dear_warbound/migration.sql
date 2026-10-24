CREATE TABLE "app_asset" (
	"app_id" uuid NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"content_length" integer NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"object_key" text NOT NULL,
	"path" text NOT NULL,
	"status" "app_deployment_file_status" DEFAULT 'uploading'::"app_deployment_file_status" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_asset_checksum_format" CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "app_asset_positive_length" CHECK ("content_length" > 0)
);
--> statement-breakpoint
CREATE TABLE "app_deployment_asset" (
	"app_asset_id" uuid,
	"app_deployment_id" uuid,
	CONSTRAINT "app_deployment_asset_pkey" PRIMARY KEY("app_deployment_id","app_asset_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_asset_app_checksum_path_unique" ON "app_asset" ("app_id","checksum","path");--> statement-breakpoint
CREATE UNIQUE INDEX "app_asset_object_key_unique" ON "app_asset" ("object_key");--> statement-breakpoint
CREATE INDEX "app_deployment_asset_asset_id_idx" ON "app_deployment_asset" ("app_asset_id");--> statement-breakpoint
ALTER TABLE "app_asset" ADD CONSTRAINT "app_asset_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_deployment_asset" ADD CONSTRAINT "app_deployment_asset_app_asset_id_app_asset_id_fkey" FOREIGN KEY ("app_asset_id") REFERENCES "app_asset"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "app_deployment_asset" ADD CONSTRAINT "app_deployment_asset_app_deployment_id_app_deployment_id_fkey" FOREIGN KEY ("app_deployment_id") REFERENCES "app_deployment"("id") ON DELETE CASCADE;