-- Custom migration: apply schema changes, normalize existing IDs, then enforce the final constraints.
ALTER TABLE "organization" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER TABLE "app" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER TABLE "app_deployment" RENAME COLUMN "public_id" TO "short_id";--> statement-breakpoint
ALTER INDEX "app_project_id_public_id_unique" RENAME TO "app_project_id_short_id_unique";--> statement-breakpoint
ALTER INDEX "app_deployment_app_id_public_id_unique" RENAME TO "app_deployment_app_id_short_id_unique";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "short_id" varchar(12);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_short_id_key" UNIQUE("short_id");
--> statement-breakpoint
-- The ID and asset contracts intentionally break compatibility with old servers.
-- Drop the old tenant trigger/check before normalizing the renamed column.
DROP TRIGGER organization_keep_public_id ON organization;--> statement-breakpoint
DROP FUNCTION tailorkit_keep_team_public_id();--> statement-breakpoint
ALTER TABLE organization DROP CONSTRAINT organization_public_id_format;--> statement-breakpoint
-- Backfill new projects and normalize legacy short IDs without changing UUID relationships.
-- Retry only unique violations; the owning table's constraints define each namespace.
DO $$
DECLARE
  target record;
  entity record;
BEGIN
  FOR target IN SELECT * FROM (VALUES ('organization'), ('project'), ('app'), ('app_deployment')) AS targets(name) LOOP
    FOR entity IN EXECUTE format('SELECT id FROM %I WHERE short_id IS NULL OR short_id !~ %L', target.name, '^[a-z0-9]{12}$') LOOP
      LOOP
        BEGIN
          EXECUTE format('UPDATE %I SET short_id = substr(replace(gen_random_uuid()::text, %L, %L), 1, 12) WHERE id = $1', target.name, '-', '') USING entity.id;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          -- A different random value is generated on the next attempt.
        END;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;--> statement-breakpoint
ALTER TABLE organization ADD CONSTRAINT organization_short_id_format CHECK (short_id ~ '^[a-z0-9]{12}$');--> statement-breakpoint
CREATE FUNCTION tailorkit_keep_short_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_id IS DISTINCT FROM OLD.short_id THEN
    RAISE EXCEPTION 'Short IDs are permanent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER organization_keep_short_id BEFORE UPDATE OF short_id ON organization
FOR EACH ROW EXECUTE FUNCTION tailorkit_keep_short_id();--> statement-breakpoint
CREATE TRIGGER project_keep_short_id BEFORE UPDATE OF short_id ON project
FOR EACH ROW EXECUTE FUNCTION tailorkit_keep_short_id();--> statement-breakpoint
CREATE TRIGGER app_keep_short_id BEFORE UPDATE OF short_id ON app
FOR EACH ROW EXECUTE FUNCTION tailorkit_keep_short_id();--> statement-breakpoint
CREATE TRIGGER app_deployment_keep_short_id BEFORE UPDATE OF short_id ON app_deployment
FOR EACH ROW EXECUTE FUNCTION tailorkit_keep_short_id();

--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "short_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');--> statement-breakpoint
ALTER TABLE "app_deployment" ADD CONSTRAINT "app_deployment_short_id_format" CHECK ("short_id" ~ '^[a-z0-9]{12}$');
