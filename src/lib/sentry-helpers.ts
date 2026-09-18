import * as Sentry from '@sentry/nextjs'
import { NextRequest, after } from 'next/server'
import { createClient } from './supabase/server'
import { extractRequestInfo } from './request-info'
import { logger } from './logging/logger'

interface SentryUserInfo {
  id: string
  email?: string
  first_name?: string
  last_name?: string
  member_id?: string
  is_admin?: boolean
}

interface SentryRequestInfo {
  url?: string
  method?: string
  ip?: string
  headers?: Record<string, string | undefined>
}

interface SentryContextBase {
  user?: SentryUserInfo
  request?: SentryRequestInfo
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

interface SentryErrorContext extends SentryContextBase {
  level?: Sentry.SeverityLevel
}

/**
 * Enhanced Sentry error capture with automatic user context
 *
 * Callers across the app invoke this (and the payment/account-deletion helpers
 * built on it) without awaiting it - it's meant to fire from a catch block
 * without blocking the response. To stay reliable under that usage, the whole
 * body (including the async user-context lookup) runs inside next/server's
 * after(), which is registered synchronously the instant this function is
 * called, so Vercel won't freeze the invocation before it completes - whether
 * or not the caller awaits this promise (see #368).
 */
export async function captureSentryError(
  error: Error | string,
  context?: SentryErrorContext
): Promise<void> {
  const doCapture = async () => {
    const scope = new Sentry.Scope()

    if (context?.level) {
      scope.setLevel(context.level)
    }

    // Add user context if available
    if (context?.user) {
      scope.setUser({
        id: context.user.id,
        email: context.user.email,
        username: `${context.user.first_name} ${context.user.last_name}`,
        member_id: context.user.member_id,
        is_admin: context.user.is_admin
      })
    } else {
      // Try to get user from current session
      try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          // Get additional user profile data
          const { data: userProfile } = await supabase
            .from('users')
            .select('first_name, last_name, member_id, is_admin')
            .eq('id', user.id)
            .single()

          scope.setUser({
            id: user.id,
            email: user.email,
            username: userProfile ? `${userProfile.first_name} ${userProfile.last_name}` : 'Unknown',
            member_id: userProfile?.member_id,
            is_admin: userProfile?.is_admin
          })
        }
      } catch (userError) {
        // Silently fail user context - don't let it break error reporting
        logger.logSystem(
          'sentry-user-context-failed',
          'Failed to get user context for Sentry',
          { error: userError instanceof Error ? userError.message : String(userError) },
          'warn'
        )
      }
    }

    // Add request context if available
    if (context?.request) {
      scope.setContext('request', {
        url: context.request.url,
        method: context.request.method,
        headers: context.request.headers,
        ip: context.request.ip || context.request.headers?.['x-forwarded-for'] || 'unknown',
        userAgent: context.request.headers?.['user-agent']
      })
    }

    // Add tags
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value)
      })
    }

    // Add extra context
    if (context?.extra) {
      scope.setExtras(context.extra)
    }

    // Capture the error
    if (typeof error === 'string') {
      Sentry.captureMessage(error, scope)
    } else {
      Sentry.captureException(error, scope)
    }

    // Make sure the event actually reaches Sentry before Vercel freezes this
    // invocation - captureException/captureMessage only enqueue it (see #368).
    await Sentry.flush(2000).catch(() => {
      // eslint-disable-next-line no-console -- deliberate: reporting a failure of the Sentry pathway itself must not depend on that same pathway
      console.warn('Sentry flush failed')
    })
  }

  try {
    after(doCapture)
  } catch {
    // Not in a request scope (e.g. called from outside a route/action) -
    // after() throws synchronously in that case, so fall back to running
    // inline, best-effort.
    await doCapture()
  }
}

/**
 * Enhanced Sentry message capture with automatic user context
 *
 * See captureSentryError() above for why the body runs inside after() -
 * same reasoning applies here.
 */
export async function captureSentryMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: SentryContextBase
): Promise<void> {
  const doCapture = async () => {
    const scope = new Sentry.Scope()
    scope.setLevel(level)

    // Add user context if available
    if (context?.user) {
      scope.setUser({
        id: context.user.id,
        email: context.user.email,
        username: `${context.user.first_name} ${context.user.last_name}`,
        member_id: context.user.member_id,
        is_admin: context.user.is_admin
      })
    } else {
      // Try to get user from current session
      try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
          // Get additional user profile data
          const { data: userProfile } = await supabase
            .from('users')
            .select('first_name, last_name, member_id, is_admin')
            .eq('id', user.id)
            .single()

          scope.setUser({
            id: user.id,
            email: user.email,
            username: userProfile ? `${userProfile.first_name} ${userProfile.last_name}` : 'Unknown',
            member_id: userProfile?.member_id,
            is_admin: userProfile?.is_admin
          })
        }
      } catch (userError) {
        // Silently fail user context - don't let it break error reporting
        logger.logSystem(
          'sentry-user-context-failed',
          'Failed to get user context for Sentry',
          { error: userError instanceof Error ? userError.message : String(userError) },
          'warn'
        )
      }
    }

    // Add request context if available
    if (context?.request) {
      scope.setContext('request', {
        url: context.request.url,
        method: context.request.method,
        headers: context.request.headers,
        ip: context.request.ip || context.request.headers?.['x-forwarded-for'] || 'unknown',
        userAgent: context.request.headers?.['user-agent']
      })
    }

    // Add tags
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value)
      })
    }

    // Add extra context
    if (context?.extra) {
      scope.setExtras(context.extra)
    }

    Sentry.captureMessage(message, scope)

    // Make sure the event actually reaches Sentry before Vercel freezes this
    // invocation - captureMessage only enqueues it (see #368).
    await Sentry.flush(2000).catch(() => {
      // eslint-disable-next-line no-console -- deliberate: reporting a failure of the Sentry pathway itself must not depend on that same pathway
      console.warn('Sentry flush failed')
    })
  }

  try {
    after(doCapture)
  } catch {
    await doCapture()
  }
}

