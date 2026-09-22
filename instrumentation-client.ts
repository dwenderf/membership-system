import * as Sentry from "@sentry/nextjs";

// Wallet, password-manager, and ad-blocker browser extensions inject scripts into every
// page; when their own handshake fails (e.g. MetaMask's "Failed to connect" when no wallet
// is unlocked) they throw on `window`, and the Sentry browser SDK captures it as if it were
// an application error even though none of our code is on the stack. Matching the frame's
// URL scheme, rather than a specific extension's error message, filters this noise broadly
// instead of chasing one extension's wording at a time.
const EXTENSION_FRAME_PATTERN =
  /^(chrome|moz|safari|safari-web)-extension:\/\/|^webkit-masked-url:\/\/|^app:\/\//i;

function isFromBrowserExtension(event: Sentry.ErrorEvent): boolean {
  const frames =
    event.exception?.values?.flatMap((value) => value.stacktrace?.frames ?? []) ?? [];
  return frames.some(
    (frame) => frame.filename && EXTENSION_FRAME_PATTERN.test(frame.filename)
  );
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // NODE_ENV is always "production" in a client build, on both Preview and
  // Production Vercel deployments - it can't distinguish them. Vercel exposes
  // the real distinction to the browser only via the NEXT_PUBLIC_ prefix.
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 1.0,

  // Belt-and-suspenders with beforeSend below: denyUrls matches on the top stack frame /
  // request URL, which covers most extension-originated events cheaply. beforeSend also
  // checks every frame, since an extension can appear lower in the stack.
  denyUrls: [
    /^chrome-extension:\/\//i,
    /^moz-extension:\/\//i,
    /^safari-extension:\/\//i,
    /^safari-web-extension:\/\//i,
    /^webkit-masked-url:\/\//i,
    /^app:\/\//i,
  ],

  // Enhanced error filtering for development
  beforeSend(event) {
    if (isFromBrowserExtension(event)) {
      return null;
    }

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