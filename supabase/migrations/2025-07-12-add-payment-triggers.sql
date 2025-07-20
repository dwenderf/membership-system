-- Create database triggers for consolidated payment processing
-- Handles both paid and free purchase completion events

-- Create notification function for payment processing events
CREATE OR REPLACE FUNCTION notify_payment_completion()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit PostgreSQL notification for async processing
    PERFORM pg_notify(
        'payment_completed',
        json_build_object(
            'event_type', TG_TABLE_NAME,
            'record_id', NEW.id,
            'user_id', NEW.user_id,
            'payment_id', CASE 
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.id 
                ELSE NEW.payment_id 
            END,
            'amount', CASE 
                WHEN TG_TABLE_NAME = 'payments' THEN NEW.final_amount
                WHEN TG_TABLE_NAME = 'user_memberships' THEN COALESCE(NEW.amount_paid, 0)
                WHEN TG_TABLE_NAME = 'user_registrations' THEN COALESCE(NEW.amount_paid, 0)
                ELSE 0
            END,
            'trigger_source', TG_TABLE_NAME,
            'timestamp', NOW()
        )::text
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for paid purchases (amount > 0) - fires when payments.status = 'completed'
CREATE TRIGGER payment_completed_trigger
    AFTER UPDATE OF status ON payments
    FOR EACH ROW 
    WHEN (OLD.status != 'completed' AND NEW.status = 'completed' AND NEW.final_amount > 0)
    EXECUTE FUNCTION notify_payment_completion();

-- Trigger for free memberships (amount = 0) - fires when payment_status = 'paid'
CREATE TRIGGER membership_completed_trigger
    AFTER INSERT OR UPDATE OF payment_status ON user_memberships
    FOR EACH ROW 
    WHEN (NEW.payment_status = 'paid' AND COALESCE(NEW.amount_paid, 0) = 0)
    EXECUTE FUNCTION notify_payment_completion();

-- Trigger for free registrations (amount = 0) - fires when payment_status = 'paid'
CREATE TRIGGER registration_completed_trigger
    AFTER INSERT OR UPDATE OF payment_status ON user_registrations
    FOR EACH ROW 
    WHEN (NEW.payment_status = 'paid' AND COALESCE(NEW.amount_paid, 0) = 0)
    EXECUTE FUNCTION notify_payment_completion();

-- Add comments for documentation
COMMENT ON FUNCTION notify_payment_completion() IS 'Triggers async processing for completed payments (emails, Xero sync, etc.)';
COMMENT ON TRIGGER payment_completed_trigger ON payments IS 'Triggers async processing for paid purchases when payment completes';
COMMENT ON TRIGGER membership_completed_trigger ON user_memberships IS 'Triggers async processing for free memberships';
COMMENT ON TRIGGER registration_completed_trigger ON user_registrations IS 'Triggers async processing for free registrations';