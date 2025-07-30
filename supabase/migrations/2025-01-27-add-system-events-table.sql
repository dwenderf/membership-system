-- Create system_events table for tracking sync operations and other system events
CREATE TABLE system_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL, -- 'email_sync', 'xero_sync', 'maintenance', etc.
  status TEXT NOT NULL, -- 'success', 'failed', 'partial'
  initiator TEXT NOT NULL, -- 'cron_job', 'manual (first last)', 'system'
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  records_processed INTEGER DEFAULT 0,
  records_successful INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB, -- Additional event-specific data
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for efficient querying
CREATE INDEX idx_system_events_event_type ON system_events(event_type);
CREATE INDEX idx_system_events_status ON system_events(status);
CREATE INDEX idx_system_events_initiator ON system_events(initiator);
CREATE INDEX idx_system_events_started_at ON system_events(started_at);
CREATE INDEX idx_system_events_completed_at ON system_events(completed_at);

-- Add RLS policies
ALTER TABLE system_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read system events
CREATE POLICY "Admins can read system events" ON system_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.is_admin = true
    )
  );

-- Only system/service role can insert/update system events
CREATE POLICY "Service role can manage system events" ON system_events
  FOR ALL USING (
    auth.role() = 'service_role'
  );

-- Add comments for documentation
COMMENT ON TABLE system_events IS 'Tracks system events like sync operations, maintenance tasks, etc.';
COMMENT ON COLUMN system_events.event_type IS 'Type of event: email_sync, xero_sync, maintenance, etc.';
COMMENT ON COLUMN system_events.status IS 'Event status: success, failed, partial';
COMMENT ON COLUMN system_events.initiator IS 'Who/what initiated the event: cron_job, manual (user name), system';
COMMENT ON COLUMN system_events.metadata IS 'Additional event-specific data as JSON'; 