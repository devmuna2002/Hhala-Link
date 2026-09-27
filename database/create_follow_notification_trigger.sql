-- ============================================================
-- Create Follow Notification Trigger
-- Run this in Supabase SQL Editor
-- ============================================================

-- Function to create a notification when someone is followed
CREATE OR REPLACE FUNCTION public.notify_user_followed()
RETURNS TRIGGER AS $$
DECLARE
  v_follower_name TEXT;
BEGIN
  -- Get the follower's name
  SELECT first_name || ' ' || last_name INTO v_follower_name
  FROM public.profiles
  WHERE id = NEW.follower_id;

  -- Default name if missing
  IF v_follower_name IS NULL OR TRIM(v_follower_name) = '' THEN
    v_follower_name := 'A user';
  END IF;

  -- Insert into notifications
  INSERT INTO public.notifications (
    user_id,
    actor_id,
    type,
    title,
    message,
    reference_id
  ) VALUES (
    NEW.following_id,          -- The person being followed
    NEW.follower_id,           -- The person doing the following
    'follow',                  -- Notification type
    'New Follower',
    v_follower_name || ' started following you.',
    NEW.follower_id            -- Reference ID to link back to the follower's chat
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_notify_user_followed ON public.user_follows;
CREATE TRIGGER trg_notify_user_followed
  AFTER INSERT ON public.user_follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_user_followed();
