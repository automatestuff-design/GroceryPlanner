/**
 * Catalog ingest CLI.
 *
 *   npm run ingest -w @mealplan/api -- --seed
 *       Load the built-in seed recipes.
 *   npm run ingest -w @mealplan/api -- recipes/sources.manifest.json [--limit 50] [--only "USDA MyPlate Kitchen"]
 *       Import every source in a manifest. Each source must declare a license that lets
 *       us store its recipes; pages without nutrition data are skipped and reported.
 *
 * Needs DATABASE_URL with a role that can write `recipes` (the Supabase `postgres`
 * connection string, server-side only).
 */
import { readFile } from "node:fs/promises";
import { SAMPLE_RECIPES } from "@mealplan/core";
import { createPool, postgresCatalogWriter } from "@mealplan/db";
import { ingestSource, type ManifestSource } from "@mealplan/recipes";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const pool = createPool();
  const writer = postgresCatalogWriter(pool);

  try {
    if (args.includes("--seed")) {
      await writer.upsert(SAMPLE_RECIPES);
      console.log(`Seeded ${SAMPLE_RECIPES.length} recipes.`);
      return;
    }
    const manifestPath = args.find((a) => !a.startsWith("--") && a !== flag("--limit") && a !== flag("--only"));
    if (!manifestPath) throw new Error("Pass a manifest path, or --seed.");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { sources: ManifestSource[] };
    const only = flag("--only");
    const limit = flag("--limit") ? Number(flag("--limit")) : undefined;

    for (const source of manifest.sources.filter((s) => !only || s.name === only)) {
      console.log(`\n${source.name} (${source.license})`);
      const report = await ingestSource(source, writer, { limit, log: (line) => process.stdout.write(`\r  ${line}`) });
      console.log(`\n  imported ${report.imported}, skipped ${report.skipped.length}`);
      for (const s of report.skipped.slice(0, 20)) console.log(`  - ${s.url}: ${s.reason}`);
      if (report.skipped.length > 20) console.log(`  ... and ${report.skipped.length - 20} more`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
