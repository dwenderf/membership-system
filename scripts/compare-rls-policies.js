#!/usr/bin/env node

/**
 * RLS Policy Comparison Script
 * 
 * This script helps identify potential RLS policy differences between environments
 * by analyzing migration files and identifying RLS-related changes.
 */

const fs = require('fs');
const path = require('path');

console.log('🔒 RLS Policy Comparison Tool\n');

// Read the current schema
const schemaPath = path.join(__dirname, '../supabase/schema.sql');
const migrationsPath = path.join(__dirname, '../supabase/migrations');

if (!fs.existsSync(schemaPath)) {
  console.error('❌ schema.sql not found at:', schemaPath);
  process.exit(1);
}

// Read schema file
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

// Extract RLS-related information
const rlsTables = [];
const rlsMatches = schemaContent.match(/ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY;/g) || [];

rlsMatches.forEach(match => {
  const tableMatch = match.match(/ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY;/);
  if (tableMatch) {
    rlsTables.push(tableMatch[1]);
  }
});

console.log(`🔒 Found ${rlsTables.length} tables with RLS enabled:\n`);

// List all RLS-enabled tables
rlsTables.sort().forEach(tableName => {
  console.log(`  • ${tableName}`);
});

// Check for critical tables that the webhook depends on
const criticalRLSTables = [
  'payments',
  'user_memberships', 
  'user_registrations',
  'xero_invoices',
  'xero_payments'
];

console.log('\n🔍 Checking critical RLS tables for webhook processing:\n');

criticalRLSTables.forEach(tableName => {
  if (rlsTables.includes(tableName)) {
    console.log(`✅ ${tableName} - RLS ENABLED`);
  } else {
    console.log(`❌ ${tableName} - RLS NOT ENABLED`);
  }
});

// Check recent migrations for RLS changes
console.log('\n📋 Recent migrations with RLS changes:\n');

const migrationFiles = fs.readdirSync(migrationsPath)
  .filter(file => file.endsWith('.sql'))
  .sort()
  .reverse();

let rlsMigrationCount = 0;

migrationFiles.forEach(file => {
  const content = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
  const hasRLSChanges = content.includes('ROW LEVEL SECURITY') || 
                       content.includes('CREATE POLICY') ||
                       content.includes('DROP POLICY') ||
                       content.includes('ALTER TABLE') && content.includes('ENABLE ROW LEVEL SECURITY');
  
  if (hasRLSChanges) {
    console.log(`🔒 ${file} - RLS CHANGES`);
    rlsMigrationCount++;
    
    // Extract specific RLS changes
    const policyMatches = content.match(/CREATE POLICY[^;]+;/g) || [];
    const enableMatches = content.match(/ALTER TABLE \w+ ENABLE ROW LEVEL SECURITY;/g) || [];
    
    if (policyMatches.length > 0) {
      console.log(`   📝 ${policyMatches.length} policies created`);
    }
    if (enableMatches.length > 0) {
      console.log(`   ✅ ${enableMatches.length} tables enabled for RLS`);
    }
  }
});

if (rlsMigrationCount === 0) {
  console.log('   No recent RLS changes found');
}

// Check for specific RLS policies in schema
console.log('\n🔍 Current RLS Policies in Schema:\n');

const policyMatches = schemaContent.match(/CREATE POLICY[^;]+;/g) || [];
const policies = {};

policyMatches.forEach(match => {
  const policyMatch = match.match(/CREATE POLICY "([^"]+)" ON (\w+)/);
  if (policyMatch) {
    const policyName = policyMatch[1];
    const tableName = policyMatch[2];
    
    if (!policies[tableName]) {
      policies[tableName] = [];
    }
    policies[tableName].push(policyName);
  }
});

Object.keys(policies).sort().forEach(tableName => {
  console.log(`📋 ${tableName}:`);
  policies[tableName].forEach(policyName => {
    console.log(`   • ${policyName}`);
  });
});

// Check for potential RLS issues
console.log('\n⚠️  Potential RLS Issues to Check:\n');

console.log('1. Service Role Access:');
console.log('   • Verify SUPABASE_SERVICE_ROLE_KEY is set correctly in production');
console.log('   • Service role should bypass RLS policies');
console.log('   • Check if service role key is different between environments');

console.log('\n2. Admin User Access:');
console.log('   • Verify admin users exist in production database');
console.log('   • Check if admin users have correct permissions');
console.log('   • Verify is_admin flag is set correctly');

console.log('\n3. Policy Differences:');
console.log('   • Check if RLS policies are identical between environments');
console.log('   • Verify policy conditions match expected data');
console.log('   • Check for environment-specific policy conditions');

console.log('\n4. Common RLS Issues:');
console.log('   • Missing service role key in environment variables');
console.log('   • Different admin user configurations');
console.log('   • Policy conditions that depend on environment-specific data');
console.log('   • Missing policies for critical tables');

console.log('\n5. Quick Fixes to Try:');
console.log('   • Verify SUPABASE_SERVICE_ROLE_KEY in production environment');
console.log('   • Check if admin users exist in production database');
console.log('   • Test with a simple database query using service role');

console.log('\n6. Debugging Commands:');
console.log('   • Check Vercel environment variables for production');
console.log('   • Verify Supabase project settings');
console.log('   • Test database connection with service role');

console.log('\n✨ RLS comparison complete!');

// Additional analysis for webhook-specific tables
console.log('\n🎯 Webhook-Specific RLS Analysis:\n');

const webhookTables = ['payments', 'user_memberships', 'user_registrations', 'xero_invoices', 'xero_payments'];

webhookTables.forEach(tableName => {
  console.log(`📊 ${tableName}:`);
  
  if (rlsTables.includes(tableName)) {
    console.log(`   ✅ RLS Enabled`);
    
    if (policies[tableName]) {
      console.log(`   📝 ${policies[tableName].length} policies:`);
      policies[tableName].forEach(policyName => {
        console.log(`      • ${policyName}`);
      });
    } else {
      console.log(`   ⚠️  No policies found (table enabled but no policies)`);
    }
  } else {
    console.log(`   ❌ RLS Not Enabled`);
  }
}); 