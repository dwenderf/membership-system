#!/usr/bin/env node

/**
 * Database Schema Comparison Script
 * 
 * This script helps identify potential schema differences between preview and production
 * by analyzing the current schema.sql and migration files.
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Database Schema Comparison Tool\n');

// Read the current schema
const schemaPath = path.join(__dirname, '../supabase/schema.sql');
const migrationsPath = path.join(__dirname, '../supabase/migrations');

if (!fs.existsSync(schemaPath)) {
  console.error('❌ schema.sql not found at:', schemaPath);
  process.exit(1);
}

// Read schema file
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

// Extract table definitions
const tableMatches = schemaContent.match(/CREATE TABLE [^;]+;/g) || [];
const tables = {};

tableMatches.forEach(match => {
  const tableNameMatch = match.match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/);
  if (tableNameMatch) {
    const tableName = tableNameMatch[1];
    tables[tableName] = match;
  }
});

console.log(`📊 Found ${Object.keys(tables).length} tables in schema.sql:\n`);

// List all tables
Object.keys(tables).sort().forEach(tableName => {
  console.log(`  • ${tableName}`);
});

// Check for critical tables that the webhook depends on
const criticalTables = [
  'users',
  'payments', 
  'user_memberships',
  'user_registrations',
  'xero_invoices',
  'xero_payments'
];

console.log('\n🔍 Checking critical tables for webhook processing:\n');

criticalTables.forEach(tableName => {
  if (tables[tableName]) {
    console.log(`✅ ${tableName} - EXISTS`);
    
    // Check for critical columns
    const tableDef = tables[tableName];
    const criticalColumns = getCriticalColumns(tableName);
    
    criticalColumns.forEach(column => {
      if (tableDef.includes(column)) {
        console.log(`   ✅ ${column}`);
      } else {
        console.log(`   ❌ ${column} - MISSING`);
      }
    });
  } else {
    console.log(`❌ ${tableName} - MISSING`);
  }
});

// Check recent migrations
console.log('\n📋 Recent migrations that might affect webhook processing:\n');

const migrationFiles = fs.readdirSync(migrationsPath)
  .filter(file => file.endsWith('.sql'))
  .sort()
  .reverse()
  .slice(0, 10); // Last 10 migrations

migrationFiles.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
  const hasWebhookRelevantChanges = content.includes('payments') || 
                                   content.includes('user_memberships') || 
                                   content.includes('user_registrations') ||
                                   content.includes('xero_');
  
  if (hasWebhookRelevantChanges) {
    console.log(`🔧 ${file} - WEBHOOK RELEVANT`);
  } else {
    console.log(`   ${file}`);
  }
});

// Check for potential issues
console.log('\n⚠️  Potential Issues to Check:\n');

console.log('1. Environment Variables:');
console.log('   • STRIPE_SECRET_KEY (different between preview/production)');
console.log('   • STRIPE_WEBHOOK_SECRET (different between preview/production)');
console.log('   • SUPABASE_URL (different between preview/production)');
console.log('   • SUPABASE_SERVICE_ROLE_KEY (different between preview/production)');

console.log('\n2. Database Connection:');
console.log('   • Check if production database is accessible');
console.log('   • Verify RLS policies are identical');
console.log('   • Check if any tables have different constraints');

console.log('\n3. Data Differences:');
console.log('   • Different user data between environments');
console.log('   • Different membership/registration configurations');
console.log('   • Different payment records');

console.log('\n4. Next Steps:');
console.log('   • Check the webhook logs for the specific error after payment');
console.log('   • Verify the payment intent metadata matches expected format');
console.log('   • Test with a simple payment in production to see full error');

function getCriticalColumns(tableName) {
  const columnMap = {
    'users': ['id', 'email', 'first_name', 'last_name'],
    'payments': ['id', 'user_id', 'stripe_payment_intent_id', 'status', 'total_amount'],
    'user_memberships': ['id', 'user_id', 'membership_id', 'stripe_payment_intent_id', 'payment_status'],
    'user_registrations': ['id', 'user_id', 'registration_id', 'payment_status'],
    'xero_invoices': ['id', 'payment_id', 'sync_status', 'staging_metadata'],
    'xero_payments': ['id', 'payment_id', 'sync_status', 'staging_metadata']
  };
  
  return columnMap[tableName] || [];
}

console.log('\n✨ Schema comparison complete!'); 