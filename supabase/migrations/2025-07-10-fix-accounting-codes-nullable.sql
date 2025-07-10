-- Remove NOT NULL constraint from accounting_code to allow unconfigured codes
ALTER TABLE system_accounting_codes ALTER COLUMN accounting_code DROP NOT NULL;