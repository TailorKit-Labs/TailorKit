import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { appSlugSchema } from "@tailorkit/db/schema/apps";
import { expect, it } from "vite-plus/test";

import { forEachSequential } from "#for-each-sequential";

it("backfills app slugs and preserves old inserts while enforcing project uniqueness and immutability", async () => {
  const client = new PGlite();
  try {
    // A populated pre-migration table, including the fields old servers write.
    await client.exec(`
      CREATE TABLE app (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, name text NOT NULL);
      INSERT INTO app (project_id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Existing app');
    `);
    await forEachSequential(
      [
        "20261017022028_parched_madripoor",
        "20261017022029_immutable-app-slugs",
      ],
      async (migration) => {
        const sql = await readFile(
          new URL(
            `../../db/src/migrations/${migration}/migration.sql`,
            import.meta.url
          ),
          "utf-8"
        );
        await client.exec(sql);
      }
    );
    const { rows } = await client.query<{ slug: string }>(
      "SELECT slug FROM app"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toMatch(/^app-[a-f0-9]{28}$/u);
    await client.exec(`
      INSERT INTO app (project_id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Old server insert');
      INSERT INTO app (project_id, name, slug) VALUES
        ('11111111-1111-4111-8111-111111111111', 'First', 'my-app'),
        ('22222222-2222-4222-8222-222222222222', 'Second', 'my-app');
      UPDATE app SET name = 'Renamed' WHERE slug = 'my-app';
      UPDATE app SET slug = slug;
    `);
    await expect(
      client.exec(`
      INSERT INTO app (project_id, name, slug) VALUES
        ('11111111-1111-4111-8111-111111111111', 'Duplicate', 'my-app');
    `)
    ).rejects.toThrow("app_project_id_slug_unique");
    await expect(
      client.exec("UPDATE app SET slug = 'new-slug' WHERE slug = 'my-app'")
    ).rejects.toThrow("App slugs are permanent");
    const maxLengthSlug = "a".repeat(32);
    expect(appSlugSchema.parse(maxLengthSlug)).toBe(maxLengthSlug);
    await client.query(
      "INSERT INTO app (project_id, name, slug) VALUES ('11111111-1111-4111-8111-111111111111', 'Max length', $1)",
      [maxLengthSlug]
    );
    await forEachSequential(
      [
        "",
        "UPPER",
        "has space",
        "-leading",
        "trailing-",
        "double--hyphen",
        "a".repeat(33),
      ],
      async (slug) => {
        expect(appSlugSchema.safeParse(slug).success).toBe(false);
        await expect(
          client.query(
            "INSERT INTO app (project_id, name, slug) VALUES ('11111111-1111-4111-8111-111111111111', 'Invalid', $1)",
            [slug]
          )
        ).rejects.toThrow();
      }
    );
  } finally {
    await client.close();
  }
});
