-- HLALA LINK: DATABASE RESET SCRIPT
-- ================================================================
-- WARNING: This script will delete ALL data in the following tables:
-- properties, profiles, conversations, messages, notifications, subscriptions, etc.
-- ================================================================

-- Disable triggers temporarily to avoid errors during bulk delete
SET session_replication_role = 'replica';

-- 1. DELETE DATA (Order matters for foreign keys if CASCADE is not used)
TRUNCATE public.notifications CASCADE;
TRUNCATE public.messages CASCADE;
TRUNCATE public.conversations CASCADE;
TRUNCATE public.user_follows CASCADE;
TRUNCATE public.property_view_logs CASCADE;
TRUNCATE public.saved_properties CASCADE;
TRUNCATE public.applications CASCADE;
TRUNCATE public.mover_bookings CASCADE;
TRUNCATE public.properties CASCADE;
TRUNCATE public.subscriptions CASCADE;
TRUNCATE public.movers CASCADE;
TRUNCATE public.profiles CASCADE;

-- 2. DELETE AUTH USERS (Only works if you have permissions in SQL Editor)
-- Note: This will sign out everyone and remove their accounts.
DELETE FROM auth.users;

-- Re-enable triggers
SET session_replication_role = 'origin';

SELECT 'Database successfully reset. All users and data have been removed.' as status;
