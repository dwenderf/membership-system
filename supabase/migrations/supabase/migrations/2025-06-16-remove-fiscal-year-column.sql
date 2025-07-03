-- Remove redundant fiscal_year column from seasons table
-- The fiscal year can be derived from start_date using EXTRACT(year FROM start_date)

-- Remove the fiscal_year column
ALTER TABLE seasons DROP COLUMN fiscal_year;

-- Verification query
SELECT 
    id, 
    name, 
    type, 
    start_date, 
    end_date,
    EXTRACT(year FROM start_date) as derived_fiscal_year,
    is_active
FROM seasons 
ORDER BY start_date DESC;