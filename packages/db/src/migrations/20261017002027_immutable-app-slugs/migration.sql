-- Drizzle cannot express triggers. Keep the generated slug permanent even for
-- direct SQL writes; old servers omit this field and remain compatible.
CREATE FUNCTION tailorkit_keep_app_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'App slugs are permanent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER app_keep_slug BEFORE UPDATE OF slug ON app
FOR EACH ROW EXECUTE FUNCTION tailorkit_keep_app_slug();
