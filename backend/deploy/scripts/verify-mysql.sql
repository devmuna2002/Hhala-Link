SELECT 'profiles' AS table_name, COUNT(*) AS row_count FROM profiles
UNION ALL SELECT 'properties', COUNT(*) FROM properties
UNION ALL SELECT 'property_images', COUNT(*) FROM property_images
UNION ALL SELECT 'applications', COUNT(*) FROM applications
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'movers', COUNT(*) FROM movers
UNION ALL SELECT 'mover_bookings', COUNT(*) FROM mover_bookings
UNION ALL SELECT 'mover_reviews', COUNT(*) FROM mover_reviews
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'saved_searches', COUNT(*) FROM saved_searches;

SELECT COUNT(*) AS profiles_missing_password_hash
FROM profiles
WHERE password_hash IS NULL OR password_hash = '';