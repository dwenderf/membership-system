-- Add published_at to track the first time a registration ever went live.
-- Unlike is_active (which can be toggled back to false), published_at is set once and
-- never cleared, so it reliably answers "has this registration ever been published" -
-- used to permanently gate deletion: once published, a registration can only be closed
-- (via its registration end date), never deleted, even if later unpublished.

ALTER TABLE registrations
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION set_registration_published_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_active = TRUE AND NEW.published_at IS NULL THEN
        NEW.published_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER set_registrations_published_at
    BEFORE INSERT OR UPDATE OF is_active ON registrations
    FOR EACH ROW EXECUTE FUNCTION set_registration_published_at();

-- Backfill: currently-active registrations were published at least by their last update.
UPDATE registrations SET published_at = updated_at WHERE is_active = TRUE AND published_at IS NULL;

-- Backfill safety net: a registration that is a draft today but already has real
-- registrant/waitlist/discount activity must have been published at some point in the
-- past (that activity is only possible while live), even though it looks like a fresh
-- draft now. Protect it too, so pre-existing data isn't retroactively made deletable.
UPDATE registrations SET published_at = COALESCE(updated_at, created_at)
WHERE published_at IS NULL
  AND is_active = FALSE
  AND (
    EXISTS (SELECT 1 FROM user_registrations WHERE registration_id = registrations.id)
    OR EXISTS (SELECT 1 FROM waitlists WHERE registration_id = registrations.id)
    OR EXISTS (SELECT 1 FROM discount_usage WHERE registration_id = registrations.id)
  );

COMMENT ON COLUMN registrations.published_at IS 'When this registration first went live (is_active set to true). Never cleared once set. NULL means it has never been published and is still safely deletable.';
