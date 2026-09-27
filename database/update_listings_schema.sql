-- ================================================================
--  UPDATE LISTINGS SCHEMA (FIXED)
--  Run this in your Supabase SQL Editor to add support for
--  newly added property features.
-- ================================================================

-- 1. DROP dependent views first to allow column type changes
DROP VIEW IF EXISTS v_active_properties CASCADE;

-- 2. Add water_source column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='properties' AND column_name='water_source') THEN
        ALTER TABLE properties ADD COLUMN water_source TEXT;
    END IF;
END $$;

-- 3. Ensure floor_level is TEXT to support "Ground", "1st", etc.
-- (Safe conversion from SMALLINT if necessary)
DO $$ 
BEGIN 
    IF (SELECT data_type FROM information_schema.columns WHERE table_name='properties' AND column_name='floor_level') = 'smallint' THEN
        ALTER TABLE properties ALTER COLUMN floor_level TYPE TEXT USING floor_level::text;
    END IF;
END $$;

-- 4. Ensure other key spec columns exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='properties' AND column_name='parking_spots') THEN
        ALTER TABLE properties ADD COLUMN parking_spots SMALLINT DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='properties' AND column_name='is_furnished') THEN
        ALTER TABLE properties ADD COLUMN is_furnished BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 5. RECREATE the dependent view with all columns (new and old)
CREATE VIEW v_active_properties AS
SELECT
    p.*,
    pr.first_name || ' ' || pr.last_name AS owner_name,
    pr.phone_number AS owner_phone,
    pr.avatar_url   AS owner_avatar,
    pr.id_verified  AS owner_verified
FROM properties p
JOIN profiles pr ON pr.id = p.owner_id
WHERE p.status = 'available';

COMMENT ON COLUMN properties.water_source IS 'Source of water for the property (e.g., Borehole, Council, Well)';
COMMENT ON COLUMN properties.floor_level IS 'The level or floor the property is on (e.g., Ground, 1st, Penthouse)';
