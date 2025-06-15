-- Verification queries for registration categories migration
-- Run this in your Supabase SQL Editor to confirm everything is set up correctly

-- 1. Check that registration_categories table exists with correct structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'registration_categories' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 2. Check that redundant columns were removed from registrations table
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'registrations' 
AND table_schema = 'public'
ORDER BY ordinal_position;

-- 3. Check that foreign key columns were added
SELECT 
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('user_registrations', 'registration_pricing_tiers')
AND column_name LIKE '%registration_category_id%'
AND table_schema = 'public';

-- 4. Check that indexes exist
SELECT 
    indexname,
    tablename,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('registration_categories', 'registration_pricing_tiers')
AND schemaname = 'public'
AND indexname LIKE '%category%';

-- 5. Check that RLS is enabled
SELECT 
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'registration_categories'
AND schemaname = 'public';

-- 6. Check that RLS policies exist
SELECT 
    policyname,
    tablename,
    cmd,
    permissive,
    roles,
    qual
FROM pg_policies 
WHERE tablename = 'registration_categories'
AND schemaname = 'public';

-- 7. Check foreign key constraints
SELECT 
    tc.table_name, 
    tc.constraint_name, 
    tc.constraint_type, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
AND tc.table_name = 'registration_categories'
AND tc.table_schema = 'public';

-- Summary check
SELECT 
    'Migration verification complete!' as status,
    'All tables and relationships should be properly configured' as message;