-- Add event/scrimmage date fields to registrations table
-- These fields store the actual start/end datetime of the event or scrimmage
-- Only applicable to registrations with type='event' or type='scrimmage'
-- Teams will have these fields as NULL

-- Add start_date column (when the event/scrimmage starts)
ALTER TABLE registrations
ADD COLUMN start_date TIMESTAMP WITH TIME ZONE;

-- Add end_date column (when the event/scrimmage ends)
ALTER TABLE registrations
ADD COLUMN end_date TIMESTAMP WITH TIME ZONE;

-- Add constraint to ensure end_date is after start_date when both are set
-- Allows both NULL (for teams) or both set with valid ordering (for events/scrimmages)
ALTER TABLE registrations
ADD CONSTRAINT check_event_date_order CHECK (
    (start_date IS NULL AND end_date IS NULL) OR
    (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
);

-- Add index for querying upcoming events (end_date >= now)
-- Used in user dashboards to show active/future events
CREATE INDEX idx_registrations_end_date ON registrations(end_date)
WHERE end_date IS NOT NULL;

-- Add index for querying events by start date
-- Used for sorting and filtering events chronologically
CREATE INDEX idx_registrations_start_date ON registrations(start_date)
WHERE start_date IS NOT NULL;

-- Add composite index for date range queries
-- Optimizes queries filtering by both start and end dates
CREATE INDEX idx_registrations_date_range ON registrations(start_date, end_date)
WHERE start_date IS NOT NULL AND end_date IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN registrations.start_date IS 'Start datetime of the event/scrimmage (NULL for team registrations, required for events/scrimmages). Stored in UTC, displayed in Eastern Time.';
COMMENT ON COLUMN registrations.end_date IS 'End datetime of the event/scrimmage (NULL for team registrations, required for events/scrimmages). Stored in UTC, displayed in Eastern Time. Must be >= start_date.';
