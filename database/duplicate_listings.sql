-- ================================================================
--  DUPLICATE LISTINGS SCRIPT
--  Run this in your Supabase SQL Editor to duplicate all
--  current listings 5 times with their associated images.
-- ================================================================

DO $$
DECLARE
    r RECORD;
    i INT;
    new_prop_id UUID;
BEGIN
    -- Loop through every existing property
    FOR r IN (SELECT * FROM properties) LOOP
        -- Create 5 duplicates for each
        FOR i IN 1..5 LOOP
            -- Insert the duplicated property
            INSERT INTO properties (
                owner_id, 
                title, 
                description, 
                property_type, 
                rent_usd, 
                address, 
                city, 
                suburb, 
                bedrooms, 
                bathrooms, 
                area_sqm, 
                status, 
                country, 
                floor_level, 
                is_furnished, 
                parking_spots, 
                water_source,
                featured
            ) VALUES (
                r.owner_id, 
                r.title || ' (Copy ' || i || ')', 
                r.description, 
                r.property_type, 
                r.rent_usd, 
                r.address, 
                r.city, 
                r.suburb, 
                r.bedrooms, 
                r.bathrooms, 
                r.area_sqm, 
                r.status, 
                r.country, 
                r.floor_level, 
                r.is_furnished, 
                r.parking_spots, 
                r.water_source,
                r.featured
            ) RETURNING id INTO new_prop_id;
            
            -- Duplicate all associated images for this specific property
            INSERT INTO property_images (
                property_id, 
                storage_path, 
                url, 
                is_cover, 
                sort_order
            )
            SELECT 
                new_prop_id, 
                storage_path, 
                url, 
                is_cover, 
                sort_order 
            FROM property_images 
            WHERE property_id = r.id;
        END LOOP;
    END LOOP;
END $$;
