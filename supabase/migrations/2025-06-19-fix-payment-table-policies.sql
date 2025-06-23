-- Fix missing RLS policies for payments and payment_items tables
-- This allows payment records to be created and accessed properly

-- Payments table policies
CREATE POLICY "Users can view their own payments" ON payments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payments" ON payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own payments" ON payments
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all payments" ON payments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Payment items table policies  
CREATE POLICY "Users can view their own payment items" ON payment_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM payments 
            WHERE payments.id = payment_items.payment_id 
            AND payments.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert payment items for their payments" ON payment_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM payments 
            WHERE payments.id = payment_items.payment_id 
            AND payments.user_id = auth.uid()
        )
    );

CREATE POLICY "Admins can view all payment items" ON payment_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );