import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize logging first
    const { logger } = await import('./src/lib/logging/logger')
    
    logger.logSystem(
      'server-startup',
      'Next.js server starting up (Node.js runtime)',
      {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        environment: process.env.NODE_ENV,
        pid: process.pid
      }
    )

    try {
      // Initialize Sentry
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        // NODE_ENV is always "production" for a `next build` output, on both
        // Preview and Production Vercel deployments - it can't distinguish them.
        // VERCEL_ENV ("production" | "preview" | "development") can; it's unset
        // outside Vercel, where NODE_ENV is the right fallback.
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
        tracesSampleRate: 1.0,
        
        // Enhanced error context and user information
        beforeSend(event) {
          // Add server environment context
          event.extra = {
            ...event.extra,
            server_time: new Date().toISOString(),
            node_version: process.version,
            platform: process.platform,
            memory_usage: process.memoryUsage(),
            uptime: process.uptime()
          };

          // Enhanced error filtering for development
          if (process.env.NODE_ENV === 'development') {
            // Allow critical payment errors and warnings in development for testing
            if (event.tags?.payment_related === 'true' || 
                event.tags?.critical === 'payment_inconsistency' ||
                event.tags?.integration === 'xero' ||
                event.tags?.operation === 'invoice_sync' ||
                event.tags?.operation === 'payment_sync') {
              return event;
            }
            return null;
          }
          return event;
        },
        
        debug: false,
      });
      logger.logSystem('sentry-init', 'Sentry monitoring initialized')
      
      // Initialize background services for payment processing
      const { initializeServices } = await import('./src/lib/services/startup')
      await initializeServices()
      
      logger.logSystem(
        'server-ready',
        'Next.js server fully initialized and ready',
        { runtime: 'nodejs' }
      )
    } catch (error) {
      logger.logSystem(
        'server-startup-error',
        'Error during server initialization',
        { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        },
        'error'
      )
      throw error
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime doesn't support file system operations, so the
    // fs-based logger (src/lib/logging/logger.ts) can't run here -
    // console is the only option in this branch.
    // eslint-disable-next-line no-console -- deliberate: logger needs Node's fs, unavailable in Edge runtime
    console.log('🌟 Next.js Edge Runtime starting up')

    try {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
        tracesSampleRate: 1.0,

        // Error filtering
        beforeSend(event) {
          // Don't send events in development
          if (process.env.NODE_ENV === 'development') {
            return null;
          }
          return event;
        },

        debug: process.env.NODE_ENV === 'development',
      });
      // eslint-disable-next-line no-console -- deliberate: logger needs Node's fs, unavailable in Edge runtime
      console.log('🔍 Sentry Edge monitoring initialized')
    } catch (error) {
      // eslint-disable-next-line no-console -- deliberate: logger needs Node's fs, unavailable in Edge runtime
      console.error('❌ Error initializing Edge runtime:', error)
      throw error
    }
  }
}

// Add Sentry request error handler
export function onRequestError(error: Error, request: Request) {
  const requestInfo = {
    path: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries())
  }
  
  const errorContext = {
    routerKind: 'app',
    routePath: new URL(request.url).pathname,
    routeType: 'page'
  }
  
  Sentry.captureRequestError(error, requestInfo, errorContext)
}

