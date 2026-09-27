-- ================================================================
--  UPDATE PROPERTY TYPES
--  Run this in your Supabase SQL Editor to add missing
--  categories like Shops, Stands, and Villas.
-- ================================================================

-- We use DO blocks because ALTER TYPE ADD VALUE cannot be run inside a transaction block 
-- with IF NOT EXISTS in many Postgres versions, so we check first.

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'property_type' AND e.enumlabel = 'shops') THEN
        ALTER TYPE property_type ADD VALUE 'shops';
    END IF;
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'property_type' AND e.enumlabel = 'stands') THEN
        ALTER TYPE property_type ADD VALUE 'stands';
    END IF;
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'property_type' AND e.enumlabel = 'offices') THEN
        ALTER TYPE property_type ADD VALUE 'offices';
    END IF;
END $$;

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'property_type' AND e.enumlabel = 'villa') THEN
        ALTER TYPE property_type ADD VALUE 'villa';
    END IF;
END $$;

-- Also add 'office' if not present (singular)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'property_type' AND e.enumlabel = 'office') THEN
        ALTER TYPE property_type ADD VALUE 'office';
    END IF;
END $$;
