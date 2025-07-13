# Development Guidelines

This document outlines development standards and best practices for the Hockey Association Membership System.

## 📋 Table of Contents

- [Logging Standards](#logging-standards)
- [Database Access Patterns](#database-access-patterns)
- [Code Organization](#code-organization)
- [Error Handling](#error-handling)
- [Security Guidelines](#security-guidelines)
- [Git Practices](#git-practices)
- [Testing Standards](#testing-standards)
- [Performance Considerations](#performance-considerations)

## 🪵 Logging Standards

### ✅ Preferred: Structured Logging
**Always use the centralized logger over console.log**

```typescript
// ✅ GOOD: Structured logging with categorization
import { logger } from '@/lib/logging/logger'

logger.logPaymentProcessing(
  'payment-completed',
  'Payment successfully processed',
  { paymentId, amount, userId }
)

// ❌ AVOID: Raw console logging
console.log('Payment completed:', paymentId)
```

### Logger Categories
Use appropriate categories for different types of operations:

- `payment-processing`: Payment flows, Stripe operations, financial transactions
- `xero-sync`: Xero API operations, accounting synchronization
- `batch-processing`: Background jobs, scheduled tasks, bulk operations
- `service-management`: Service startup/shutdown, background services
- `admin-action`: Admin interface operations, user management
- `system`: Server lifecycle, errors, infrastructure events

### Log Levels
- `debug`: Development debugging information
- `info`: Normal operational messages (default)
- `warn`: Warning conditions that should be monitored
- `error`: Error conditions requiring attention

### Exception: Console.log Usage
Console.log is acceptable only in these specific cases:
- **Edge Runtime**: Serverless environments without file system access
- **Circular Logging Prevention**: Avoiding infinite loops in logger error handling
- **Development Debugging**: Temporary debugging (must be removed before commit)

## 🗄️ Database Access Patterns

### ✅ Preferred: API-First Architecture
**Route database operations through Next.js API endpoints**

```typescript
// ✅ GOOD: API route handling business logic
// /api/registrations/route.ts
export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  // Complex business logic, validation, authorization
  const result = await supabase.from('registrations').insert(data)
  return NextResponse.json(result)
}

// Client component
const response = await fetch('/api/registrations', {
  method: 'POST',
  body: JSON.stringify(registrationData)
})
```

### When to Use API Routes
- ✅ Complex business logic operations
- ✅ Multi-table transactions
- ✅ Admin operations requiring authorization
- ✅ Payment processing and financial operations
- ✅ Data validation and transformation
- ✅ Operations requiring server-side security

### When Direct Client Queries Are Acceptable
- Simple, read-only operations for public data
- Real-time subscriptions for UI updates
- Basic user profile updates with proper RLS policies

```typescript
// ✅ ACCEPTABLE: Simple read-only with RLS protection
const { data: profile } = await supabase
  .from('users')
  .select('first_name, last_name')
  .eq('id', user.id)
  .single()
```

## 🏗️ Code Organization

### File Structure
```
src/
├── app/                    # Next.js app router pages and API routes
├── components/            # Reusable UI components
├── lib/                   # Business logic and utilities
│   ├── services/         # Business services (payment, email, etc.)
│   ├── logging/          # Centralized logging system
│   └── supabase/         # Database client configuration
├── types/                # TypeScript type definitions
scripts/                   # Development and administrative scripts
├── tests/                # Feature testing scripts
├── debug/                # Debugging and troubleshooting scripts
└── admin/                # Administrative and maintenance scripts
docs/                      # Project documentation
└── logs/                  # Generated log files (gitignored)
```

### Import Organization
Order imports consistently:
```typescript
// 1. React/Next.js imports
import { useState, useEffect } from 'react'
import { NextRequest, NextResponse } from 'next/server'

// 2. Third-party libraries
import { XeroClient } from 'xero-node'

// 3. Internal utilities and types
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { Database } from '@/types/database'

// 4. Local components (for component files)
import { PaymentForm } from './PaymentForm'
```

### Naming Conventions
- **Files**: kebab-case (`payment-processor.ts`)
- **Components**: PascalCase (`PaymentForm.tsx`)
- **Functions**: camelCase (`processPayment`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`)
- **Types/Interfaces**: PascalCase (`PaymentData`, `UserProfile`)

## ⚠️ Error Handling

### Structured Error Responses
```typescript
// ✅ GOOD: Consistent API error responses
export async function POST(request: NextRequest) {
  try {
    // Business logic
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    logger.error(
      'payment-processing',
      'payment-creation-failed',
      'Failed to create payment intent',
      { 
        error: error instanceof Error ? error.message : String(error),
        userId,
        amount
      }
    )
    
    return NextResponse.json(
      { error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}
```

### Error Context
Always provide relevant context in error logs:
- User ID (when available)
- Operation details (amount, IDs, etc.)
- Request context (IP, user agent for security events)
- Stack traces for unexpected errors

### User-Facing Error Messages
- **Never expose internal errors** to users
- **Provide actionable guidance** when possible
- **Use consistent error format** across the application

## 🔐 Security Guidelines

### Authentication & Authorization
```typescript
// ✅ GOOD: Verify authentication and authorization
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Additional admin check if needed
  const { data: userRecord } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()
    
  if (!userRecord?.is_admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
}
```

### Data Validation
- **Validate all inputs** on both client and server
- **Use TypeScript types** for compile-time validation
- **Sanitize data** before database operations
- **Implement rate limiting** for sensitive operations

### Sensitive Data
- **Never log passwords, tokens, or payment details**
- **Use environment variables** for secrets
- **Implement proper RLS policies** in Supabase
- **Audit sensitive operations** with proper logging

## 📝 Git Practices

### Commit Messages
Use conventional commit format:
```
type(scope): brief description

Detailed explanation of changes made and why.

- Specific change 1
- Specific change 2

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Branch Naming
- `feature/description`: New features
- `fix/description`: Bug fixes
- `docs/description`: Documentation updates
- `refactor/description`: Code refactoring

### Pre-Commit Checklist
- [ ] Remove any console.log debugging statements
- [ ] Ensure proper error handling and logging
- [ ] Verify TypeScript compilation
- [ ] Test critical user flows
- [ ] Update documentation if needed

## 🧪 Testing Standards

### API Route Testing
```typescript
// Test critical business logic paths
describe('/api/payments', () => {
  it('should create payment intent with valid data', async () => {
    // Test implementation
  })
  
  it('should reject invalid payment amounts', async () => {
    // Test validation
  })
})
```

### Integration Testing Priorities
1. **Payment flows** (highest priority)
2. **User registration flows**
3. **Admin operations**
4. **Authentication flows**

## ⚡ Performance Considerations

### Database Queries
```typescript
// ✅ GOOD: Specific field selection
const { data } = await supabase
  .from('users')
  .select('id, first_name, last_name, email')
  .eq('id', userId)

// ❌ AVOID: SELECT * queries
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('id', userId)
```

### API Response Optimization
- **Return only necessary data** to clients
- **Implement pagination** for large datasets
- **Use appropriate HTTP status codes**
- **Cache static or semi-static data** when appropriate

### Client-Side Performance
- **Minimize re-renders** with proper dependency arrays
- **Use React.memo** for expensive components
- **Implement loading states** for better UX
- **Optimize images** and static assets

## 🔄 Code Review Guidelines

### Review Checklist
- [ ] **Security**: Proper authentication and input validation
- [ ] **Logging**: Appropriate use of structured logging
- [ ] **Error Handling**: Comprehensive error management
- [ ] **Performance**: Efficient database queries and API calls
- [ ] **Consistency**: Follows established patterns and conventions
- [ ] **Documentation**: Code is self-documenting or properly commented

### Review Priorities
1. **Security vulnerabilities** (blocking)
2. **Data integrity issues** (blocking)
3. **Performance regressions** (high priority)
4. **Code style violations** (low priority)

## 📚 Documentation Standards

### Code Documentation
```typescript
/**
 * Process a completed payment and update related records
 * 
 * @param paymentIntentId - Stripe payment intent ID
 * @param userId - User who made the payment
 * @returns Promise resolving to payment processing result
 */
async function processCompletedPayment(
  paymentIntentId: string, 
  userId: string
): Promise<PaymentResult> {
  // Implementation
}
```

### API Documentation
Document API endpoints with:
- **Purpose and business logic**
- **Required authentication/authorization**
- **Request/response schemas**
- **Error conditions and responses**

### README Updates
- Keep deployment instructions current
- Document environment variable requirements
- Include troubleshooting guides for common issues
- Maintain dependency version requirements

---

## 🎯 Key Principles Summary

1. **Security First**: Always validate, authorize, and sanitize
2. **Observability**: Use structured logging for better monitoring
3. **API-First**: Route complex operations through API endpoints
4. **Type Safety**: Leverage TypeScript for compile-time validation
5. **User Experience**: Provide clear feedback and error messages
6. **Performance**: Optimize database queries and API responses
7. **Maintainability**: Write self-documenting, consistent code

---

*Last updated: July 13, 2025*  
*This document should be updated as new patterns and practices are established.*