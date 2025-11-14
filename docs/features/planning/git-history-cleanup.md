# Git History Cleanup - Remove PII and Exposed Credentials

## Why This Needs to Be Done

During development and debugging, several files containing Personally Identifiable Information (PII) and sensitive credentials were committed to the Git repository and pushed to GitHub. Even though these files have been deleted and credentials have been reset, they remain visible in the Git commit history.

### Specific Issues:

1. **Exposed Database Password**
   - File: `scripts/admin/apply-rls-fix-direct.js`
   - Commit: `1e1ed2e`
   - Contains: Direct PostgreSQL connection string with database password
   - Status: ✅ Password has been reset in Supabase, old password is now invalid
   - Risk: Low (password reset), but should be removed from history for security best practices

2. **Exposed Legacy Supabase API Keys**
   - File: `scripts/admin/apply-rls-fix.js`
   - Contains: Legacy `service_role` and `anon` API keys (JWT tokens)
   - Status: ✅ Legacy API access disabled in Supabase (both preview and production)
   - Confirmed: Production app uses current API keys, not legacy ones
   - Risk: Low (legacy access disabled), but should be removed from history

3. **User PII in Debug Scripts**
   - Files: Various debug scripts in `scripts/debug/`
   - Contains: User emails, names, UUIDs from production database
   - Examples:
     - `scripts/debug/test-loops-direct.js` - Contains `david.wender@nycgha.org`
     - `scripts/debug/debug-xero-contacts.js` - References to specific user names
   - Risk: Medium - production user data should not be in version control

4. **Temporary Debug SQL Scripts**
   - Created during Oct/Nov 2025 debugging session for stuck invoices
   - Contained hardcoded production user IDs and emails
   - Status: ✅ Deleted from working tree, but remain in history

## Current Status

- ✅ Database password has been reset in Supabase
- ✅ Legacy Supabase API access disabled (both preview and production)
- ✅ Production confirmed working with current API keys (not legacy ones)
- ✅ Files with PII and credentials have been deleted from `development` branch
- ⚠️ All sensitive data is still visible in Git commit history on GitHub
- ⚠️ Anyone with access to the repository can view historical commits

**Security Impact:** Low - All exposed credentials have been invalidated or disabled. History cleanup is now for compliance/best practices rather than active security risk.

## Solution: Clean Git History with BFG Repo Cleaner

BFG Repo Cleaner is a faster, simpler alternative to `git filter-branch` for removing unwanted data from Git history.

### Prerequisites

**Install BFG Repo Cleaner:**

```bash
# macOS
brew install bfg

# Windows (requires Java)
# Download from: https://rtyley.github.io/bfg-repo-cleaner/

# Linux
# Download the JAR file from: https://rtyley.github.io/bfg-repo-cleaner/
```

### Step-by-Step Instructions

#### 1. Backup Your Repository

```bash
# Create a backup of your current repository
cd ~/
cp -r membership-system membership-system-backup
```

#### 2. Clone a Fresh Mirror Copy

```bash
# Clone a bare/mirror copy (this is required for BFG)
cd ~/
git clone --mirror git@github.com:dwenderf/membership-system.git membership-system-cleanup
cd membership-system-cleanup
```

#### 3. Create Replacement Text File

Create a file with all sensitive strings to replace:

```bash
cat > ../sensitive-data.txt << 'EOF'
***EXAMPLE_PASSWORD***
user@example.com
00000000-0000-0000-0000-000000000000
11111111-1111-1111-1111-111111111111
user1@example.com
user2@example.com
EOF
```

#### 4. Run BFG to Clean History

```bash
# Replace all occurrences of sensitive data with ***REMOVED***
bfg --replace-text ../sensitive-data.txt

# Alternatively, to delete specific files entirely from history:
bfg --delete-files "apply-rls-fix-direct.js"
bfg --delete-files "test-loops-direct.js"
```

#### 5. Clean Up Git Repository

```bash
# Expire all reflog entries
git reflog expire --expire=now --all

# Run garbage collection to remove old data
git gc --prune=now --aggressive
```

