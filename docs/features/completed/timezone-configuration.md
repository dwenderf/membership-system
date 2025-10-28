# Timezone Configuration

**Status**: ✅ Completed | **PR**: #8 | **Date**: October 27, 2025

The application uses a centralized timezone configuration to ensure consistent date/time display across all admin pages and reports.

## Configuration

Set the timezone in your environment file:

```bash
# .env.local
NEXT_PUBLIC_APP_TIMEZONE=America/New_York
```

Valid values are IANA timezone identifiers:
- `America/New_York` (Eastern Time - default)
- `America/Los_Angeles` (Pacific Time)
- `America/Chicago` (Central Time)
- `Europe/London`
- `UTC`
- [Full list of timezones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

## Usage

Import and use the date formatting utilities from `@/lib/date-utils`:

```typescript
import { formatDate, formatTime, formatDateTime } from '@/lib/date-utils'

// Format date only
formatDate(user.created_at) // "10/23/2025"

// Format time only
formatTime(invoice.created_at) // "2:11 PM"

// Format date and time
formatDateTime(invoice.created_at) // "10/23/2025 at 2:11 PM"
```

## Available Utilities

### `formatDate(date)`
Formats a date in the app's timezone.
- **Input**: Date object, ISO string, or timestamp
- **Output**: `"10/23/2025"`

### `formatTime(date, options?)`
Formats time in the app's timezone.
- **Input**: Date object, ISO string, or timestamp
- **Output**: `"2:11 PM"`

### `formatDateTime(date)`
Formats both date and time in the app's timezone.
- **Input**: Date object, ISO string, or timestamp
- **Output**: `"10/23/2025 at 2:11 PM"`

### `formatDateString(dateString)`
Formats a YYYY-MM-DD date string without timezone conversion.
- **Input**: `"2025-10-23"`
- **Output**: `"10/23/2025"`

## Migration Guide

### Before (incorrect - uses server timezone):
```typescript
{new Date(invoice.created_at).toLocaleDateString()}
{new Date(invoice.created_at).toLocaleTimeString()}
```

### After (correct - uses app timezone):
```typescript
import { formatDate, formatDateTime } from '@/lib/date-utils'

{formatDate(invoice.created_at)}
{formatDateTime(invoice.created_at)}
```

## Why This Matters

**Server Components** (Next.js default) render on the server, which may be in a different timezone (often UTC on Vercel). Using `.toLocaleDateString()` directly will use the server's timezone, not the user's or the application's intended timezone.

By using the utilities in `date-utils.ts`, all dates display consistently in the configured timezone regardless of where the server is located.

## Updated Pages

✅ **All pages, components, and services have been updated to use centralized date utilities**

The following categories of files have been migrated:
- **Admin Pages** (14 files) - All admin interfaces now use consistent timezone formatting
- **User Pages** (7 files) - All user-facing pages display dates in configured timezone
- **API Routes** (4 files) - All API responses use centralized date formatting
- **Components** (13 files) - All React components use timezone-aware utilities
- **Library Files** (3 files) - Email templates and logging use consistent formatting

**Verification:**
```bash
# Confirm no old patterns remain (should return 0)
grep -r "toLocaleDateString\|toLocaleTimeString" src --include="*.tsx" --include="*.ts" | grep -v "date-utils.ts" | wc -l
```
