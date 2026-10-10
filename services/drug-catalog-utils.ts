export interface DrugCatalogSearchable {
  source_id: string;
  source_code: string;
  trade_name_ar: string;
  trade_name_en?: string | null;
  generic_name?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  category_ar?: string | null;
  category_en?: string | null;
  manufacturer_name?: string | null;
  country_of_origin?: string | null;
}

/** Normalize common Arabic spelling variants and remove diacritics for search only. */
export function normalizeCatalogSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Search fields only; never collapse duplicate trade names into a single product. */
export function searchDrugCatalog<T extends DrugCatalogSearchable>(records: T[], query: string): T[] {
  const normalizedQuery = normalizeCatalogSearchText(query);
  if (!normalizedQuery) return records;
  const terms = normalizedQuery.split(' ').filter(Boolean);
  return records.filter(record => {
    const haystack = normalizeCatalogSearchText([
      record.trade_name_ar,
      record.trade_name_en,
      record.generic_name,
      record.active_ingredient,
      record.strength,
      record.dosage_form,
      record.source_code,
      record.category_ar,
      record.category_en,
      record.manufacturer_name,
      record.country_of_origin,
    ].filter(Boolean).join(' '));
    return terms.every(term => haystack.includes(term));
  });
}