#### 6. Verify Changes

```bash
# Search for the old password - should return nothing
git log --all --source --full-history -S 'YOUR_OLD_PASSWORD_HERE'

# Search for email addresses - should return nothing
git log --all --source --full-history -S 'user@example.com'
```

#### 7. Force Push to GitHub

⚠️ **WARNING:** This will rewrite history on GitHub. All collaborators will need to re-clone.

```bash
# Push the cleaned history
git push --force
```

#### 8. Update Your Local Working Repository

```bash
# Go back to your working repository
cd ~/membership-system

# Fetch the cleaned history
git fetch origin

# Reset all branches to match the cleaned remote
git checkout main
git reset --hard origin/main

git checkout development
git reset --hard origin/development

# Clean up local reflog
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

#### 9. Notify Collaborators (if any)

If anyone else has cloned the repository, they need to:

```bash
# Delete their local copy and re-clone
rm -rf membership-system
git clone git@github.com:dwenderf/membership-system.git
```

## Alternative: Selective File Deletion

If you only want to remove specific files without replacing text:

```bash
# Clone mirror
git clone --mirror git@github.com:dwenderf/membership-system.git

# Remove specific file from all history
cd membership-system.git
bfg --delete-files apply-rls-fix-direct.js
bfg --delete-files test-loops-direct.js

# Clean up and push
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force
```

## What Gets Cleaned

### Files to Remove Entirely:
- `scripts/admin/apply-rls-fix-direct.js` (database password)
- `scripts/admin/apply-rls-fix.js` (legacy Supabase API keys)
- `scripts/debug/test-loops-direct.js` (user email and name)
- `scripts/debug/debug-xero-contacts.js` (references to specific users)
- Any temporary SQL scripts with hardcoded UUIDs (already deleted)

### Strings to Replace:
- Database password: `***EXAMPLE_PASSWORD***` → `***REMOVED***`
- User emails: `user@example.com`, `user1@example.com`, etc.
- Specific user UUIDs from debugging sessions

## Post-Cleanup Verification

1. **Check GitHub**: Browse repository history on GitHub to verify sensitive data is gone
2. **Search locally**:
   ```bash
   git log --all -S 'YOUR_OLD_PASSWORD_HERE'  # Should return nothing
   git log --all -S 'user@example'             # Should return nothing
   ```
3. **Test production**: Verify application still works (it will - we're only cleaning history)

## Risk Assessment

### Before Remediation:
- 🔴 Database password exposed in commit history
- 🔴 Legacy Supabase API keys exposed in commit history
- 🟡 Production user PII visible in commit history
- 🟡 Debug scripts with hardcoded production data

### After Credential Invalidation (Current State):
- ✅ Database password reset - old password no longer works
- ✅ Legacy API access disabled - old API keys no longer work
- ✅ Production confirmed working with current credentials
- ⚠️ Exposed data still in Git history (compliance issue, not security risk)

### After Git History Cleanup:
- ✅ All sensitive data removed from Git history
- ✅ No trace of invalidated credentials
- ✅ User PII scrubbed from version control
- ✅ Clean history for future compliance/auditing
- ✅ Ready for external audits or code reviews

## References

- [BFG Repo Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [Git Tools - Rewriting History](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History)

## Timeline

- **2025-11-10**: Issue identified during debugging session for stuck invoices
- **2025-11-10**: Database password reset in Supabase
- **2025-11-10**: Legacy Supabase API keys identified
- **2025-11-10**: Legacy API access disabled in Supabase (preview and production)
- **2025-11-10**: Production tested and confirmed working with current keys
- **2025-11-10**: Files with PII and credentials deleted from working tree
- **Status**: Waiting for Git history cleanup to be performed
- **Priority**: Low (all credentials invalidated/disabled, cleanup for compliance/best practices)

## Notes

- This is a one-time cleanup operation
- Future prevention: Use `.gitignore` for debug scripts, never commit credentials
- Consider adding pre-commit hooks to detect PII/credentials before commit
