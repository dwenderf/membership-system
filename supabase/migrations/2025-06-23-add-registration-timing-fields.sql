-- Add timing and pre-sale fields to registrations table
-- Migration: Add registration timing controls

ALTER TABLE public.registrations 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS presale_start_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS regular_start_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS registration_end_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS presale_code TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.registrations.is_active IS 'Whether registration is published (false = draft/hidden from users)';
COMMENT ON COLUMN public.registrations.presale_start_at IS 'When pre-sale registration opens (requires presale_code)';
COMMENT ON COLUMN public.registrations.regular_start_at IS 'When general registration opens to all users';
COMMENT ON COLUMN public.registrations.registration_end_at IS 'When registration closes';
COMMENT ON COLUMN public.registrations.presale_code IS 'Code required for pre-sale access';

-- Add index for efficient time-based queries
CREATE INDEX IF NOT EXISTS idx_registrations_timing ON public.registrations(presale_start_at, regular_start_at, registration_end_at);