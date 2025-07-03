-- Fix critical RLS policy issues: Replace overly permissive policies with proper admin-only access
-- 
-- SECURITY ISSUE: Current policies allow ANY authenticated user to access admin functions
-- FIX: Restrict admin operations to users with is_admin = TRUE
--
-- Created: 2025-07-02
-- Purpose: Critical security fix for admin access control

-- Drop the problematic overly permissive policies
DROP POLICY IF EXISTS "seasons_authenticated_all" ON seasons;
DROP POLICY IF EXISTS "memberships_authenticated_all" ON memberships;
DROP POLICY IF EXISTS "registrations_authenticated_all" ON registrations;
DROP POLICY IF EXISTS "registration_pricing_tiers_authenticated_all" ON registration_pricing_tiers;
DROP POLICY IF EXISTS "discount_codes_authenticated_all" ON discount_codes;
DROP POLICY IF EXISTS "access_codes_authenticated_all" ON access_codes;

-- Create proper admin-only policies for INSERT, UPDATE, DELETE operations
-- Note: Public SELECT access remains via existing policies

-- Seasons: Admin-only management
CREATE POLICY "seasons_admin_only" ON seasons
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Memberships: Admin-only management
CREATE POLICY "memberships_admin_only" ON memberships
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Registrations: Admin-only management
CREATE POLICY "registrations_admin_only" ON registrations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Registration Pricing Tiers: Admin-only management
CREATE POLICY "registration_pricing_tiers_admin_only" ON registration_pricing_tiers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Discount Codes: Admin-only management
CREATE POLICY "discount_codes_admin_only" ON discount_codes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Access Codes: Admin-only management
CREATE POLICY "access_codes_admin_only" ON access_codes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Payment Configurations: Add missing admin-only policies
-- This table had RLS enabled but no policies (completely inaccessible)
CREATE POLICY "payment_configurations_admin_only" ON payment_configurations
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Categories: Admin-only management (for creating new category types)
CREATE POLICY "categories_admin_only" ON categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Registration Categories: Admin-only management
CREATE POLICY "registration_categories_admin_only" ON registration_categories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE id = auth.uid() AND is_admin = TRUE
        )
    );

-- Comment: The following tables keep their existing public SELECT policies
-- but now have proper admin-only restrictions for modifications:
--
-- Public read access maintained for:
-- - seasons (users need to see available seasons)
-- - memberships (users need to see membership options)  
-- - registrations (users need to see available registrations)
-- - registration_categories (users need to see categories for registration)
-- - registration_pricing_tiers (users need to see pricing)
-- - categories (users need to see category options)
--
-- Admin-only tables (no public access):
-- - discount_codes (sensitive pricing information)
-- - access_codes (security-sensitive bypass codes)
-- - payment_configurations (critical payment system settings)