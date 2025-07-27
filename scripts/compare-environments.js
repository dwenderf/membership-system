#!/usr/bin/env node

/**
 * Environment Comparison Script
 * 
 * This script helps identify differences between preview and production environments
 * that could cause the webhook to fail in production but work in preview.
 */

const fs = require('fs');
const path = require('path');

console.log('🌍 Environment Comparison Tool\n');

console.log('🔍 Key Differences to Check Between Preview and Production:\n');

console.log('1. 🗄️  Database Projects:');
console.log('   • Preview: Different Supabase project (development database)');
console.log('   • Production: Different Supabase project (production database)');
console.log('   • Check: Different service role keys, different data');

console.log('\n2. 🔑 Environment Variables:');
console.log('   • STRIPE_SECRET_KEY:');
console.log('     - Preview: sk_test_... (test mode)');
console.log('     - Production: sk_live_... (live mode)');
console.log('   • STRIPE_WEBHOOK_SECRET:');
console.log('     - Preview: Different webhook endpoint');
console.log('     - Production: Different webhook endpoint');
console.log('   • SUPABASE_SERVICE_ROLE_KEY:');
console.log('     - Preview: Development project service role');
console.log('     - Production: Production project service role');

console.log('\n3. 👥 User Data:');
console.log('   • Preview: Test users, test memberships, test registrations');
console.log('   • Production: Real users, real memberships, real registrations');
console.log('   • Check: Different user IDs, different membership configurations');

console.log('\n4. 🏢 Xero Integration:');
console.log('   • Preview: Test Xero organization/tenant');
console.log('   • Production: Live Xero organization/tenant');
console.log('   • Check: Different Xero app configurations');

console.log('\n5. 📧 Email Configuration:');
console.log('   • Preview: Test email templates, test Loops.so configuration');
console.log('   • Production: Live email templates, live Loops.so configuration');

console.log('\n🎯 Most Likely Causes for Webhook Failure in Production:\n');

console.log('1. 🔑 Missing SUPABASE_SERVICE_ROLE_KEY in production Vercel environment');
console.log('   • Check Vercel dashboard → Settings → Environment Variables');
console.log('   • Verify the key is set for production deployment');

console.log('\n2. 🔑 Wrong SUPABASE_SERVICE_ROLE_KEY in production');
console.log('   • Using development service role key instead of production');
console.log('   • Check if you copied the wrong key from Supabase dashboard');

console.log('\n3. 🗄️  Different Supabase projects');
console.log('   • Preview uses development database');
console.log('   • Production uses production database');
console.log('   • Different RLS policies or data structures');

console.log('\n4. 👥 Missing admin users in production');
console.log('   • RLS policies depend on admin users existing');
console.log('   • Check if admin users were created in production database');

console.log('\n🔧 Quick Diagnostic Steps:\n');

console.log('1. Check Vercel Environment Variables:');
console.log('   • Go to Vercel dashboard → Your project → Settings → Environment Variables');
console.log('   • Verify SUPABASE_SERVICE_ROLE_KEY is set for production');
console.log('   • Compare with preview environment variables');

console.log('\n2. Check Supabase Projects:');
console.log('   • Go to Supabase dashboard');
console.log('   • Verify you have separate projects for preview and production');
console.log('   • Check that service role keys are different between projects');

console.log('\n3. Test Database Connection:');
console.log('   • Make another test payment in production');
console.log('   • Check logs for "Database connection created successfully"');
console.log('   • Look for any database operation errors');

console.log('\n4. Check Admin Users:');
console.log('   • Verify admin users exist in production database');
console.log('   • Check if is_admin flag is set correctly');

console.log('\n📋 Environment Variable Checklist:\n');

const requiredVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
];

requiredVars.forEach(varName => {
  console.log(`   • ${varName}:`);
  console.log(`     - Preview: Set`);
  console.log(`     - Production: ❓ Check if set`);
});

console.log('\n🚀 Recommended Action Plan:\n');

console.log('1. 🔑 Check Vercel Environment Variables (Most Likely Fix)');
console.log('   • Verify SUPABASE_SERVICE_ROLE_KEY is set in production');
console.log('   • Ensure it\'s the production service role key, not development');

console.log('\n2. 🧪 Make Test Payment');
console.log('   • Use the enhanced logging we added');
console.log('   • Check for specific error messages');

console.log('\n3. 🔍 Compare Supabase Projects');
console.log('   • Verify different projects for preview vs production');
console.log('   • Check that service role keys are different');

console.log('\n4. 👥 Verify Admin Users');
console.log('   • Check if admin users exist in production database');
console.log('   • Verify is_admin flag is set correctly');

console.log('\n✨ Environment comparison complete!');
console.log('\n💡 Tip: The most common cause is missing SUPABASE_SERVICE_ROLE_KEY in production Vercel environment variables.'); 