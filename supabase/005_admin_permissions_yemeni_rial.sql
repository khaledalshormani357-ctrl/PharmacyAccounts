-- Pharmacy profile, administrator hierarchy, and Yemeni rial defaults.
-- This file is a migration proposal only. Review and apply deliberately in Supabase;
-- no live database was modified by creating this file.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE public.pharmacies
  ALTER COLUMN currency SET DEFAULT 'ريال يمني',
  ALTER COLUMN currency_symbol SET DEFAULT 'ر.ي';

-- Migrate only the old built-in default; preserve any custom currency already configured.
UPDATE public.pharmacies
SET currency = 'ريال يمني',
    currency_symbol = 'ر.ي',
    updated_at = now()
WHERE currency IN ('ريال سعودي', 'ر.س')
  AND currency_symbol = 'ر.س';

ALTER TABLE public.pharmacy_profiles
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pharmacy_profiles_permissions_object_check'
      AND conrelid = 'public.pharmacy_profiles'::regclass
  ) THEN
    ALTER TABLE public.pharmacy_profiles
      ADD CONSTRAINT pharmacy_profiles_permissions_object_check
      CHECK (jsonb_typeof(permissions) = 'object');
  END IF;
END;
$$;

-- A system administrator is explicitly allow-listed by a trusted database owner.
-- A pharmacy manager remains the ADMIN role scoped to one pharmacy.
CREATE TABLE IF NOT EXISTS public.system_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.system_admins FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_system_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.system_admins AS sa
    WHERE sa.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_system_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_has_pharmacy_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.is_system_admin() THEN true
    ELSE COALESCE(
      (p.permissions ->> p_permission)::boolean,
      CASE p.role
        WHEN 'ADMIN' THEN true
        WHEN 'PHARMACIST' THEN p_permission IN (
          'dashboard.view', 'inventory.view', 'sales.view', 'sales.create',
          'purchases.view', 'purchases.create', 'customers.view',
          'suppliers.view', 'reports.view'
        )
        WHEN 'CASHIER' THEN p_permission IN (
          'dashboard.view', 'inventory.view', 'sales.view', 'sales.create',
          'customers.view'
        )
        WHEN 'STOREKEEPER' THEN p_permission IN (
          'dashboard.view', 'inventory.view', 'inventory.adjust',
          'purchases.view', 'purchases.create', 'suppliers.view'
        )
        WHEN 'ACCOUNTANT' THEN p_permission IN (
          'dashboard.view', 'sales.view', 'purchases.view', 'customers.view',
          'suppliers.view', 'cashbox.view', 'expenses.manage', 'reports.view'
        )
        ELSE false
      END,
      false
    )
  END
  FROM public.pharmacy_profiles AS p
  WHERE p.id = auth.uid() AND p.active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_user_has_pharmacy_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_pharmacy_permission(text) TO authenticated;

-- Keep pharmacy managers scoped to their own pharmacy; system admins may manage
-- membership records across pharmacies. This does not create or promote any user.
DROP POLICY IF EXISTS profiles_admin_insert ON public.pharmacy_profiles;
CREATE POLICY profiles_admin_insert ON public.pharmacy_profiles
FOR INSERT TO authenticated
WITH CHECK (
  (pharmacy_id = public.current_pharmacy_id() AND public.is_pharmacy_admin())
  OR public.is_system_admin()
);

DROP POLICY IF EXISTS profiles_admin_update ON public.pharmacy_profiles;
CREATE POLICY profiles_admin_update ON public.pharmacy_profiles
FOR UPDATE TO authenticated
USING (
  (pharmacy_id = public.current_pharmacy_id() AND public.is_pharmacy_admin())
  OR public.is_system_admin()
)
WITH CHECK (
  (pharmacy_id = public.current_pharmacy_id() AND public.is_pharmacy_admin())
  OR public.is_system_admin()
);

DROP POLICY IF EXISTS pharmacies_admin_update ON public.pharmacies;
CREATE POLICY pharmacies_admin_update ON public.pharmacies
FOR UPDATE TO authenticated
USING (
  (id = public.current_pharmacy_id() AND public.is_pharmacy_admin())
  OR public.is_system_admin()
)
WITH CHECK (
  (id = public.current_pharmacy_id() AND public.is_pharmacy_admin())
  OR public.is_system_admin()
);
