import * as Sentry from "@sentry/nextjs";

export interface PaymentContext {
  paymentIntentId?: string;
  userId?: string;
  userEmail?: string;
  membershipId?: string;
  amountCents?: number;
  endpoint?: string;
  operation?: string;
}

export interface DatabaseOperation {
  operation: string;
  success: boolean;
  error?: any;
  details?: any;
}

/**
 * Capture a critical payment error where payment succeeded but database operation failed
 */
export function captureCriticalPaymentError(
  error: Error | any,
  context: PaymentContext,
  databaseOperations: DatabaseOperation[] = []
) {
  return Sentry.captureException(error, {
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
    },
    user: context.userId ? {
      id: context.userId,
      email: context.userEmail
    } : undefined,
    level: 'fatal'
  });
}

/**
 * Capture a payment operation error (non-critical but important)
 */
export function capturePaymentError(
  error: Error | any,
  context: PaymentContext,
  severity: 'error' | 'warning' | 'info' = 'error'
) {
  return Sentry.captureException(error, {
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
    },
    user: context.userId ? {
      id: context.userId,
      email: context.userEmail
    } : undefined,
    level: severity
  });
}

/**
 * Add payment context to the current Sentry scope
 */
export function setPaymentContext(context: PaymentContext) {
  Sentry.setTags({
    operation: context.operation || 'unknown',
    endpoint: context.endpoint || 'unknown'
  });
  
  Sentry.setContext('payment', {
    paymentIntentId: context.paymentIntentId,
    membershipId: context.membershipId,
    amountCents: context.amountCents
  });
  
  if (context.userId) {
    Sentry.setUser({
      id: context.userId,
      email: context.userEmail
    });
  }
}

/**
 * Create a Sentry transaction for payment operations
 */
export function createPaymentTransaction(name: string, operation: string) {
  return Sentry.startTransaction({
    name,
    op: operation,
    tags: {
      payment_related: 'true'
    }
  });
}

/**
 * Capture successful payment operation for performance monitoring
 */
export function capturePaymentSuccess(
  operationName: string,
  context: PaymentContext,
  durationMs?: number
) {
  Sentry.addBreadcrumb({
    message: `Payment operation succeeded: ${operationName}`,
    category: 'payment',
    level: 'info',
    data: {
      paymentIntentId: context.paymentIntentId,
      userId: context.userId,
      membershipId: context.membershipId,
      amountCents: context.amountCents,
      durationMs
    }
  });
}

export interface AccountDeletionContext {
  userId: string;
  userEmail: string;
  userName?: string;
  step?: 'email_send' | 'database_update' | 'auth_delete' | 'auth_signout';
  emailSent?: boolean;
  originalEmail?: string;
}

/**
 * Capture critical account deletion failure
 */
export function captureCriticalAccountDeletionError(
  error: Error | any,
  context: AccountDeletionContext
) {
  return Sentry.captureException(error, {
    tags: {
      critical: 'account_deletion_failure',
      operation: 'delete_account',
      endpoint: '/api/delete-account',
      step: context.step || 'unknown'
    },
    extra: {
      userId: context.userId,
      userEmail: context.userEmail,
      userName: context.userName,
      emailSent: context.emailSent,
      originalEmail: context.originalEmail,
      failureStep: context.step,
      errorDetails: error,
      timestamp: new Date().toISOString()
    },
    user: {
      id: context.userId,
      email: context.userEmail,
      username: context.userName
    },
    level: 'fatal',
    fingerprint: ['account-deletion-failure', context.userId]
  });
}

/**
 * Capture account deletion operation warning (non-critical issues)
 */
export function captureAccountDeletionWarning(
  message: string,
  context: AccountDeletionContext,
  details?: any
) {
  return Sentry.captureMessage(message, {
    tags: {
      operation: 'delete_account',
      endpoint: '/api/delete-account',
      step: context.step || 'unknown'
    },
    extra: {
      userId: context.userId,
      userEmail: context.userEmail,
      details,
      timestamp: new Date().toISOString()
    },
    user: {
      id: context.userId,
      email: context.userEmail
    },
    level: 'warning'
  });
}