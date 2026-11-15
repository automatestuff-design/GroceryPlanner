-- How each stored recipe's nutrition was obtained: published by the source, or
-- calculated from its ingredients with the Canadian Nutrient File (with any
-- ingredients that couldn't be counted). Null for curated catalog recipes.
alter table recipes add column nutrition_basis jsonb;

-- Recipes a household saves from TikTok, photos or pasted text come in as private
-- imports; their nutrition is always calculated, so they must say so.
alter table recipes add constraint recipes_import_has_basis
  check (source_provider <> 'import' or nutrition_basis is not null) not valid;
