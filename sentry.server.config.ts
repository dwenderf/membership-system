import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Environment automatically set by NODE_ENV
  environment: process.env.NODE_ENV,
  
  // Performance Monitoring
  tracesSampleRate: 1.0,
  
  // Error filtering
  beforeSend(event) {
    // Allow critical payment errors and warnings in development for testing
    if (process.env.NODE_ENV === 'development') {
      // Only allow payment-related events through in development
      if (event.tags?.payment_related === 'true' || event.tags?.critical === 'payment_inconsistency') {
        return event;
      }
      return null;
    }
    return event;
  },
  
  // Set sample rate for profiling
  profilesSampleRate: 1.0,
  
  // Disable debug mode to reduce noise
  debug: false,
});