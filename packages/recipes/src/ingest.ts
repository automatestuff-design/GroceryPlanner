import type { Recipe } from "@mealplan/core";
import { fetchJsonLdRecipe, JsonLdError } from "./sources/jsonld";

/**
 * Catalog ingestion. Only sources listed in a manifest are imported, and each entry
 * must state the license or agreement that lets us store its recipes. This is the
 * gate between "publicly visible" and "allowed to copy": most recipe sites publish
 * JSON-LD for search engines, but their recipe text and photos are still copyrighted.
 */
export interface ManifestSource {
  /** Shown to users, e.g. "USDA MyPlate Kitchen". */
  name: string;
  /** Why we may store these recipes: "public-domain", "CC-BY-4.0", "partner-agreement:<ref>", "own". */
  license: string;
  /** Credit line the license requires. */
  attribution: string;
  /** Recipe page URLs, or sitemap URLs (ending .xml) to expand. */
  urls: string[];
  /** Only sitemap entries matching this pattern are imported, e.g. "/recipes/". */
  include?: string;
  /** Polite delay between page fetches. */
  delayMs?: number;
}

export interface IngestReport {
  source: string;
  imported: number;
  skipped: { url: string; reason: string }[];
}

export interface CatalogWriter {
  upsert(recipes: Recipe[]): Promise<void>;
}

const ACCEPTED_LICENSE = /^(public-domain|CC0|CC-BY(-SA)?-\d|partner-agreement:.+|own)$/i;

export async function ingestSource(src: ManifestSource, writer: CatalogWriter, opts: { fetch?: typeof fetch; resolve?: (host: string) => Promise<string[]>; limit?: number; log?: (s: string) => void } = {}): Promise<IngestReport> {
  if (!ACCEPTED_LICENSE.test(src.license)) {
    throw new Error(`"${src.name}": license "${src.license}" doesn't permit storing recipes. Use public-domain, CC0, CC-BY-x, partner-agreement:<ref> or own.`);
  }
  const doFetch = opts.fetch ?? fetch;
  const pages = await expandUrls(src, doFetch);
  const report: IngestReport = { source: src.name, imported: 0, skipped: [] };
  const batch: Recipe[] = [];

  for (const url of pages.slice(0, opts.limit ?? Infinity)) {
    try {
      const recipe = await fetchJsonLdRecipe(url, { sourceName: src.name, license: src.license, attribution: src.attribution, provider: "jsonld" }, { fetch: doFetch, resolve: opts.resolve });
      batch.push(recipe);
      if (batch.length >= 50) { await writer.upsert(batch.splice(0)); }
      report.imported++;
    } catch (err) {
      report.skipped.push({ url, reason: err instanceof JsonLdError ? err.message : String(err) });
    }
    opts.log?.(`${report.imported} imported, ${report.skipped.length} skipped`);
    if (src.delayMs) await new Promise((r) => setTimeout(r, src.delayMs));
  }
  if (batch.length) await writer.upsert(batch);
  return report;
}

async function expandUrls(src: ManifestSource, doFetch: typeof fetch): Promise<string[]> {
  const out: string[] = [];
  for (const url of src.urls) {
    if (!url.endsWith(".xml")) { out.push(url); continue; }
    const xml = await (await doFetch(url)).text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
    for (const loc of locs) {
      if (loc.endsWith(".xml")) out.push(...(await expandUrls({ ...src, urls: [loc] }, doFetch)));
      else if (!src.include || loc.includes(src.include)) out.push(loc);
    }
  }
  return [...new Set(out)];
}
