import { after } from 'next/server'
import { logger } from '@/lib/logging/logger'

/**
 * Schedules async work to run after the HTTP response is sent, keeping the
 * Vercel invocation alive until it settles.
 *
 * Same pattern as `scheduleSentryFlush` / `captureSentryError` (#368): once
 * a route returns, Vercel freezes the function, so any fire-and-forget
 * promise started before the return is dropped mid-flight. Wrapping the work
 * in `after()` registers it with the runtime before the response goes out.
 *
 * Errors inside `work` are caught and logged (error level → Sentry via the
 * logger) so they never become unhandled rejections. Callers that already
 * attach a per-promise `.catch()` for softer/warn-level reporting can keep
 * those; this outer catch is the safety net.
 *
 * Falls back to running the work inline when called outside a request scope
 * (e.g. unit tests, scripts), where `after()` throws synchronously.
 *
 * Requires Next.js ≥ 15.1 (`after` is stable; this repo is on 16.x).
 */
export function runAfterResponse(
  operation: string,
  work: () => Promise<unknown>,
  context?: Record<string, unknown>
): void {
  const run = async () => {
    try {
      await work()
    } catch (err) {
      logger.logSystem(
        operation,
        `Deferred post-response work failed (non-fatal): ${operation}`,
        {
          ...context,
          error: err instanceof Error ? err.message : String(err),
        },
        'error',
        err
      )
    }
  }

  try {
    after(run)
  } catch {
    void run()
  }
}
