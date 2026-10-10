-- Shared reference catalog. It is deliberately separate from public.products,
-- which is pharmacy-owned operational inventory.
CREATE TABLE IF NOT EXISTS public.drug_catalog (
  source_id uuid PRIMARY KEY,
  source_code text NOT NULL UNIQUE,
  trade_name_ar text NOT NULL,
  trade_name_en text,
  generic_name text,
  active_ingredient text,
  strength text,
  dosage_form text,
  base_unit text,
  selling_unit text,
  pack_size numeric(12, 3) CHECK (pack_size IS NULL OR pack_size >= 0),
  category_id text,
  category_ar text,
  category_en text,
  manufacturer_id text,
  manufacturer_name text,
  country_of_origin text,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.drug_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS drug_catalog_authenticated_read ON public.drug_catalog;
CREATE POLICY drug_catalog_authenticated_read
  ON public.drug_catalog
  FOR SELECT
  TO authenticated
  USING (is_active = true);

REVOKE ALL ON TABLE public.drug_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.drug_catalog TO authenticated;

CREATE INDEX IF NOT EXISTS drug_catalog_source_code_idx
  ON public.drug_catalog (source_code);
CREATE INDEX IF NOT EXISTS drug_catalog_trade_name_ar_idx
  ON public.drug_catalog (trade_name_ar);
CREATE INDEX IF NOT EXISTS drug_catalog_active_ingredient_idx
  ON public.drug_catalog (active_ingredient);

COMMENT ON TABLE public.drug_catalog IS
  'Shared read-only reference catalog. No pharmacy inventory, quantities, costs, prices, original source names, dosage instructions, or indications are stored here.';
COMMENT ON COLUMN public.drug_catalog.trade_name_ar IS
  'Normalized/modified Arabic trade-name field from the supplied catalog; source-original Arabic name is intentionally excluded.';
COMMENT ON COLUMN public.drug_catalog.trade_name_en IS
  'Normalized/modified English trade-name field from the supplied catalog; source-original English name is intentionally excluded.';
