# Coding Standards

This document outlines coding standards and best practices for the membership system codebase.

## Table of Contents
- [Data Access Patterns](#data-access-patterns)
- [API Route Design](#api-route-design)
- [Component Organization](#component-organization)
- [Security Guidelines](#security-guidelines)
- [Error Handling](#error-handling)
- [TypeScript Usage](#typescript-usage)
- [File Naming Conventions](#file-naming-conventions)

---

## Data Access Patterns

### Use API Routes for Database Access

**Standard**: All database queries should go through API routes, not directly from client components.

**Why:**
- **Security**: Database credentials and business logic stay server-side
- **Authorization**: Centralized place for permission checks and audit logging
- **Flexibility**: Can use `service_role` when needed without exposing credentials
- **Maintainability**: Easier to refactor, add caching, or change database structure
- **Testing**: API endpoints can be tested independently

**Example:**

❌ **Don't** - Direct Supabase query from component:
```typescript
// In a client component
const { data } = await supabase
  .from('payment_plan_summary')
  .select('*')
  .eq('contact_id', user.id)
```

✅ **Do** - Use an API route:
```typescript
// In a client component
const response = await fetch('/api/user/payment-plans')
const { paymentPlans } = await response.json()

// In /api/user/payment-plans/route.ts
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminSupabase = createAdminClient()
  const { data } = await adminSupabase
    .from('payment_plan_summary')
    .select('*')
    .eq('contact_id', user.id)

  return NextResponse.json({ paymentPlans: data })
}
```

**Exceptions:**
- Very simple, well-protected operations with proper RLS policies may use direct queries
- Real-time subscriptions may require direct Supabase access
- Always document why direct access is used if making an exception

---

## API Route Design

### Authentication & Authorization

All user-facing API routes must:
1. Authenticate the user using `createClient().auth.getUser()`
2. Validate the user has permission for the requested operation
3. Return appropriate HTTP status codes (401 for unauthorized, 403 for forbidden)

```typescript
export async function GET() {
  const supabase = createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Continue with authorized operation...
}
```

### Use Admin Client for Service-Level Operations

When querying restricted views or tables, use `createAdminClient()`:

```typescript
const adminSupabase = createAdminClient()
const { data } = await adminSupabase
  .from('restricted_view')
  .select('*')
  .eq('user_id', authenticatedUserId)  // Filter by authenticated user
```

### Error Handling

- Always catch and log errors
- Return user-friendly error messages
- Use appropriate HTTP status codes
- Don't expose internal error details to clients

```typescript
try {
  // Operation
} catch (error) {
  console.error('Detailed error for logs:', error)
  return NextResponse.json(
    { error: 'Failed to process request' },
    { status: 500 }
  )
}
```

### Response Format

Use consistent response formats:

```typescript
// Success with data
return NextResponse.json({
  success: true,
  data: result
})

// Error
return NextResponse.json({
  success: false,
  error: 'User-friendly message'
}, { status: 400 })
```

---

## Component Organization

### Client vs Server Components

- Use `'use client'` directive only when needed (state, effects, browser APIs)
- Server components are preferred for data fetching when possible
- Dynamic imports for client-only components: `dynamic(() => import(...), { ssr: false })`

### Component File Structure

```typescript
'use client'  // Only if needed

// 1. Imports
import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

// 2. Types/Interfaces
interface ComponentProps {
  // ...
}

// 3. Component
export default function ComponentName({ props }: ComponentProps) {
  // 3a. State
  const [state, setState] = useState()

  // 3b. Hooks
  const { showSuccess } = useToast()

  // 3c. Effects
  useEffect(() => {
    // ...
  }, [])

  // 3d. Event handlers
  const handleAction = async () => {
    // ...
  }

  // 3e. Render logic
  if (loading) return <LoadingState />

  // 3f. Main render
  return (
    // ...
  )
}
```

---

## Security Guidelines

### Never Expose Secrets

- Never commit API keys, tokens, or credentials
- Use environment variables for all secrets
- Add sensitive files to `.gitignore`

### Input Validation

- Validate all user input on the server side
- Sanitize data before database operations
- Use TypeScript types for compile-time validation

### Database Security

- Use Row Level Security (RLS) policies in Supabase
- Restrict views to `service_role` when they contain sensitive data
- Never expose `service_role` credentials to client
- Audit database access in API routes

### Payment Security

- Never log full card numbers or CVV codes
- Use Stripe's secure payment methods
- Validate payment amounts server-side
- Log payment operations for audit trail

---

## Error Handling

### Consistent Logging

Use the centralized logger service:

```typescript
import { logger } from '@/lib/logging/logger'

logger.logBatchProcessing(
  'operation-id',
  'Human readable message',
  { contextData: 'value' },
  'info' | 'warn' | 'error'
)
```

### User-Facing Errors

Use toast notifications for user feedback:

```typescript
const { showSuccess, showError } = useToast()

// Success
showSuccess('Operation Complete', 'Your changes have been saved')

// Error
showError('Operation Failed', 'Please try again or contact support')
```

### Don't Swallow Errors

Always log errors, even if handling them gracefully:

```typescript
try {
  await operation()
} catch (error) {
  console.error('Operation failed:', error)  // Always log
  showError('Failed', 'Please try again')     // Then show to user
}
```

---

## TypeScript Usage

### Strict Types

- Avoid `any` type unless absolutely necessary
- Define interfaces for all data structures
- Use type guards for runtime validation

```typescript
// Define clear interfaces
interface PaymentPlan {
  invoice_id: string
  contact_id: string
  total_amount: number
  // ...
}

// Use them consistently
const [plans, setPlans] = useState<PaymentPlan[]>([])
```

### Type Safety with API Responses

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const response = await fetch('/api/endpoint')
const result: ApiResponse<PaymentPlan[]> = await response.json()
```

---

## File Naming Conventions

### Components

- PascalCase: `UserPaymentPlansSection.tsx`
- Co-located with related files when appropriate

### API Routes

- Use Next.js convention: `route.ts` in appropriate folder
- Folder names: kebab-case (`payment-plans`, `user-registrations`)

### Utilities & Services

- camelCase: `formatUtils.ts`, `paymentPlanService.ts`
- Group related utilities in folders (`lib/email/`, `lib/xero/`)

### Constants

- UPPER_SNAKE_CASE for exported constants
- Group in config files: `payment-plan-config.ts`

```typescript
export const MAX_PAYMENT_ATTEMPTS = 3
export const RETRY_INTERVAL_HOURS = 24
```

---

## Additional Best Practices

### Don't Over-Engineer

- Implement what's needed now, not what might be needed later
- Avoid premature abstractions
- Keep solutions simple and focused

### Comments

- Write self-documenting code with clear names
- Add comments for complex business logic or non-obvious decisions
- Document "why" not "what" - code shows what it does

### Testing

- Write tests for critical business logic
- Test API routes independently
- Use meaningful test descriptions

### Performance

- Use dynamic imports for large client components
- Implement loading states for better UX
- Avoid unnecessary re-renders with proper memoization

---

## Migration Path

For existing code that doesn't follow these standards:

1. **New features**: Always follow these standards
2. **Bug fixes**: Update code to standards when touching it
3. **Refactoring**: Gradually migrate during normal maintenance
4. **No rush**: Don't refactor working code just to match standards

The goal is continuous improvement, not a disruptive rewrite.
