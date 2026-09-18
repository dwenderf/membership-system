import * as Sentry from '@sentry/nextjs'

/**
 * Schedules a Sentry flush so events queued by captureException/captureMessage
 * actually reach Sentry's servers before Vercel freezes the invocation.
 *
 * captureException/captureMessage only enqueue events on an internal transport;
 * the network send happens asynchronously and is not awaited by those calls.
 * On Vercel, the function is frozen as soon as the response is sent, which can
 * cut that send off mid-flight and silently drop the event (see #368).
 *
 * Uses Next.js's after() to keep the invocation alive past the response, without
 * delaying it, until the flush settles. Falls back to a best-effort background
 * flush when called outside a request scope (e.g. instrumentation.ts on server
 * startup), where after() throws synchronously.
 *
 * next/server's after() is imported dynamically, not statically: some of this
 * module's callers (e.g. src/lib/xero/contacts.ts) are transitively reachable
 * from client component bundles, and a static `after` import fails the Next.js
 * build there ("only available in Server Components"), even though this
 * function itself only ever runs server-side.
 */
export function scheduleSentryFlush(): void {
  const flush = () => {
    Sentry.flush(2000).catch(() => {
      // eslint-disable-next-line no-console -- deliberate: reporting a failure of the Sentry pathway itself must not depend on that same pathway
      console.warn('Sentry flush failed')
    })
  }

  if (typeof window !== 'undefined') {
    return
  }

  import('next/server').then(({ after }) => {
    try {
      after(flush)
    } catch {
      void flush()
    }
  }).catch(() => {
    void flush()
  })
}
