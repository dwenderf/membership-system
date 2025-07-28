import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  
  // Enhanced error filtering for development
  beforeSend(event) {
    // Allow critical payment errors and warnings in development for testing
    if (process.env.NODE_ENV === 'development') {
      // Allow payment-related errors, Xero integration errors, and critical errors through in development
      if (event.tags?.payment_related === 'true' || 
          event.tags?.critical === 'payment_inconsistency' ||
          event.tags?.integration === 'xero' ||
          event.tags?.operation === 'invoice_sync' ||
          event.tags?.operation === 'payment_sync' ||
          event.tags?.test === 'sentry_enhancement') {
        return event;
      }
      return null;
    }
    return event;
  },
  
  debug: false,
});

// Router instrumentation
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart; 