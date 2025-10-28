# Xero Keep-Alive System

**Status**: ⏸️ Deferred

This feature was originally planned to prevent Xero OAuth tokens from expiring by making regular API calls to refresh the tokens automatically. After implementation and testing, it was determined that this approach is not needed as Xero tokens are automatically refreshed during normal system operation when needed.

---

## Original Proposal

This system prevents Xero OAuth tokens from expiring by making regular API calls to refresh the tokens automatically.

## How it works

1. **Keep-alive endpoint** (`/api/xero/keep-alive`) makes lightweight API calls to all active Xero tenants
2. **Scheduled cron job** (`/api/cron/xero-keep-alive`) runs daily via Vercel Cron (requires Pro plan for more frequent runs)
3. **Token refresh** happens automatically when tokens are close to expiration

## Setup

### 1. Environment Variables

Add this to your environment variables (Vercel dashboard or `.env.local`):

```bash
# Cron job security - generate a random secret
CRON_SECRET=your-random-secret-string-here
```

### 2. Vercel Cron Configuration

The `vercel.json` file is already configured to run the keep-alive every 12 hours:

```json
{
  "crons": [
    {
      "path": "/api/cron/xero-keep-alive", 
      "schedule": "0 */12 * * *"
    }
  ]
}
```

### 3. Manual Testing

You can manually test the keep-alive system:

```bash
# Test keep-alive endpoint directly
curl -X POST https://your-domain.com/api/xero/keep-alive

# Test scheduled cron (requires CRON_SECRET)
curl -X GET https://your-domain.com/api/cron/xero-keep-alive \
  -H "Authorization: Bearer your-cron-secret"
```

## Schedule Options

Current schedule: `0 0 * * *` (daily at midnight)

You can adjust the schedule in `vercel.json`:
- `0 */6 * * *` - Every 6 hours  
- `0 0,12 * * *` - Daily at midnight and noon
- `0 */4 * * *` - Every 4 hours (more frequent)

## Monitoring

The system logs all activity to the console:
- `🏓 Xero keep-alive ping started`
- `✅ Xero ping successful for: [Organization Name]`
- `❌ Xero ping failed for tenant [Name]: [Error]`

## Benefits

- **Prevents token expiration** - No more manual re-authentication needed
- **Automatic token refresh** - Refreshes tokens before they expire
- **Multiple tenant support** - Works with multiple Xero organizations
- **Error handling** - Continues working even if some tenants fail
- **Logging** - Full visibility into keep-alive status

## Notes

- Xero tokens expire after 30 minutes of inactivity
- Refresh tokens expire after 60 days (this system prevents that)
- The system makes lightweight API calls (just fetching organization info)
- Failed pings don't affect successful tenants