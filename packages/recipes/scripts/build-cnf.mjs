#!/usr/bin/env node
/**
 * Builds packages/recipes/data/cnf-2026.json from the Canadian Nutrient File 2026 CSVs.
 *
 * Source: Health Canada, Canadian Nutrient File 2026,
 *   https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109
 *   (download "cnf_fcen_all-files-data_2026.zip" and unzip it).
 * Licence: Open Government Licence – Canada (attribution required; see data/CNF-LICENCE.md).
 *
 * Usage: node packages/recipes/scripts/build-cnf.mjs <dir-with-unzipped-csvs>
 *
 * Output: { source, foods: [[code, description, group, kcal, protein, fat, carbs, fibre|null, measures]] }
 * where nutrients are per 100 g edible portion and measures are [[description, grams], ...]
 * ("1 clove" → 3, "250 ml" → 143.7). Baby foods and fast-food items are left out:
 * they're never recipe ingredients and only add false matches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node build-cnf.mjs <dir with Food_Name.csv, Nutrient_Amount.csv, ...>");
  process.exit(1);
}

const NUTRIENTS = { 208: "kcal", 203: "protein", 204: "fat", 205: "carbs", 291: "fibre" };
const EXCLUDED_GROUPS = new Set([3, 21]); // Babyfoods, Fast Foods
const USER_DEFINED_MEASURE = 6; // Measure_Type 6 = household measures; 3 = refuse, 9 = yield

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, commas and newlines inside quotes). */
function readCsv(name) {
  const text = readFileSync(join(dir, name), "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

const foods = new Map();
for (const f of readCsv("Food_Name.csv")) {
  const group = Number(f.CNF_Food_Group_Code);
  if (EXCLUDED_GROUPS.has(group)) continue;
  foods.set(f.Food_Code, { code: Number(f.Food_Code), description: f.Food_Description_EN.trim(), group, n: {}, measures: [] });
}

for (const a of readCsv("Nutrient_Amount.csv")) {
  const key = NUTRIENTS[a.Nutrient_Code];
  const food = foods.get(a.Food_Code);
  if (key && food && a.Nutrient_Amount !== "") food.n[key] = Number(a.Nutrient_Amount);
}

const measureNames = new Map(readCsv("Measure_Name.csv").map((m) => [m.Measure_Code, m.Measure_Description_and_Unit_EN.trim()]));
for (const c of readCsv("Measure_Weight_Conversion.csv")) {
  const food = foods.get(c.Food_Code);
  const grams = Number(c.Measure_Weight_Conversion);
  if (!food || Number(c.Measure_Type_Code) !== USER_DEFINED_MEASURE || !(grams > 0)) continue;
  const name = measureNames.get(c.Measure_Code);
  if (name) food.measures.push([name, round(grams, 2)]);
}

const out = [];
let skipped = 0;
for (const f of foods.values()) {
  const { kcal, protein, fat, carbs, fibre } = f.n;
  // Energy and the three macros are required; fibre is often unmeasured (null = unknown).
  if ([kcal, protein, fat, carbs].some((v) => typeof v !== "number")) { skipped++; continue; }
  out.push([f.code, f.description, f.group, round(kcal, 1), round(protein, 2), round(fat, 2), round(carbs, 2), typeof fibre === "number" ? round(fibre, 1) : null, f.measures]);
}
out.sort((a, b) => a[0] - b[0]);

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "cnf-2026.json");
writeFileSync(target, JSON.stringify({
  source: {
    name: "Canadian Nutrient File 2026",
    publisher: "Health Canada",
    url: "https://open.canada.ca/data/en/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109",
    licence: "Open Government Licence – Canada",
    licenceUrl: "https://open.canada.ca/en/open-government-licence-canada",
    attribution: "Contains information licensed under the Open Government Licence – Canada.",
    note: "Per 100 g edible portion: kcal, protein, fat, carbohydrate (by difference), total dietary fibre. Measures are household measure weights in grams.",
  },
  foods: out,
}));
console.log(`Wrote ${out.length} foods to ${target} (skipped ${skipped} without complete macros).`);
