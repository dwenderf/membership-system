import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  
  // Error filtering
  beforeSend(event) {
    // Allow critical payment errors in development for testing
    if (process.env.NODE_ENV === 'development') {
      // Only allow payment-related errors through in development
      if (event.tags?.payment_related === 'true' || event.tags?.critical === 'payment_inconsistency') {
        return event;
      }
      return null;
    }
    return event;
  },
  
  debug: false,
});