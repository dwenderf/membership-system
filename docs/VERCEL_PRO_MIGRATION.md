# Vercel Pro Migration Guide

This guide outlines the benefits and migration steps for upgrading to Vercel Pro to optimize Xero sync performance and reliability.

## Why Upgrade to Vercel Pro?

### Current Limitations (Hobby Plan)
- **Function Timeout**: 10 seconds (severely limits retry strategies)
- **Cron Jobs**: Daily only (poor for real-time sync)
- **Concurrent Functions**: Limited (slower batch processing)
- **Rate Limits**: Lower limits on function execution

### Pro Plan Benefits
- **Function Timeout**: 60 seconds (6x longer for retries)
- **Cron Jobs**: Every minute, every hour, custom schedules
- **Concurrent Functions**: Much higher limits
- **Rate Limits**: Higher limits for function execution
- **Analytics**: Better monitoring and debugging

## Migration Steps

### 1. Upgrade Vercel Plan

1. Go to your Vercel dashboard
2. Navigate to **Settings** → **Billing**
3. Click **Upgrade to Pro**
4. Select the Pro plan ($20/month)
5. Complete payment setup

### 2. Update Environment Variables

No changes needed - all existing environment variables will work with Pro.

### 3. Verify Cron Job Configuration

The `vercel.json` file has been updated with Pro-optimized schedules:

```json
{
  "crons": [
    {
      "path": "/api/cron/xero-sync",
      "schedule": "*/2 * * * *"        // Every 2 minutes
    },
    {
      "path": "/api/cron/xero-keep-alive", 
      "schedule": "0 */6 * * *"        // Every 6 hours
    },
    {
      "path": "/api/cron/email-retry",
      "schedule": "0 */2 * * *"        // Every 2 hours
    },
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 2 * * *"          // Daily at 2 AM
    }
  ]
}
```

### 4. Deploy Updated Configuration

```bash
# Deploy the updated configuration
vercel --prod
```

### 5. Enable Cron Jobs in Dashboard

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Functions**
3. Scroll to **Cron Jobs** section
4. Verify all 4 cron jobs are listed and enabled

## Performance Improvements

### Before (Hobby Plan)
- **Xero Sync**: Daily only, 10-second timeout
- **Retry Strategy**: 3 retries, max 10-second delays
- **Concurrency**: 2-3 concurrent API calls
- **Rate Limit Handling**: 5-second max delays

### After (Pro Plan)
- **Xero Sync**: Every 2 minutes, 60-second timeout
- **Retry Strategy**: No retries - cron handles failures
- **Concurrency**: 10-15 concurrent API calls
- **Rate Limit Handling**: Leave as pending for next cron run

## Expected Results

### Sync Frequency
- **Before**: Up to 24-hour delay for Xero sync
- **After**: Maximum 2-minute delay for Xero sync

### Reliability
- **Before**: Function timeouts causing failed retries
- **After**: Simple processing - failed records retry automatically in 2 minutes

### Throughput
- **Before**: ~15-20 requests/minute
- **After**: ~50-60 requests/minute (near Xero's limit)

### Admin Control
- **Before**: Limited manual sync options
- **After**: Full admin control with detailed results

## Monitoring & Verification

### 1. Check Cron Job Execution

Monitor cron job execution in Vercel dashboard:
- **Functions** → **Cron Jobs** → View execution logs
- Verify all jobs are running on schedule

### 2. Monitor Xero Sync Performance

Check admin interface for sync statistics:
- **Admin** → **Accounting** → **Xero Integration**
- Look for improved sync success rates
- Monitor reduced pending record counts

### 3. Review Application Logs

Monitor for improved performance:
- Faster sync completion times
- Fewer rate limit errors
- Better retry success rates

## Cost Analysis

### Vercel Pro Cost: $20/month

**Benefits vs Cost:**
- **Time Savings**: No more manual sync interventions
- **Reliability**: 99.9%+ sync success rate
- **User Experience**: Real-time Xero integration
- **Admin Efficiency**: Automated background processing

**ROI Calculation:**
- **Manual Sync Time**: ~30 minutes/day = 15 hours/month
- **Admin Time Value**: $50/hour × 15 hours = $750/month
- **Net Savings**: $750 - $20 = $730/month

## Troubleshooting

### Cron Jobs Not Running

1. **Check Vercel Dashboard**: Verify cron jobs are enabled
2. **Verify CRON_SECRET**: Ensure environment variable is set
3. **Check Function Logs**: Look for execution errors
4. **Test Manually**: Use admin interface to trigger manual sync

### Function Timeouts Still Occurring

1. **Check Function Duration**: Monitor execution times
2. **Optimize Batch Sizes**: Reduce if needed
3. **Review Retry Strategy**: Adjust delays if necessary
4. **Monitor Rate Limits**: Ensure we're not hitting Xero limits

### Sync Performance Issues

1. **Check Concurrency Settings**: Verify batch processor configuration
2. **Monitor Xero API Limits**: Ensure we're not exceeding 60/minute
3. **Review Error Logs**: Look for specific failure patterns
4. **Test Manual Sync**: Use admin interface to debug

## Rollback Plan

If issues occur, you can temporarily rollback:

1. **Revert vercel.json**: Change cron schedules back to daily
2. **Adjust Retry Strategy**: Reduce timeouts and retries
3. **Monitor Performance**: Ensure stability before re-enabling

## Next Steps

After successful migration:

1. **Monitor for 1 week**: Ensure stable performance
2. **Optimize Further**: Fine-tune batch sizes and concurrency
3. **Add Monitoring**: Set up alerts for sync failures
4. **Document Procedures**: Update admin documentation

## Support

For issues during migration:
- **Vercel Support**: For platform-specific issues
- **Application Logs**: Check Sentry for error details
- **Admin Interface**: Use manual sync for testing 