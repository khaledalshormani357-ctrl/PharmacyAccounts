const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCatalogSearchText, searchDrugCatalog } = require('../.test-build/services/drug-catalog-utils.js');

// Synthetic fixtures keep tests independent from the user's source catalog.
const catalog = [
  { source_id: '00000000-0000-0000-0000-000000000001', source_code: 'MED-A-200', trade_name_ar: 'إيبوبروفين أقراص', trade_name_en: 'Ibuprofen Tablets', generic_name: 'Ibuprofen', active_ingredient: 'Ibuprofen', strength: '200 mg', dosage_form: 'Tablet', base_unit: 'حبة', selling_unit: 'شريط', pack_size: 10, category_ar: 'مسكنات', manufacturer_name: 'Example Pharma' },
  { source_id: '00000000-0000-0000-0000-000000000002', source_code: 'MED-A-400', trade_name_ar: 'إيبوبروفين أقراص', trade_name_en: 'Ibuprofen Tablets', generic_name: 'Ibuprofen', active_ingredient: 'Ibuprofen', strength: '400 mg', dosage_form: 'Tablet', base_unit: 'حبة', selling_unit: 'شريط', pack_size: 10, category_ar: 'مسكنات', manufacturer_name: 'Example Pharma' },
  { source_id: '00000000-0000-0000-0000-000000000003', source_code: 'MED-B-100', trade_name_ar: 'دواء مختلف', trade_name_en: 'Another medicine', generic_name: 'Other ingredient', active_ingredient: 'Other ingredient', strength: '100 mg', dosage_form: 'Capsule' },
];
const forbidden = new Set([
  'name_ar', 'name_en', 'original_dose', 'disease_indication',
  'current_purchase_price', 'current_selling_price', 'min_stock_level',
  'reorder_level', 'prescription_required', 'controlled', 'stock_quantity',
]);

test('catalog fixture has unique source identifiers while retaining separate strengths', () => {
  assert.equal(new Set(catalog.map(row => row.source_id)).size, catalog.length);
  assert.equal(new Set(catalog.map(row => row.source_code)).size, catalog.length);
  assert.ok(catalog.every(row => row.trade_name_ar && row.trade_name_ar.trim()));
  assert.equal(catalog.filter(row => row.trade_name_ar === 'إيبوبروفين أقراص').length, 2);
});

test('catalog fields contain no original names, stock, prices, or clinical instructions', () => {
  for (const row of catalog) for (const field of forbidden) assert.equal(Object.hasOwn(row, field), false, `unexpected field ${field}`);
  const generator = fs.readFileSync(path.join(__dirname, '../scripts/build-drug-catalog.py'), 'utf8');
  assert.match(generator, /product\.get\("trade_name_ar"\)/);
  assert.doesNotMatch(generator, /product\.get\("name_ar"\)/);
  assert.doesNotMatch(generator, /product\.get\("original_dose"\)|product\.get\("disease_indication"\)/);
});

test('Arabic search ignores diacritics and common alif variants', () => {
  assert.equal(normalizeCatalogSearchText('أَقْرَاص'), 'اقراص');
  assert.deepEqual(searchDrugCatalog(catalog, 'ايبوبروفين اقراص').map(row => row.source_id), [catalog[0].source_id, catalog[1].source_id]);
  assert.deepEqual(searchDrugCatalog(catalog, 'ibuprofen').map(row => row.source_id), [catalog[0].source_id, catalog[1].source_id]);
});

test('duplicate display names never merge distinct catalog records', () => {
  const matches = searchDrugCatalog(catalog, 'إيبوبروفين أقراص');
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(row => row.strength), ['200 mg', '400 mg']);
});

test('remote schema is read-only to clients and separate from inventory', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/002_drug_catalog.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.drug_catalog/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FOR SELECT\s+TO authenticated\s+USING \(is_active = true\)/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.drug_catalog FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT SELECT ON TABLE public\.drug_catalog TO authenticated/i);
  assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*?FOR\s+(INSERT|UPDATE|DELETE)/i);
});
