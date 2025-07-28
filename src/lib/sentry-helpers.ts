import * as Sentry from '@sentry/nextjs'
import { createClient } from './supabase/server'
import { extractRequestInfo, getSimpleRequestInfo } from './request-info'

/**
 * Enhanced Sentry error capture with automatic user context
 */
export async function captureSentryError(
  error: Error | string,
  context?: {
    user?: any
    request?: any
    tags?: Record<string, string>
    extra?: Record<string, any>
  }
) {
  const scope = new Sentry.Scope()
  
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
      console.warn('Failed to get user context for Sentry:', userError)
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
}

/**
 * Enhanced Sentry message capture with automatic user context
 */
export async function captureSentryMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: {
    user?: any
    request?: any
    tags?: Record<string, string>
    extra?: Record<string, any>
  }
) {
  const scope = new Sentry.Scope()
  
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
      console.warn('Failed to get user context for Sentry:', userError)
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
}

/**
 * Set up Sentry user context for API routes
 */
export async function setupSentryUserContext(request?: any) {
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
    console.warn('Failed to setup Sentry user context:', error)
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
  error?: any
  details?: any
}

export async function captureCriticalPaymentError(
  error: Error | any,
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
  error: Error | any,
  context: PaymentContext,
  severity: 'error' | 'warning' | 'info' = 'error'
) {
  await captureSentryError(error instanceof Error ? error : new Error(String(error)), {
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
export async function captureCriticalAccountDeletionError(error: Error, context?: any) {
  await captureSentryError(error, {
    ...context,
    tags: {
      ...context?.tags,
      critical: 'account_deletion',
      payment_related: 'true'
    }
  })
}

export async function captureAccountDeletionWarning(message: string, context?: any) {
  await captureSentryMessage(message, 'warning', {
    ...context,
    tags: {
      ...context?.tags,
      critical: 'account_deletion',
      payment_related: 'true'
    }
  })
}