/**
 * Set up Sentry user context for API routes
 */
export async function setupSentryUserContext(request?: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // Get additional user profile data
      const { data: userProfile } = await supabase
        .from('users')
        .select('first_name, last_name, member_id, is_admin')
        .eq('id', user.id)
        .single()
      
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: userProfile ? `${userProfile.first_name} ${userProfile.last_name}` : 'Unknown',
        member_id: userProfile?.member_id,
        is_admin: userProfile?.is_admin
      })

      // Add request context if available
      if (request) {
        const requestInfo = extractRequestInfo(request)
        Sentry.setContext('request', {
          url: requestInfo.url,
          method: requestInfo.method,
          ip: requestInfo.ip,
          userAgent: requestInfo.userAgent,
          browser: `${requestInfo.browser.name} ${requestInfo.browser.version}`,
          os: `${requestInfo.os.name} ${requestInfo.os.version}`,
          device: requestInfo.device.type,
          referer: requestInfo.referer,
          language: requestInfo.language,
          headers: requestInfo.headers
        })
      }
    }
  } catch (error) {
    // Silently fail - don't let it break the application
    logger.logSystem(
      'sentry-setup-user-context-failed',
      'Failed to setup Sentry user context',
      { error: error instanceof Error ? error.message : String(error) },
      'warn'
    )
  }
}

/**
 * Legacy functions for backward compatibility
 */

// Payment-related functions
export interface PaymentContext {
  paymentIntentId?: string
  userId?: string
  userEmail?: string
  membershipId?: string
  registrationId?: string
  categoryId?: string
  amountCents?: number
  discountCode?: string
  endpoint?: string
  operation?: string
}

export interface DatabaseOperation {
  operation: string
  success: boolean
  error?: unknown
  details?: unknown
}

export async function captureCriticalPaymentError(
  error: unknown,
  context: PaymentContext,
  databaseOperations: DatabaseOperation[] = []
) {
  await captureSentryError(error instanceof Error ? error : new Error(String(error)), {
    tags: {
      critical: 'payment_inconsistency',
      payment_status: 'succeeded',
      operation: context.operation || 'unknown',
      endpoint: context.endpoint || 'unknown'
    },
    extra: {
      paymentIntentId: context.paymentIntentId,
      userId: context.userId,
      membershipId: context.membershipId,
      amountCents: context.amountCents,
      databaseOperations,
      errorDetails: error
    }
  })
}

export async function capturePaymentError(
  error: unknown,
  context: PaymentContext,
  severity: 'error' | 'warning' | 'info' = 'error'
) {
  await captureSentryError(error instanceof Error ? error : new Error(String(error)), {
    level: severity,
    tags: {
      operation: context.operation || 'unknown',
      endpoint: context.endpoint || 'unknown',
      payment_related: 'true'
    },
    extra: {
      paymentIntentId: context.paymentIntentId,
      userId: context.userId,
      membershipId: context.membershipId,
      amountCents: context.amountCents,
      errorDetails: error
    }
  })
}

export async function setPaymentContext(context: PaymentContext) {
  const { captureSentryMessage } = await import('./sentry-helpers')
  await captureSentryMessage(`Setting payment context: ${context.operation}`, 'info', {
    tags: {
      operation: context.operation || 'unknown',
      endpoint: context.endpoint || 'unknown'
    },
    extra: {
      paymentIntentId: context.paymentIntentId,
      membershipId: context.membershipId,
      amountCents: context.amountCents
    }
  })
}

export async function capturePaymentSuccess(
  operationName: string,
  context: PaymentContext,
  durationMs?: number
) {
  await captureSentryMessage(`Payment operation succeeded: ${operationName}`, 'info', {
    tags: {
      operation: context.operation || 'unknown',
      endpoint: context.endpoint || 'unknown',
      payment_related: 'true'
    },
    extra: {
      paymentIntentId: context.paymentIntentId,
      userId: context.userId,
      membershipId: context.membershipId,
      amountCents: context.amountCents,
      durationMs
    }
  })
}

// Account deletion functions
export async function captureCriticalAccountDeletionError(error: Error, context?: SentryErrorContext) {
  await captureSentryError(error, {
    ...context,
    tags: {
      ...context?.tags,
      critical: 'account_deletion',
      payment_related: 'true'
    }
  })
}

export async function captureAccountDeletionWarning(message: string, context?: SentryContextBase) {
  await captureSentryMessage(message, 'warning', {
    ...context,
    tags: {
      ...context?.tags,
      critical: 'account_deletion',
      payment_related: 'true'
    }
  })
}