# Development Scripts

This directory contains utility scripts for development, testing, and administration.

## 📁 Directory Structure

### `/tests/` - Test Scripts
Scripts for testing specific functionality during development.

- `test-payment-processor.js` - Test payment completion processor functionality
- `test-logging-system.js` - Test structured logging system components

**Usage:**
```bash
cd scripts/tests
node test-payment-processor.js
```

### `/debug/` - Debug Scripts  
Scripts for troubleshooting and debugging specific issues.

- `debug-registrations.js` - Debug registration system issues
- `debug-browse-flow.js` - Debug user browsing and registration flow
- `debug-rls.js` - Debug Row Level Security (RLS) policy issues

**Usage:**
```bash
cd scripts/debug
node debug-registrations.js
```

### `/admin/` - Administrative Scripts
Scripts for database maintenance and administrative tasks.

- `apply-rls-fix.js` - Apply RLS policy fixes to database
- `apply-rls-fix-direct.js` - Direct RLS policy application script

**Usage:**
```bash
cd scripts/admin
node apply-rls-fix.js
```

## 🗄️ SQL Utility Scripts

SQL scripts for database diagnostics and maintenance. These scripts are located in the root `scripts/` directory.

### Payment Plan Scripts

#### `check-orphaned-payment-plans.sql`
Identifies and diagnoses payment plan invoices that have no linked user_registration record.

**What it does:**
- Finds all payment plan invoices without a user_registration link
- Shows user details, invoice amounts, and payment status
- Checks if registration IDs from staging_metadata exist in the database
- Provides diagnostic information to determine if registrations are missing or just unlinked

**Usage:**
```bash
# Using psql
psql $DATABASE_URL -f scripts/check-orphaned-payment-plans.sql

# Using Supabase CLI
npx supabase db execute --db-url "$DATABASE_URL" < scripts/check-orphaned-payment-plans.sql
```

**Output includes:**
- Orphaned invoice details (ID, invoice number, user info)
- Missing registration ID and name from staging_metadata
- Number of installments and amount paid
- Status indicating if registration exists but is unlinked vs completely missing

## 🔧 Script Development Guidelines

### File Naming Convention
- `test-<feature>.js` - Feature testing scripts
- `debug-<issue>.js` - Issue debugging scripts  
- `apply-<fix>.js` - Administrative fix scripts
- `migrate-<task>.js` - Data migration scripts

### Script Structure
```javascript
/**
 * Script: Purpose description
 * Usage: How to run the script
 * Requirements: Any setup needed
 */

import { config } from 'dotenv'
config() // Load environment variables

// Script implementation
async function main() {
  try {
    console.log('🔧 Starting script...')
    // Implementation
    console.log('✅ Script completed successfully')
  } catch (error) {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }
}

main()
```

### Best Practices
- **Always load environment variables** with dotenv
- **Include clear logging** with emojis for status
- **Handle errors gracefully** with proper exit codes  
- **Document script purpose** and usage in file header
- **Use async/await** for database operations
- **Clean up resources** (database connections, etc.)

### Environment Requirements
Most scripts require these environment variables:
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key  
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

## 🚨 Important Notes

### Security
- **Admin scripts** may require elevated permissions
- **Never commit** scripts containing secrets or production data
- **Test scripts** should use development/staging databases only

### Git Practices
- **Commit useful scripts** that others might need
- **Add to .gitignore** any scripts with sensitive data
- **Document breaking changes** to existing scripts

### Future Organization
As the project grows, consider these additional directories:
- `/migrations/` - Database migration scripts
- `/seed/` - Database seeding scripts
- `/monitoring/` - Health check and monitoring scripts
- `/deployment/` - Deployment automation scripts

---

*This directory helps maintain organized development tools and ensures scripts are discoverable by the team.*