/**
 * Email Module Exports
 * 
 * Centralized exports for all email-related functionality
 */

// Export the email processor (business logic)
export { emailProcessor } from './processor'

// Export the email service (Loops integration)
export { emailService } from './service'

// Export the email staging manager (database operations)
export { emailStagingManager } from './staging'

// Export the email processing manager (batch sending)
export { emailProcessingManager } from './batch-sync-email'

// Export types
export type { PaymentCompletionEvent } from './processor' 