-- ============================================================
-- Listing approval workflow
-- New agent/landlord listings start as 'pending' and are only
-- visible in the public market once an admin approves them
-- (status -> 'available'). Admins can also reject (status -> 'rejected').
-- ============================================================

-- Add 'rejected' to the property_status enum (currently only
-- 'available', 'pending', 'rented', 'inactive' exist).
ALTER TYPE public.property_status ADD VALUE IF NOT EXISTS 'rejected';

-- Track who reviewed a listing and when
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- New listings default to pending review
ALTER TABLE public.properties ALTER COLUMN status SET DEFAULT 'pending';

-- Public may only see published ('available') listings.
-- Owners can always see their own (incl. pending/rejected).
-- Admins can see every listing (to review them).
DROP POLICY IF EXISTS "properties_select_active" ON public.properties;
CREATE POLICY "properties_select_active" ON public.properties
  FOR SELECT
  USING (
    status = 'available'
    OR auth.uid() = owner_id
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

-- Allow admins to update any property (approve / reject / set reviewed_by)
DROP POLICY IF EXISTS "properties_update_admin" ON public.properties;
CREATE POLICY "properties_update_admin" ON public.properties
  FOR UPDATE
  USING   ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');
