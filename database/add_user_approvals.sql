-- ============================================================
-- USER APPROVALS: Agents & Movers must be approved by admins
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add approval_status column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_profiles_approval ON public.profiles(approval_status);

-- 2. Backfill: all existing AGENTS and MOVERS become pending until an admin approves them
UPDATE public.profiles
SET approval_status = 'pending'
WHERE role IN ('agent', 'mover')
  AND approval_status = 'approved';

-- 3. Force new agent/mover signups to start as pending
CREATE OR REPLACE FUNCTION public.trg_set_initial_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('agent', 'mover') THEN
    NEW.approval_status := 'pending';
  ELSE
    NEW.approval_status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profiles_approval ON public.profiles;
CREATE TRIGGER trg_profiles_approval
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_initial_approval();

-- 4. Block non-admins from changing approval_status directly (prevents self-approval)
CREATE OR REPLACE FUNCTION public.trg_guard_approval_change()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    ) INTO v_is_admin;

    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Only admins can change approval status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profiles_approval_guard ON public.profiles;
CREATE TRIGGER trg_profiles_approval_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_approval_change();

-- 5. Admin-only RPC used by the dashboard to approve/reject users
CREATE OR REPLACE FUNCTION public.admin_set_user_approval(
  p_user_id UUID,
  p_approved BOOLEAN
)
RETURNS VOID AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  UPDATE public.profiles
  SET 
    approval_status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    is_approved = p_approved,
    approved_at = CASE WHEN p_approved THEN NOW() ELSE NULL END
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_set_user_approval(UUID, BOOLEAN) TO authenticated;

-- Backwards-compatible alias (old screen called this)
CREATE OR REPLACE FUNCTION public.admin_set_agent_approval(
  p_user_id UUID,
  p_approved BOOLEAN
)
RETURNS VOID AS $$
  SELECT public.admin_set_user_approval(p_user_id, p_approved);
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_set_agent_approval(UUID, BOOLEAN) TO authenticated;
