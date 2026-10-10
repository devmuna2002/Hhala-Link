SELECT 'profiles' AS table_name, COUNT(*) AS row_count FROM public.profiles
UNION ALL SELECT 'properties', COUNT(*) FROM public.properties
UNION ALL SELECT 'applications', COUNT(*) FROM public.applications
UNION ALL SELECT 'conversations', COUNT(*) FROM public.conversations
UNION ALL SELECT 'messages', COUNT(*) FROM public.messages
UNION ALL SELECT 'movers', COUNT(*) FROM public.movers
UNION ALL SELECT 'mover_bookings', COUNT(*) FROM public.mover_bookings
ORDER BY table_name;

SELECT COUNT(*) AS profiles_missing_password_hash
FROM public.profiles
WHERE password_hash IS NULL OR password_hash = '';