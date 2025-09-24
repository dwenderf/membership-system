# Hockey Association Membership System

A comprehensive membership and registration system for adult hockey associations, built with Next.js, Supabase, and Stripe.

## Features

- **User Management**: Passwordless authentication with magic links and Google OAuth
- **Membership System**: Flexible duration-based memberships with monthly/annual pricing
- **Registration System**: Team and event registration with capacity management
- **Advanced Discount System**: Category-based discount codes with organizational grouping
  - **Scholarship Fund**: PRIDE codes (100%, 75%, 50%, 25% discounts)
  - **Board Member, Captain, Volunteer**: Role-specific discount categories
  - **Usage Limits**: Per-category limits per user per season (e.g., $500 scholarship cap)
  - **Accounting Integration**: Category-specific accounting codes for financial reporting
- **Payment Processing**: Secure payments via Stripe with payment intent handling
- **Email Integration**: Transactional emails via Loops.so for confirmations and notifications
- **Admin Dashboard**: Season management, membership oversight, and user administration
- **Xero Integration**: Automatic invoice creation and payment recording for seamless accounting
- **Financial Reporting**: Comprehensive financial tracking with categorized line items for accurate reporting

## Financial Reporting Architecture

The system uses a sophisticated line item categorization system to track financial data for accurate reporting. All financial transactions are stored in the `xero_invoice_line_items` table with specific `line_item_type` values that determine how they appear in financial reports.

### Key Database View: `reports_financial_data`

The `reports_financial_data` view is the primary source for financial reporting. It joins `xero_invoice_line_items` with related tables and includes only **AUTHORISED** invoices (not DRAFT) with **completed** payments.

### Line Item Types and Categorization

The `xero_invoice_line_items.line_item_type` field categorizes financial data into four main types:

#### 1. **Memberships** (`line_item_type = 'membership'`)

- **Purpose**: Track membership fee payments
- **Amount**: Positive (charged to customer)
- **Reports Section**: Memberships breakdown
- **Example**: Annual membership fee, monthly membership fee

#### 2. **Registrations** (`line_item_type = 'registration'`)

- **Purpose**: Track registration fee payments
- **Amount**: Positive (charged to customer)
- **Reports Section**: Registrations breakdown
- **Example**: Team registration fee, event registration fee

#### 3. **Discounts** (`line_item_type = 'discount'`)

- **Purpose**: Track actual discount codes applied
- **Amount**: Negative (credit to customer)
- **Reports Section**: Discount Usage (grouped by category)
- **Requirements**: Must have `discount_code_id` populated
- **Example**: PRIDE50 scholarship code, board member discount

#### 4. **Donations** (`line_item_type = 'donation'`)

- **Purpose**: Track financial assistance and additional donations
- **Amount**:
  - **Positive**: Donation received (additional donation)
  - **Negative**: Donation given (financial assistance)
- **Reports Section**: Donations (received vs given)
- **Example**: Financial assistance for memberships, additional donations

### Financial Reports Structure

Based on these line item types, the financial reports are organized as:

- **Memberships**: All `membership` line items, grouped by membership type
- **Discount Usage**: All `discount` line items with `discount_code_id`, grouped by discount category
- **Donations**: All `donation` line items, separated into received (positive) and given (negative)
- **Registrations**: All `registration` line items, grouped by registration type

### Important Notes

- **Discount codes** (like PRIDE50) are tracked as `discount` line items with proper `discount_code_id`
- **Financial assistance** for memberships is tracked as `donation` line items (negative amount)
- **Only AUTHORISED invoices** are included in reports (DRAFT invoices are excluded)
- **Customer names** are resolved from the `users` table via the view

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account and project
- Stripe account (test mode for development)
- Loops.so account for email integration
- Sentry account for error monitoring and alerting
- Xero account for accounting integration

### 1. Clone and Install

```bash
git clone <repository-url>
cd membership-system
npm install
```

### 2. Environment Setup

Create a `.env.local` file with the following variables:

```bash
# Application Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret

# Database
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Authentication
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret

# Payments
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_API_VERSION=2025-07-30.basil

# Email Integration
LOOPS_API_KEY=your_loops_api_key
LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID=your_template_id
LOOPS_WELCOME_TEMPLATE_ID=your_welcome_template_id
LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID=your_expiring_template_id
LOOPS_PAYMENT_FAILED_TEMPLATE_ID=your_payment_failed_template_id
LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID=your_registration_template_id
LOOPS_WAITLIST_ADDED_TEMPLATE_ID=your_waitlist_template_id
LOOPS_ALTERNATE_SELECTION_TEMPLATE_ID=your_alternate_selection_template_id
LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID=your_payment_method_removed_template_id

# Error Monitoring
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=membership-system

# Xero Integration Configuration
# Recommendation: Create separate Xero apps for development/preview/production environments
XERO_CLIENT_ID=your_xero_client_id_here
XERO_CLIENT_SECRET=your_xero_client_secret_here
XERO_REDIRECT_URI=http://localhost:3000/api/xero/callback
XERO_SCOPES=accounting.transactions accounting.contacts accounting.settings offline_access
```

### 3. Database Setup

1. Create a new Supabase project
2. Get your API keys from Supabase Dashboard:
   - Go to **Settings** → **API**
   - Click on the **"API Keys"** tab (not "Legacy API Keys")
   - If you don't have API keys yet, click **"Create a new API key"**
   - Copy the **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
   - Go to **Settings** → **Data API** to get the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`

   **Note:** Use the **new API keys** (not the legacy ones). The new keys use an improved JWT format and are the recommended approach.

3. Run the database schema:

   ```bash
   # Apply the schema.sql file in your Supabase SQL editor
   ```

4. Set up Row Level Security (RLS) policies as defined in `supabase/schema.sql`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## Email Integration Setup (Loops.so)

The system uses Loops.so for transactional email delivery. Follow these steps to configure email templates:

### 1. Create Loops.so Account

1. Sign up at [https://loops.so](https://loops.so)
2. Get your API key from the settings
3. Add `LOOPS_API_KEY` to your environment variables

### 2. Set Up Transactional Email Templates

#### Membership Purchase Confirmation Template

1. **In Loops Dashboard:**
   - Go to "Transactional" section
   - Click "Create transactional email"
   - Name: "Membership Purchase Confirmation"

2. **Add Data Variables:**
   Use the "Insert data variable" button to add these variables:
   - `userName` - Customer's full name
   - `membershipName` - Type of membership purchased
   - `amount` - Price (formatted as "45.00")
   - `durationMonths` - Duration in months
   - `validFrom` - Membership start date
   - `validUntil` - Membership end date
   - `purchaseDate` - Purchase date
   - `paymentIntentId` - Stripe transaction ID
   - `dashboardUrl` - Link to user dashboard

3. **Email Template Example:**

   ```text
   Hi [userName],

   Great news! Your membership purchase has been confirmed and your access is now active.

   MEMBERSHIP DETAILS:
   - Membership Type: [membershipName]
   - Duration: [durationMonths] months
   - Amount Paid: $[amount]
   - Valid From: [validFrom]
   - Valid Until: [validUntil]
   - Purchase Date: [purchaseDate]

   WHAT'S NEXT:
   • Browse available teams and events you can now join
   • Manage your account: [dashboardUrl]
   • Watch for updates about league schedules

   Transaction ID: [paymentIntentId]

   Questions? Reply to this email or contact support.

   Thank you for being part of our hockey community!
   The Hockey Association Team
   ```

4. **Get Template ID:**
   - Copy the template ID from Loops
   - Add it to your `.env.local` as `LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID`

### 3. Additional Required Email Templates

The system includes several other email types that need templates configured:

#### Welcome Email Template (`LOOPS_WELCOME_TEMPLATE_ID`)

**Data Variables:**

- `userName` - New user's full name
- `dashboardUrl` - Link to user dashboard
- `membershipUrl` - Link to membership purchase page

**Template Example:**

```text
Hi [userName],

Welcome to the Hockey Association! 🏒

Your account has been successfully created. Here's what you can do next:

• Explore membership options: [membershipUrl]
• Access your dashboard: [dashboardUrl]
• Browse upcoming seasons and events

We're excited to have you as part of our hockey community!

Questions? Reply to this email anytime.

The Hockey Association Team
```

#### Membership Expiration Warning (`LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Member's full name
- `membershipName` - Type of membership expiring
- `expirationDate` - When membership expires
- `daysUntilExpiration` - Number of days remaining
- `renewUrl` - Link to renewal page

**Template Example:**

```text
Hi [userName],

Your [membershipName] will expire in [daysUntilExpiration] days on [expirationDate].

To avoid any interruption to your membership benefits, please renew before the expiration date.

Renew now: [renewUrl]

Questions about renewal? Reply to this email.

The Hockey Association Team
```

#### Payment Failed Notification (`LOOPS_PAYMENT_FAILED_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Customer's full name
- `membershipName` - Type of membership attempted
- `amount` - Payment amount that failed
- `failureReason` - Reason for payment failure
- `retryUrl` - Link to retry payment

**Template Example:**

```text
Hi [userName],

We were unable to process your payment for [membershipName] in the amount of $[amount].

Reason: [failureReason]

Please try again: [retryUrl]

If you continue to have issues, please contact our support team.

The Hockey Association Team
```

#### Registration Confirmation Template (`LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Customer's full name
- `registrationName` - Name of event/team registered for
- `categoryName` - Registration category (Player, Goalie, etc.)
- `seasonName` - Season name and dates
- `amount` - Registration fee paid (formatted as "75.00")
- `registrationDate` - Date of registration
- `paymentIntentId` - Stripe transaction ID
- `dashboardUrl` - Link to user dashboard

**Template Example:**

```text
Hi [userName],

Congratulations! Your registration has been confirmed and payment processed successfully.

REGISTRATION DETAILS:
- Event/Team: [registrationName]
- Category: [categoryName]
- Season: [seasonName]
- Amount Paid: $[amount]
- Registration Date: [registrationDate]

WHAT'S NEXT:
• Watch for team communications and schedule updates
• Manage your registrations: [dashboardUrl]
• Contact team organizers if you have questions

Transaction ID: [paymentIntentId]

Questions about your registration? Reply to this email.

Welcome to the team!
The Hockey Association Team
```

#### Waitlist Added Notification Template (`LOOPS_WAITLIST_ADDED_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Customer's full name
- `registrationName` - Name of event/team they were waitlisted for
- `categoryName` - Registration category (Player, Goalie, etc.)
- `seasonName` - Season name and dates
- `position` - Position on the waitlist
- `waitlistDate` - Date added to waitlist
- `dashboardUrl` - Link to user dashboard

**Template Example:**

```text
Hi [userName],

You've been added to the waitlist for [registrationName].

WAITLIST DETAILS:
- Event/Team: [registrationName]
- Category: [categoryName]
- Season: [seasonName]
- Your Position: #[position] on the waitlist
- Added to Waitlist: [waitlistDate]

WHAT'S NEXT:
• You'll be notified if a spot becomes available
• Check your status anytime: [dashboardUrl]
• We'll contact you with further instructions if selected

Thank you for your interest in joining the team!
The Hockey Association Team
```

#### Alternate Selection Confirmation Template (`LOOPS_ALTERNATE_SELECTION_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Customer's full name
- `registrationName` - Name of registration (e.g., "Rec League - Fall/Winter 2025-26")
- `seasonName` - Season name
- `gameDescription` - Description of the specific game (e.g., "Game 1")
- `gameDate` - Formatted game date (e.g., "Monday, September 11, 2025")
- `gameTime` - Formatted game time (e.g., "7:00 PM")
- `amount` - Amount charged as formatted number (e.g., 22.50)
- `purchaseDate` - Formatted purchase date (e.g., "September 11, 2025")
- `dashboardUrl` - Link to user dashboard

**Template Example:**

```text
Hi [userName],

You've been confirmed as an alternate for [gameDescription]!

GAME DETAILS:
- Registration: [registrationName] ([seasonName])
- Game: [gameDescription]
- Date & Time: [gameDate] at [gameTime]
- Amount Paid: $[amount]
- Confirmation Date: [purchaseDate]

WHAT'S NEXT:
• You're now on the alternate list for this game
• You'll be contacted if a spot becomes available
• Check your status anytime: [dashboardUrl]

Thanks for being part of the team!
The Hockey Association Team
```

#### Payment Method Removed Notification Template (`LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID`)

**Data Variables:**

- `userName` - Customer's full name
- `paymentMethod` - Last 4 digits of removed payment method (e.g., "****1234")

**Template Example:**

```text
Hi [userName],

Your payment method [paymentMethod] has been successfully removed from your account.

WHAT THIS MEANS:
• You've been removed from all alternate registrations
• You'll need to add a new payment method to register as an alternate again
• Your existing team registrations are not affected

If you didn't request this change or have questions, please contact our support team immediately.

The Hockey Association Team
```

### 4. Template Management Guidelines

**🚨 IMPORTANT:** When adding new email functionality to the application:

1. **Add the email event type** to `EMAIL_EVENTS` in `src/lib/email/service.ts`
2. **Create the email function** (e.g., `sendRegistrationConfirmation()`)
3. **Add environment variable** for template ID (e.g., `LOOPS_REGISTRATION_TEMPLATE_ID`)
4. **Update this README.md** with template setup instructions and data variables
5. **Test the email** with sample data to ensure all variables work correctly

This ensures all email templates are properly documented and maintainable.

### 5. Custom SMTP Configuration (Optional)

By default, Supabase handles authentication emails (magic links, password resets) using their email service. For a more professional experience with custom branding and domain, you can configure custom SMTP using Google Workspace.

#### Setting Up Google Workspace SMTP

**Prerequisites:**

- Google Workspace account with admin access
- Custom domain (e.g., `nycpha.org`)
- Email address for sending auth emails (e.g., `noreply@nycpha.org`)

**Step 1: Create App Password**

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (required for app passwords)
3. Go to **App passwords** section
4. Generate an app password for "Mail"
5. **Copy the 16-character password** (without spaces: `abcd1234efgh5678`)

**Step 2: Configure Supabase SMTP**

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Scroll down to **SMTP Settings**
3. **Enable Custom SMTP** toggle
4. Configure these settings:

   ```text
   SMTP Host: smtp.gmail.com
   SMTP Port: 587
   SMTP User: noreply@nycpha.org
   SMTP Pass: abcd1234efgh5678 (app password - no spaces)
   Sender Email: noreply@nycpha.org
   Sender Name: NYC PHA
   ```

5. Click **Save**

**Step 3: Add Email Logo (Optional)**

1. Host your logo at `https://yourdomain.com/images/logo-email.png`
2. Go to **Authentication** → **Email Templates**
3. Customize templates with your logo:

   ```html
   <div style="margin-bottom: 30px;">
     <img src="https://yourdomain.com/images/logo-email.png" 
          alt="Your Organization Logo" 
          style="max-width: 240px; height: auto; display: block;">
   </div>
   
   <h2>Welcome to your account!</h2>
   <p>Please click <a href="{{ .ConfirmationURL }}">this link</a> to log in.</p>
   
   <br><br>
   
   <div>
     <img src="https://yourdomain.com/images/logo-email.png" 
          alt="Your Organization Logo" 
          style="max-width: 240px; height: auto; display: block;">
   </div>
   ```

**Step 4: Test Configuration**

1. Try logging in with a magic link
2. Check that emails are sent from your custom domain
3. Verify logo appears correctly in email templates
4. Test with different email clients (Gmail, Outlook, etc.)

**Benefits of Custom SMTP:**

- ✅ **Professional branding** - Emails sent from your domain
- ✅ **Custom logo** - Add your organization's visual identity
- ✅ **Better deliverability** - Google Workspace reputation
- ✅ **Consistent experience** - Matches your organization's communications

**Troubleshooting SMTP:**

- **Authentication failed**: Ensure app password has no spaces
- **Port issues**: Use port 587 with STARTTLS (not 465 with SSL)
- **Logo not showing**: Check image URL is publicly accessible
- **Emails not sending**: Verify sender email exists in Google Workspace

### 6. Testing Email Integration

1. Complete the Loops setup above
2. If using custom SMTP, test the magic link authentication
3. Make a test membership purchase in your application
4. Check the `email_logs` table in Supabase to verify delivery status
5. Confirm the email was received with proper variable substitution
6. Test both authentication emails (via SMTP) and transactional emails (via Loops)

## Error Monitoring Setup (Sentry)

The application uses Sentry for error monitoring and alerting, particularly for critical payment issues where payments succeed but database operations fail.

### 1. Create Sentry Project

1. **Sign up** at [https://sentry.io](https://sentry.io)
2. **Create Organization** (if needed)
3. **Create one Next.js project:**
   - `membership-system` - Single project using environments

### 2. Configure Environment Variables

**Both Development & Production:**

```bash
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=membership-system
```

The system automatically uses `NODE_ENV` to separate development and production events into different environments within the same project.

### 3. Critical Error Scenarios Monitored

The system automatically captures and alerts on:

- **Payment succeeded but membership creation failed** - Critical business issue
- **Database connection failures during payment processing**
- **Email delivery failures after successful purchases**
- **Stripe API errors and timeout issues**

### 4. Alert Configuration

**Development Environment**: Minimal alerts for testing
**Production Environment**:

- Email/Slack notifications for critical errors
- Real-time monitoring of payment inconsistencies
- Performance tracking for payment operations

### 5. Testing Error Monitoring

1. **Test with payment failure cards** to verify error capture
2. **Check Sentry dashboard** for error events
3. **Verify alert notifications** are working properly

## Testing the Payment System

The application uses Stripe in test mode for development. Use these test card numbers to simulate different scenarios:

### Test Credit Card Numbers

#### **Successful Payments:**

- **Visa**: `4242 4242 4242 4242`
- **Visa (debit)**: `4000 0566 5566 5556`
- **Mastercard**: `5555 5555 5555 4444`
- **American Express**: `3782 822463 10005`

#### **Payment Failures:**

- **Generic decline**: `4000 0000 0000 0002`
- **Insufficient funds**: `4000 0000 0000 9995`
- **Lost card**: `4000 0000 0000 9987`
- **Stolen card**: `4000 0000 0000 9979`
- **Expired card**: `4000 0000 0000 0069`
- **Incorrect CVC**: `4000 0000 0000 0127`
- **Processing error**: `4000 0000 0000 0119`

#### **For All Test Cards:**

- **Expiry Date**: Use any future date (e.g., `12/34`)
- **CVC**: Use any 3-digit number (e.g., `123`)
- **ZIP Code**: Use any 5-digit number (e.g., `12345`)

### Testing Different Scenarios

1. **Successful Purchase**: Use `4242 4242 4242 4242` to test the complete flow and email delivery
2. **Payment Failure**: Use `4000 0000 0000 0002` to test error handling and user notifications
3. **Email Delivery**: Check your `email_logs` table in Supabase after each test
4. **Toast Notifications**: Verify success/error messages appear correctly

### Stripe Link Testing

The application supports Stripe Link for one-click payments:

- Use test card `4242 4242 4242 4242` with email `test@example.com`
- Complete the first purchase to set up Link
- Subsequent purchases will offer one-click Link payments

## Project Structure

```text
src/
├── app/                 # Next.js app directory
├── components/          # React components
├── lib/                # Utilities and services
│   ├── email/
│   │   ├── processor.ts # Email processing for payment completion
│   │   ├── service.ts # Email integration service
│   │   └── staging.ts # Email staging and batch processing
│   ├── supabase.ts     # Database client
│   └── stripe.ts       # Payment processing
├── middleware.ts       # Authentication middleware
└── types/              # TypeScript type definitions
```

## Testing

The application uses Jest with TypeScript support for comprehensive unit and integration testing.

### Test Framework Setup

**Configuration:**

- **Test Runner**: Jest with `ts-jest` preset
- **Environment**: Node.js environment for API testing
- **Module Mapping**: `@/` aliases resolve to `src/` directory
- **Coverage**: Comprehensive coverage reporting with HTML output

**Key Files:**

- `jest.config.js` - Jest configuration with TypeScript support
- `jest.setup.js` - Global test setup and mocks
- `src/__tests__/` - Test files organized by feature

### Setting Up Jest (First Time Setup)

If you're setting up Jest for the first time or encountering issues, follow these steps:

#### 1. Install Jest Dependencies

```bash
# Install Jest and TypeScript support
npm install --save-dev jest ts-jest @types/jest

# Install additional testing utilities (optional)
npm install --save-dev @testing-library/jest-dom
```

#### 2. Create Jest Configuration

Create `jest.config.js` in your project root:

```javascript
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{test,spec}.{js,jsx,ts,tsx}'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testTimeout: 10000,
  verbose: true,
}
```

#### 3. Create Jest Setup File

Create `jest.setup.js` in your project root:

```javascript
// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

// Mock Next.js modules that aren't available in test environment
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useSearchParams: jest.fn(() => ({
    get: jest.fn(),
  })),
}))
```

#### 4. Update Package.json Scripts

Add test scripts to your `package.json`:

```json
{
  "scripts": {
    "test": "npx jest",
    "test:watch": "npx jest --watch",
    "test:coverage": "npx jest --coverage"
  }
}
```

#### 5. Common Setup Issues & Solutions

**Issue: "moduleNameMapping" validation warning**

- **Solution**: Use `moduleNameMapper` (not `moduleNameMapping`) in jest.config.js

**Issue: Cannot find module '@/lib/...' errors**

- **Solution**: Ensure `moduleNameMapper` is correctly configured with `'^@/(.*)$': '<rootDir>/src/$1'`

**Issue: WSL/Windows path compatibility problems**

- **Solution**: Run tests in WSL terminal instead of Windows PowerShell
- Use `npx jest` in package.json scripts instead of direct `jest` command

**Issue: Permission errors during npm install**

- **Solution**: Use `npx jest` instead of global jest installation
- Ensure you're running in the correct directory with proper permissions

**Issue: TypeScript compilation errors in tests**

- **Solution**: Ensure `ts-jest` is installed and configured in jest.config.js
- Check that your tsconfig.json includes the test directories

**Issue: Cannot find module '@jest/globals' errors**

- **Solution**: Remove `@jest/globals` imports from test files
- Jest globals (`describe`, `it`, `expect`, `jest`, `beforeEach`) are available automatically
- Change `import { describe, it, expect, jest } from '@jest/globals'` to just import your actual modules

#### 6. Verify Setup

Test your Jest configuration:

```bash
# Run Jest to verify setup
npm test

# Should show: "No tests found" or run existing tests
# If you see configuration errors, review the steps above
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- user-alternate-registrations.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should require authentication"
```

### Test Structure

Tests are organized by feature and API endpoint:

```text
src/__tests__/
├── api/
│   ├── admin/
│   │   └── registrations/
│   │       └── alternates.test.ts     # Admin alternate management
│   └── user-alternate-registrations.test.ts  # User alternate registration
└── components/                        # Component tests (future)
```

### Current Test Coverage

**API Endpoints Tested:**

- **Admin Alternate Management** (`/api/admin/registrations/[id]/alternates`)
  - Authentication and authorization
  - Input validation and error handling
  - Enable/disable alternate configurations
  - Registration cleanup on disable
- **User Alternate Registration** (`/api/user-alternate-registrations`)
  - User authentication requirements
  - Duplicate registration prevention
  - Payment method validation
  - Registration retrieval

**Test Categories:**

- ✅ **Authentication**: Ensures proper user authentication
- ✅ **Authorization**: Verifies admin privilege requirements
- ✅ **Validation**: Tests input validation and error responses
- ✅ **Business Logic**: Validates core functionality
- ✅ **Error Handling**: Tests edge cases and failure scenarios

### Mock Configuration

The test suite includes comprehensive mocking for external dependencies:

**Supabase Mocking:**

```javascript
// Mocked database operations
const mockSupabase = {
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn()
  }))
}
```

**Service Mocking:**

- **SetupIntentService**: Payment method validation
- **Logger**: Application logging
- **Authentication**: User session management

### Writing New Tests

When adding new API endpoints or features:

1. **Create test file** in appropriate `__tests__` directory
2. **Follow naming convention**: `feature-name.test.ts`
3. **Include test categories**:

   ```javascript
   describe('/api/your-endpoint', () => {
     describe('POST - Create resource', () => {
       it('should require authentication', async () => {
         // Test authentication requirement
       })
       
       it('should validate required fields', async () => {
         // Test input validation
       })
       
       it('should successfully create resource', async () => {
         // Test successful operation
       })
     })
   })
   ```

4. **Mock external dependencies** using Jest mocks
5. **Test both success and failure scenarios**
6. **Verify proper error responses and status codes**

### Test Environment Variables

Tests use mocked environment variables configured in `jest.setup.js`:

```javascript
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
```

### Best Practices

- **Isolation**: Each test should be independent and not rely on other tests
- **Mocking**: Mock external services to ensure tests run reliably
- **Descriptive Names**: Use clear, descriptive test names that explain the expected behavior
- **Edge Cases**: Test both happy path and error scenarios
- **Authentication**: Always test authentication and authorization requirements
- **Cleanup**: Ensure tests clean up any side effects

### Future Testing Enhancements

Planned additions to the test suite:

- **Component Testing**: React component unit tests
- **Integration Testing**: End-to-end API workflow tests
- **Performance Testing**: Load testing for critical endpoints
- **Database Testing**: Direct database operation testing
- **Email Testing**: Email delivery and template testing

## Key Services

- **Email Service** (`src/lib/email/service.ts`): Handles all email communications
- **Supabase Client** (`src/lib/supabase.ts`): Database operations and auth
- **Stripe Integration** (`src/lib/stripe.ts`): Payment processing
- **Sentry Integration** (`src/lib/sentry-helpers.ts`): Error monitoring and alerting

## Development Workflow

1. **Make Changes**: Edit code and test locally
2. **Test Email**: Use test purchases to verify email delivery
3. **Check Logs**: Monitor `email_logs` table for delivery status
4. **Commit Changes**: Use descriptive commit messages

## Deployment

### Vercel Deployment (Recommended)

The application is designed to deploy on Vercel with optimal Next.js integration and built-in cron job support for Xero token management.

#### Prerequisites

- Vercel account (free tier available)
- GitHub/GitLab/Bitbucket repository
- All services configured (Supabase, Stripe, Loops.so, etc.)

#### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

#### Step 2: Login to Vercel

```bash
vercel login
```

#### Step 3: Deploy from Repository

```bash
# From your project directory
vercel --prod
```

Follow the prompts:

- **Project name**: Choose a name for your project
- **Directory**: Use current directory (default)
- **Settings**: Accept defaults for Next.js project

#### Step 4: Configure Environment Variables

In your Vercel dashboard, add all environment variables from your `.env.local`.
Replace your-domain with:

- Staging/Testing: membership-system-nycpha-preview
- Production: membership-system-nycpha

**Application Configuration:**

```bash
NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=your_nextauth_secret
CRON_SECRET=your_random_cron_secret_for_cron_jobs
```

**Database & Authentication:**

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
```

**Note:** For Supabase API keys, use the **new API keys** (not legacy) from your **production Supabase project** (not development). Go to Settings → API → "API Keys" tab and create new keys if needed.

**Payment Processing:**

```bash
STRIPE_SECRET_KEY=sk_live_your_stripe_live_secret_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_live_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_production_webhook_secret
STRIPE_API_VERSION=2025-07-30.basil
```

**Email & Monitoring:**

```bash
LOOPS_API_KEY=your_loops_api_key
LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID=your_template_id
LOOPS_WELCOME_TEMPLATE_ID=your_welcome_template_id
LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID=your_expiring_template_id
LOOPS_PAYMENT_FAILED_TEMPLATE_ID=your_payment_failed_template_id
LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID=your_registration_template_id
LOOPS_WAITLIST_ADDED_TEMPLATE_ID=your_waitlist_template_id
LOOPS_ALTERNATE_SELECTION_TEMPLATE_ID=your_alternate_selection_template_id
LOOPS_PAYMENT_METHOD_REMOVED_TEMPLATE_ID=your_payment_method_removed_template_id
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=membership-system
```

**Xero Integration:**

**Important**: Create separate Xero apps for production and preview environments to avoid tenant conflicts.

1. **Create Production Xero App:**
   - Go to [Xero Developer Console](https://developer.xero.com/myapps)
   - Create new app (name it "Your App - Production")
   - Set redirect URI: `https://your-production-domain.com/api/xero/callback`

2. **Create Preview Xero App:**
   - Create another app (name it "Your App - Preview")
   - Set redirect URI: `https://your-preview-domain.vercel.app/api/xero/callback`

```bash
# Use production app credentials for production environment
XERO_CLIENT_ID=your_production_xero_client_id_here
XERO_CLIENT_SECRET=your_production_xero_client_secret_here
XERO_REDIRECT_URI=https://your-domain.com/api/xero/callback
XERO_SCOPES=accounting.transactions accounting.contacts accounting.settings offline_access
```

#### Step 5: Update Service Configurations

**Supabase Authentication:**

1. Go to your Supabase Dashboard → Authentication → URL Configuration
2. Update **Site URL** to: `https://your-domain.vercel.app`
3. Add to **Redirect URLs**:
   - `https://your-domain.vercel.app/auth/callback`
   - `https://your-domain.vercel.app/**` (wildcard for all auth flows)

**Stripe Webhooks:**

1. Go to your Stripe Dashboard → Webhooks
2. Update endpoint URL to: `https://your-domain.vercel.app/api/stripe-webhook`
3. Copy the new webhook secret to `STRIPE_WEBHOOK_SECRET`

**Google OAuth:**

1. Go to Google Cloud Console → Credentials
2. Update authorized redirect URIs to include:
   - `https://your-domain.vercel.app/api/auth/callback/google`

**Xero OAuth:**

1. Go to Xero Developer Portal → Your App
2. Update OAuth 2.0 redirect URI to:
   - `https://your-domain.vercel.app/api/xero/callback`

#### Step 6: Verify Deployment

**Automatic Features (Vercel handles these):**

- ✅ **Next.js Build**: Automatic build optimization
- ✅ **Serverless Functions**: API routes automatically deployed
- ✅ **Cron Jobs**: Background processing runs daily (Xero operations + maintenance tasks)
- ✅ **SSL Certificate**: Automatic HTTPS with custom domain support
- ✅ **CDN**: Global edge network for fast loading

**Test Your Deployment:**

1. Visit your production URL
2. Test user registration and login
3. Make a test purchase with Stripe test cards
4. Verify email delivery through Loops.so
5. Check Xero integration (if configured)
6. Monitor Sentry for any deployment errors

#### Step 7: Set Up Custom Domain (Optional)

1. **Purchase Domain**: Buy domain from your preferred registrar
2. **Add to Vercel**: In project settings → Domains → Add domain
3. **Configure DNS**: Update your domain's nameservers to Vercel's
4. **Update Environment Variables**: Change `NEXTAUTH_URL` to your custom domain
5. **Update Service Callbacks**: Update Stripe, Google, and Xero redirect URLs

#### Deployment Checklist

- [ ] All environment variables configured in Vercel dashboard
- [ ] Stripe webhooks updated to production URL
- [ ] Google OAuth redirect URIs updated
- [ ] Xero OAuth redirect URI updated
- [ ] Supabase RLS policies tested with production data
- [ ] Email templates tested with production environment
- [ ] Sentry error monitoring configured for production
- [ ] Custom domain configured (if desired)
- [ ] SSL certificate active and verified
- [ ] Vercel Pro plan activated (required for cron jobs)
- [ ] `CRON_SECRET` environment variable configured
- [ ] Cron jobs verified in Vercel dashboard (4 active jobs)

#### Setting Up Vercel Cron Jobs (Pro Plan Required)

The application uses Vercel Cron jobs for background processing. **Vercel Pro plan is required** for the advanced cron job scheduling used in this system.

**1. Upgrade to Vercel Pro:**

1. Go to your Vercel account settings
2. Upgrade to **Pro plan** ($20/month)
3. Wait 5-10 minutes for the upgrade to propagate

**2. Configure CRON_SECRET Environment Variable:**

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add `CRON_SECRET` with a random string value
4. Generate a secure random string:

   ```bash
   openssl rand -base64 32
   ```

5. Set the value for **Production** environment

**3. Verify Cron Jobs in Vercel Dashboard:**

1. Go to **Settings** → **Cron Jobs**
2. You should see 3 active cron jobs:
   - `xero-sync` - Every 5 minutes (Xero invoice/payment sync)
   - `email-sync` - Every minute (staged email processing + failed email retry, limit 100 per batch)
   - `cleanup` - Daily at 2 AM (maintenance tasks)

**Note:** Cron jobs will not appear until the Pro plan is fully active and `CRON_SECRET` is configured.

**2. Verify CRON_SECRET Environment Variable:**

- Ensure `CRON_SECRET` is set in your Vercel environment variables
- This secret is used to authenticate cron job requests
- Generate a random string if not already set

**3. Test Cron Jobs (Optional):**
You can manually test cron jobs using curl:

```bash
# Test email sync operations (replace with your domain and secret)
curl -X GET https://your-domain.vercel.app/api/cron/email-sync \
  -H "Authorization: Bearer your-cron-secret"

# Test Xero sync operations
curl -X GET https://your-domain.vercel.app/api/cron/xero-sync \
  -H "Authorization: Bearer your-cron-secret"

# Test maintenance operations
curl -X GET https://your-domain.vercel.app/api/cron/maintenance \
  -H "Authorization: Bearer your-cron-secret"
```

**4. Monitor Cron Job Execution:**

- Check Vercel dashboard → **Functions** → **Cron Jobs** for execution logs
- Review application logs for cron job activity
- Monitor admin interface for sync status

**Note:** Cron jobs are included in Vercel Hobby plan but have execution limits. For higher frequency or more complex scheduling, consider upgrading to Vercel Pro.

#### Monitoring & Maintenance

**Vercel Dashboard:**

- Monitor deployment logs and function execution
- View usage analytics and performance metrics
- Manage environment variables and domains

**Application Health:**

- **Stripe**: Monitor payment processing in Stripe dashboard
- **Supabase**: Check database performance and connection pools
- **Loops.so**: Monitor email delivery rates and engagement
- **Sentry**: Track errors and performance issues
- **Xero**: Verify automatic invoicing and contact sync

#### Troubleshooting Common Issues

**Build Failures:**

- Check environment variables are properly set
- Verify all dependencies are installed
- Review build logs in Vercel dashboard

**Runtime Errors:**

- Check Sentry for detailed error reports
- Verify database connections and API keys
- Test payment flows with Stripe test cards

**Email Issues:**

- Verify Loops.so templates and API key
- Check email logs in Supabase `email_logs` table
- Test with different email providers

**Xero Sync Issues:**

- Verify OAuth redirect URI matches exactly
- Check Xero token expiration (automatic refresh should work)
- Review sync logs in admin interface

## Debugging

The system includes several debugging tools to help troubleshoot issues with user payments, Xero sync, and system operations.

### Debug Scripts

Located in `scripts/debug/`, these scripts help investigate specific issues:

#### User Invoice and Payment Debugging

**`debug-user-invoices.js`** - Investigate a specific user's invoices and payments:

```bash
# Usage: node debug-user-invoices.js <user_id>
node scripts/debug/debug-user-invoices.js 79e9a75e-2580-4d56-8d10-d1a6f8542118
```

**What it shows:**

- User details (name, email, member ID)
- All payments for the user
- All Xero invoices linked to the user
- All Xero payments linked to the user
- Summary with potential issues (failed syncs, duplicates)

#### Xero Sync Log Debugging

**`debug-user-sync-logs.js`** - Investigate Xero sync operations for a specific user:

```bash
# Usage: node debug-user-sync-logs.js <user_id>
node scripts/debug/debug-user-sync-logs.js 79e9a75e-2580-4d56-8d10-d1a6f8542118
```

**What it shows:**

- All Xero sync operations for the user's payments
- Failed sync operations and error messages
- Potential duplicate operations (race conditions)
- Timeline of sync events

### Environment Setup for Debug Scripts

Before running debug scripts, ensure your environment is configured:

```bash
# Set up environment variables
export NEXT_PUBLIC_SUPABASE_URL="your_supabase_url"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"

# Or use .env.local file
source .env.local
```

### Common Debugging Scenarios

**Duplicate Xero Invoices:**

```bash
# Check if a user has duplicate invoice numbers
node scripts/debug/debug-user-invoices.js <user_id>
```

**Failed Xero Sync:**

```bash
# Check sync logs for failed operations
node scripts/debug/debug-user-sync-logs.js <user_id>
```

**Payment Processing Issues:**

```bash
# Check all payment and invoice data for a user
node scripts/debug/debug-user-invoices.js <user_id>
```

### Admin Interface Debugging

The admin interface also provides debugging tools:

- **`/admin/logs`** - View system logs and error messages
- **`/admin/xero-integration`** - Monitor Xero sync status and retry failed operations
- **`/admin/reports/financial`** - Review payment and invoice data

### Database Debugging

For direct database access, use the Supabase dashboard:

- **Table Editor** - Browse and query data directly
- **SQL Editor** - Run custom queries for investigation
- **Logs** - View real-time database logs

## Support

For questions about the codebase or setup process, refer to:

- **Planning Document**: `PLANNING.md` for detailed architecture
- **Database Schema**: `supabase/schema.sql` for data models
- **Email Logs**: Check Supabase `email_logs` table for debugging

---

## Xero Accounting Integration

The system includes automatic Xero integration for seamless accounting and bookkeeping.

**📚 Important Resources:**

- **[Xero API Rate Limits](https://developer.xero.com/documentation/guides/oauth2/limits/)** - Current rate limits and best practices

### Setting Up Xero Integration

#### 1. Create Xero Developer App

1. Go to [Xero Developer Portal](https://developer.xero.com/)
2. Sign in with your Xero account
3. Create a new app with these settings:
   - **App Type**: Web app
   - **App Name**: "Hockey Association Membership System"
   - **Company/Application URL**: Your domain (e.g., `https://yourdomain.com`)
   - **OAuth 2.0 redirect URI**:
     - Development: `http://localhost:3000/api/xero/callback`
     - Production: `https://yourdomain.com/api/xero/callback`
   - **Scopes**:
     - `accounting.transactions` - Create and manage invoices
     - `accounting.contacts` - Create and manage contacts
     - `accounting.settings` - Read chart of accounts
     - `offline_access` - Refresh tokens

#### 2. Configure Environment Variables

Add these to your `.env.local`:

```bash
XERO_CLIENT_ID=your_xero_client_id_here
XERO_CLIENT_SECRET=your_xero_client_secret_here
XERO_REDIRECT_URI=http://localhost:3000/api/xero/callback
XERO_SCOPES=accounting.transactions accounting.contacts accounting.settings offline_access
```

#### 3. Connect to Xero

1. Start your development server: `npm run dev`
2. Log in as an admin user
3. Navigate to `/admin/xero-integration`
4. Click "Connect to Xero" and authorize the integration
5. Your Xero organization will now be connected

#### 4. Xero Setup Recommendations

**Chart of Accounts Setup:**

- `MEMBERSHIP` - Membership revenue account
- `REGISTRATION` - Registration revenue account  
- `DONATION` - Donation revenue account
- `STRIPE` - Stripe bank account for deposit tracking
- `STRIPE_FEES` - Expense account for processing fees
- `DISCOUNT-SCHOLAR` - Scholarship discount tracking
- `DISCOUNT-BOARD` - Board member discount tracking

**Bank Account Configuration:**

- Set up your Stripe account in Xero's bank accounts
- Use account code `STRIPE` for automatic payment recording

#### 5. URI Configuration for All Services

**Important:** These configurations should already be complete for your account, but here's the complete setup for reference.

##### **Google OAuth Configuration**

**Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID**

**Authorized JavaScript origins:**

```text
http://localhost:3000
https://membership-system-nycpha-preview.vercel.app
https://my.nycpha.org
```

**Authorized redirect URIs:**

```text
http://localhost:3000/api/auth/callback/google
https://membership-system-nycpha-preview.vercel.app/api/auth/callback/google
https://my.nycpha.org/api/auth/callback/google
```

##### **Supabase Authentication Configuration**

**Supabase Dashboard → Authentication → URL Configuration**

**Site URL:**

```text
https://my.nycpha.org
```

**Redirect URLs:**

```text
https://my.nycpha.org/auth/callback
https://my.nycpha.org/**
```

**For Development Environment:**

- **Site URL:** `https://membership-system-nycpha-preview.vercel.app`
- **Redirect URLs:**

  ```text
  https://membership-system-git-*-nycpha.vercel.app/**
  https://membership-system-nycpha-preview.vercel.app/**
  http://localhost:3000/**
  ```

**Note:** The wildcard pattern `/**` includes `/auth/callback`, so specific callback URLs are not needed when using wildcards.

**Supabase Dashboard → Authentication → Sign In / Providers → Google**

1. **Click on "Google"** in the providers list
2. **Enable "Sign in with Google"**
3. **Add your Google OAuth credentials:**

**Client ID:** Your Google OAuth client ID
**Client Secret:** Your Google OAuth client secret

**Where to get Google OAuth credentials:**

1. **Go to** [Google Cloud Console](https://console.cloud.google.com/)
2. **Navigate to** APIs & Services → Credentials
3. **Find your OAuth 2.0 Client ID** (or create a new one)
4. **Copy the Client ID**
5. **For Client Secret:**
   - **If you have an existing secret:** You cannot view it again (security feature)
   - **Create a new Client Secret:** Click "Reset Secret" or "Create New Secret"
   - **Copy the new secret immediately** (it's only shown once)

**Note:** You'll need to configure these settings for each Supabase project (development and production databases).

**Security Settings:**

- **DO NOT enable "Skip nonce checks"** - This is a security feature that should remain enabled
- **Keep all default security settings** unless you have a specific reason to change them

##### **Stripe Webhook Configuration**

**Stripe Dashboard → Webhooks**

You need separate webhook endpoints for each environment:

**Production Webhook:**

```text
https://my.nycpha.org/api/stripe-webhook
```

**Development/Preview Webhook:**

```text
https://membership-system-nycpha-preview.vercel.app/api/stripe-webhook
```

**Feature Branch Testing (optional):**
For testing specific feature branches, you can create additional webhooks:

```text
https://membership-system-git-[branch-name]-nycpha.vercel.app/api/stripe-webhook
```

**Events to Send:**
Select these specific events for each webhook:

- `payment_intent.succeeded` - When payment completes successfully
- `payment_intent.payment_failed` - When payment fails  
- `payment_intent.canceled` - When payment is canceled (timeout/user abandonment)
- `setup_intent.succeeded` - When a payment method setup completes successfully
- `setup_intent.setup_failed` - When a payment method setup fails
- `payment_method.detached` - When a payment method removed (user revokes payment setup)
- `charge.refunded` - When a refund is processed (for refund system)
- `charge.updated` - When balance transaction becomes available (for accurate fee tracking)

**Important:**

- Each webhook endpoint gets its own signing secret (`STRIPE_WEBHOOK_SECRET`)
- Use production webhook only with live Stripe keys
- Use development webhook with test Stripe keys
- Select the events listed above (payment_intent.*, setup_intent.*, charge.refunded, charge.updated) for each webhook

**Note:** The `payment_intent.canceled` event helps track abandoned payments for analytics and cleanup, though the webhook handler will need to be updated to process this event.

##### **Xero OAuth Configuration**

**Xero Developer Portal → Your App → OAuth 2.0**

**Redirect URI:**

```text
https://my.nycpha.org/api/xero/callback
```

## Payment Processing & Xero Integration Flow

The system implements a robust, multi-stage payment processing pipeline that ensures data integrity, handles failures gracefully, and provides complete transparency into operations.

### Architecture Overview

```text
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   Stripe        │    │  Payment Completion │    │  Xero Batch     │
│   Webhook       │───▶│  Processor          │───▶│  Sync Manager   │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│  Core Business  │    │  Email Staging &    │    │  Rate Limited   │
│  Records        │    │  Processing         │    │  API Calls      │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
```

### Email Processing Architecture

The system implements a **fire-and-forget email processing architecture** optimized for serverless environments to ensure fast payment completion responses while maintaining reliable email delivery.

#### Email Processing Flow

```text
Payment Completion (Fast Response):
┌─────────────────────────────────────┐
│ PaymentCompletionProcessor          │
│ ├─ Phase 1: Xero staging (awaited)  │
│ ├─ Phase 2: Email staging (awaited) │
│ ├─ Phase 3: Email processing (fire-and-forget) │
│ ├─ Phase 4: Xero sync (fire-and-forget) │
│ └─ Phase 5: Discount usage (awaited) │
└─────────────────────────────────────┘

Background Email Processing:
┌─────────────────────────────────────┐
│ EmailProcessingManager              │
│ └─ emailStagingManager.processStagedEmails() │
│    └─ Send emails one by one with delays │
└─────────────────────────────────────┘

Scheduled Tasks (Cron):
┌─────────────────────────────────────┐
│ Cron Endpoints                      │
│ ├─ /api/cron/email-retry           │
│ ├─ /api/cron/maintenance           │
│ └─ /api/cron/cleanup               │
└─────────────────────────────────────┘
```

#### Key Design Principles

**1. Single Source of Truth**

- Only `PaymentCompletionProcessor` handles staged email processing
- No duplicate processing from background services
- Eliminates race conditions and duplicate emails

**2. Fire-and-Forget Processing**

- Payment completion doesn't wait for email processing
- Immediate response to users for better UX
- Background failures don't affect payment completion

**3. Serverless-Optimized**

- No long-running processes or `setInterval` calls
- All scheduled tasks handled by Vercel cron endpoints
- Removed unused scheduled processing methods

**4. Simple Email Processing**

- No complex batch job system for emails
- Direct processing of staged emails with delays
- Clear separation between staging and sending

#### Email Processing Components

**Email Staging Manager** (`src/lib/email/staging.ts`)

- Stages emails in database for batch processing
- Handles email delays and rate limiting
- Processes emails one by one with configurable delays

**Email Processing Manager** (`src/lib/email/batch-sync-email.ts`)

- Simplified email processing utility
- No complex batch job system
- Direct processing of staged emails

**Payment Completion Processor** (`src/lib/payment-completion-processor.ts`)

- Stages confirmation emails during payment completion
- Triggers fire-and-forget email processing
- Ensures emails are queued for immediate delivery

#### Benefits

1. **Fast Payment Response** - Payment completion returns immediately
2. **No Duplicate Emails** - Single source of truth for email processing
3. **Better UX** - Users get immediate confirmation
4. **Error Isolation** - Background failures don't affect payment completion
5. **Serverless Compatible** - No long-running processes
6. **Simple Architecture** - Easy to understand and maintain

### Detailed Flow

#### 1. Payment Initiation

- User completes payment via Stripe
- Payment intent created with metadata (user_id, membership_id, etc.)
- User redirected to success/failure page

#### 2. Stripe Webhook Processing

**Event**: `payment_intent.succeeded` or `payment_intent.payment_failed`

**Webhook Handler** (`src/app/api/stripe-webhook/route.ts`):

- ✅ **Validates webhook signature** for security
- ✅ **Updates core business records**:
  - `user_memberships` or `user_registrations` → `payment_status: 'paid'`
  - `payments` → `status: 'completed'`
- ✅ **Triggers Payment Completion Processor** for orchestration
- ✅ **Handles payment failures** with cleanup and notifications

**Key Design Principle**: Webhook focuses solely on core business record updates and delegates all complex processing to the Payment Completion Processor.

#### 3. Payment Completion Processor

**Service**: `src/lib/payment-completion-processor.ts`

**Responsibilities**:

- ✅ **Xero Staging Record Management**:
  - Creates/updates `xero_invoices` and `xero_payments` staging records
  - Transitions records from `'staged'` → `'pending'` → `'synced'`
  - Handles both new staging and invoice-first flow scenarios
- ✅ **Email Orchestration**:
  - Stages confirmation emails for batch processing
  - Triggers immediate email sending for critical notifications
- ✅ **Batch Sync Triggering**:
  - Initiates Xero batch sync operations
  - Ensures proper sequencing of operations

**Staging Record Search Logic**:

```typescript
// 1. Search by payment_id (for completed payments)
// 2. Search by user_id in staging_metadata (for staged records)
// 3. Search by xero_invoice_id (for invoice-first flow)
// 4. Handle null payment_id scenarios gracefully
```

#### 4. Xero Batch Sync Manager

**Service**: `src/lib/xero/batch-sync.ts`

**Singleton Pattern with Concurrency Protection**:

- ✅ **Prevents concurrent execution** - Only one sync operation at a time
- ✅ **Rate limit protection** - 2-second minimum delay between syncs
- ✅ **Comprehensive logging** - Unique call IDs for transparency
- ✅ **State management** - Tracks running status and timing

**Sync Process**:

1. **Phase 1**: Query pending records from database
2. **Phase 2**: Connect to Xero (with token refresh if needed)
3. **Phase 3**: Sync invoices (create contacts, generate invoices)
4. **Phase 4**: Sync payments (record payments against invoices)

**Rate Limiting Strategy**:

```typescript
// Minimum 2-second delay between sync operations
private readonly MIN_DELAY_BETWEEN_SYNCS = 2000

// Automatic delay enforcement
if (remainingDelay > 0) {
  console.log(`⏳ Rate limit protection: waiting ${remainingDelay}ms`)
  await new Promise(resolve => setTimeout(resolve, remainingDelay))
}
```

#### 5. Xero API Integration

**Contact Management**:

- ✅ **Smart contact creation** with member ID integration
- ✅ **Archived contact handling** with intelligent resolution
- ✅ **Naming convention**: "First Last - MemberID" format
- ✅ **Duplicate prevention** with name-first search strategy

**Invoice Generation**:

- ✅ **Detailed line items** for membership/registration fees
- ✅ **Discount code integration** as negative line items
- ✅ **Professional formatting** using Xero templates
- ✅ **Status tracking** (DRAFT → AUTHORISED)

**Payment Recording**:

- ✅ **Net amount recording** (gross minus Stripe fees)
- ✅ **Bank account integration** with Stripe account codes
- ✅ **Reference tracking** with payment intent IDs
- ✅ **Automatic reconciliation** with invoices

### Data Flow States

#### Staging Record Lifecycle

```text
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐
│ staged  │───▶│ pending  │───▶│ synced  │───▶│ failed  │
└─────────┘    └──────────┘    └─────────┘    └─────────┘
     │              │              │              │
  Initial        Ready for      Successfully   Error state
  creation       Xero sync      synced to      (retryable)
                 (webhook       Xero
                 triggered)                     
```

#### Payment Status Flow

```text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ processing  │───▶│ completed   │───▶│ synced      │
└─────────────┘    └─────────────┘    └─────────────┘
     │                   │                   │
  Payment in          Payment              Xero sync
  progress            successful           complete
```

### Error Handling & Resilience

#### Graceful Degradation

- ✅ **Payment processing continues** even if Xero sync fails
- ✅ **Email delivery independent** of Xero operations
- ✅ **Staging records preserved** for retry mechanisms
- ✅ **Webhook idempotency** prevents duplicate processing

#### Retry Mechanisms

- ✅ **Automatic retry** via cron jobs every 2 minutes
- ✅ **Manual sync options** in admin interface
- ✅ **Failed record tracking** with detailed error logging
- ✅ **Token refresh** handles Xero authentication expiry

#### Monitoring & Alerting

- ✅ **Sentry integration** for critical error tracking
- ✅ **Comprehensive logging** with unique call IDs
- ✅ **Admin dashboard** for sync status monitoring
- ✅ **Email notifications** for failed operations

### Performance Optimizations

#### Batch Processing

- ✅ **Intelligent batching** based on record count
- ✅ **Concurrency control** to prevent API rate limits
- ✅ **Optimized queries** with proper indexing
- ✅ **Memory management** for large datasets

#### Rate Limit Management

- ✅ **2-second minimum delays** between sync operations
- ✅ **API call spacing** within batch operations
- ✅ **Token refresh optimization** to minimize API calls
- ✅ **Concurrent execution prevention** via singleton pattern

### Security Considerations

#### Data Protection

- ✅ **Webhook signature validation** prevents unauthorized calls
- ✅ **Environment-specific Xero apps** prevent tenant conflicts
- ✅ **Token encryption** in database storage
- ✅ **RLS policies** protect sensitive data

#### Access Control

- ✅ **Admin-only sync operations** require proper authentication
- ✅ **Audit logging** for all sync operations
- ✅ **Error masking** prevents sensitive data exposure
- ✅ **Rate limiting** prevents abuse

### Testing & Validation

#### Test Scenarios

1. **Successful Payment Flow**: Complete end-to-end processing
2. **Payment Failure**: Proper cleanup and notifications
3. **Xero Sync Failure**: Graceful degradation and retry
4. **Concurrent Operations**: Singleton pattern validation
5. **Rate Limiting**: Delay enforcement verification
6. **Token Expiry**: Automatic refresh handling

#### Monitoring Points

- ✅ **Webhook delivery** via Stripe dashboard
- ✅ **Database record states** in Supabase
- ✅ **Xero sync status** in admin interface
- ✅ **Email delivery** via Loops.so dashboard
- ✅ **Error tracking** via Sentry

### How Xero Integration Works

#### Automatic Sync Process

1. **Payment Completed** → Stripe webhook triggers staging record creation
2. **Staging Records** → Invoice and payment records created with 'pending' status
3. **Cron Job Processing** → Every 2 minutes, cron jobs sync eligible records:
   - **Invoices**: All pending/staged invoices
   - **Payments**: Only completed, non-free payments
4. **Contact Creation** → User automatically added as Xero contact
5. **Invoice Generation** → Detailed invoice created with line items:
   - Membership purchases
   - Registration fees
   - Donations (if applicable)
   - Discount codes (as negative line items)
6. **Payment Recording** → Net payment recorded (gross amount minus Stripe fees)
7. **Fee Tracking** → Stripe processing fees optionally recorded as expenses

#### Sync Criteria

**Invoices**: All records with `sync_status IN ('pending', 'staged')`

**Payments**: Filtered by:

- `sync_status IN ('pending', 'staged')`
- `payments.status = 'completed'`
- `payments.payment_method != 'free'`

This ensures only completed, paid transactions are synced to Xero.

#### Manual Sync Operations

The admin interface provides manual sync options:

- **Sync Contacts** - Create Xero contacts for all users who have made payments
- **Sync Invoices** - Create invoices for all completed payments  
- **Record Payments** - Record Stripe payments in Xero for existing invoices

#### Financial Benefits

✅ **Automated Bookkeeping** - Eliminates manual invoice entry
✅ **Accurate Fee Tracking** - Stripe processing costs automatically recorded
✅ **Professional Invoicing** - Uses Xero's templates and delivery system
✅ **Real-time Sync** - Financial data synchronized every 2 minutes
✅ **Discount Transparency** - Clear breakdown of promotional pricing
✅ **Audit Trail** - Complete transaction history and error logging
✅ **Staging-First Approach** - Zero data loss with robust staging system
✅ **Intelligent Filtering** - Only syncs eligible payments (completed, non-free)
✅ **Pro Plan Optimization** - Leverages Vercel Pro for high-frequency processing

#### Contact Management & Conflict Resolution

**Xero Contact Constraints:**

- ✅ **Unique Names Required**: Xero enforces unique contact names
- ⚠️ **Duplicate Emails Allowed**: Xero permits multiple contacts with same email address

**Our Contact Strategy:**

1. **Member ID Integration**: All users are assigned unique member IDs (e.g., 1001, 1002)
2. **Naming Convention**: Contacts created as "First Last - MemberID" (e.g., "David Wender - 1001")
3. **Intelligent Archived Contact Handling**: Smart detection and resolution of archived contact conflicts
4. **Name Standardization**: Ensures all contacts follow consistent naming conventions

#### Improved Contact Search Strategy

Our system uses a **name-first search strategy** to prevent picking up the wrong contact when multiple contacts exist with the same email:

1. ✅ **Search by exact contact name first** → Look for "First Last - MemberID" (e.g., "David Wender - 1002")
2. ✅ **Fall back to email search** → Only if exact name not found, search by email
3. ✅ **Prioritize exact matches** → Use exact name matches over partial matches
4. ✅ **Handle archived contacts** → Skip archived contacts, find active alternatives
5. ✅ **Create new only if necessary** → Create new contact only if no suitable alternatives exist

This prevents the system from picking up the wrong contact when you have multiple contacts with the same email address in Xero.

#### When Archived Contact is Detected

Our system follows an intelligent 5-step process to handle archived contacts while minimizing duplication:

1. ✅ **Search by exact contact name first** → Look for "First Last - MemberID"
2. ✅ **Fall back to email search** → Get all contacts with user's email address
3. ✅ **Look for non-archived alternatives** → Find contacts that aren't archived  
4. ✅ **Check naming convention** → Does contact name start with "First Last - MemberID"?
5. ✅ **Use standardized contact** → Apply updates and use for operations
6. ✅ **Create new only if necessary** → Create new contact only if no alternatives exist

#### Archived Contact Resolution Scenarios

**Scenario 1: Perfect Match Found**

- **Situation**: Find archived "David Wender - 1002", find active "David Wender - 1002"
- **Action**: ✅ **Use existing active contact as-is**
- **Result**: No new contact created, maintains data integrity

**Scenario 2: Legacy Contact Found**  

- **Situation**: Find archived "David Wender - 1002", find active "David Wender" (old format)
- **Action**: ✅ **Update to "David Wender - 1002"** (standardized naming)
- **Result**: Legacy contact updated to follow naming convention

**Scenario 3: Different Member Found**

- **Situation**: Find archived "David Wender - 1002", find active "David Wender - 1001"
- **Action**: ✅ **Use existing "David Wender - 1001" as-is** (already correct format)
- **Result**: Uses different member's contact (same person, different membership)

**Scenario 4: Archived Contact with Exact Name**

- **Situation**: Find archived "David Wender - 1002" (exact name match)
- **Action**: ✅ **Rename to "David Wender - 1002 - Archived"** then create new "David Wender - 1002"
- **Result**: Archived contact preserved, new active contact created

**Scenario 5: No Alternatives - Create New**

- **Situation**: Find archived "David Wender - 1002", no other active contacts found
- **Action**: ✅ **Create new "David Wender - 1002"**
- **Result**: New contact created with clean naming

#### Benefits

- ✅ **Prevents Contact Duplication**: Reduces unnecessary contact creation by 80%+
- ✅ **Naming Consistency**: All contacts follow "First Last - MemberID" format  
- ✅ **Legacy Cleanup**: Gradually updates old contact names to new standard
- ✅ **Archive Respect**: Doesn't override business decisions to archive contacts
- ✅ **Smart Archived Contact Handling**: Renames archived contacts to avoid conflicts
- ✅ **Member ID Visibility**: Always shows member number in Xero contact name
- ✅ **Audit Trail**: Clear tracking when multiple contacts needed for same person
- ✅ **Clean Contact Creation**: New contacts created with proper naming, no timestamps needed

#### Troubleshooting

**Common Issues:**

- **Token Expired**: Tokens refresh automatically, but you can reconnect manually (refresh tokens expire after 60 days)
- **Sync Failures**: Check the sync logs in the admin interface for detailed error messages
- **Missing Invoices**: Use the bulk sync feature to catch up on historical data
- **Account Codes**: Discount codes and memberships will use default codes if not configured
- **Archived Contacts**: System automatically creates new contacts when encountering archived ones

**Error Monitoring:**

- All sync operations are logged to Sentry for monitoring
- Detailed sync logs available in admin interface
- Failed syncs don't affect payment processing

### Testing Xero Integration

1. **Use Xero Demo Company** for testing (recommended)
2. **Complete a test purchase** to verify the full sync workflow
3. **Check Xero** for created contact, invoice, and payment
4. **Verify sync status** in admin interface
5. **Test bulk sync** features with historical data

---

## Recent Optimizations & Cleanup

### Email Processing Architecture Overhaul (Latest)

**Problem Solved**: Duplicate email processing and slow payment completion responses due to complex batch job systems.

**Changes Made**:

- ✅ **Removed duplicate email processing** - Only PaymentCompletionProcessor handles staged emails
- ✅ **Simplified batch processing** - Removed complex batch job system for emails
- ✅ **Fire-and-forget processing** - Payment completion doesn't wait for emails/Xero sync
- ✅ **Serverless optimization** - Removed unused scheduled processing methods
- ✅ **Cleaner codebase** - Removed 738+ lines of unused code

**Performance Improvements**:

- **Faster payment completion** - Immediate response to users
- **No duplicate emails** - Single source of truth for email processing
- **Better error isolation** - Background failures don't affect payment completion
- **Simplified architecture** - Easier to understand and maintain

### Architecture Cleanup

**Removed Components**:

- ❌ `ScheduledBatchProcessor` - Unused scheduled processing logic
- ❌ Complex batch job system for emails - Unnecessary complexity
- ❌ Unused `Database` imports - Cleaned up imports
- ❌ Duplicate email processing paths - Single source of truth

**Optimized Components**:

- ✅ `BatchProcessor` - Kept for Xero sync operations (actively used)
- ✅ `EmailProcessingManager` - Simplified email processing utility
- ✅ `PaymentCompletionProcessor` - Fire-and-forget architecture
- ✅ Cron endpoints - Handle all scheduled tasks in serverless environment

**Current Architecture**:

```text
Payment Completion (Fast):
┌─────────────────────────────────────┐
│ PaymentCompletionProcessor          │
│ ├─ Phase 1: Xero staging (awaited)  │
│ ├─ Phase 2: Email staging (awaited) │
│ ├─ Phase 3: Email processing (fire-and-forget) │
│ ├─ Phase 4: Xero sync (fire-and-forget) │
│ └─ Phase 5: Discount usage (awaited) │
└─────────────────────────────────────┘

Scheduled Tasks (Cron):
┌─────────────────────────────────────┐
│ Cron Endpoints                      │
│ ├─ /api/cron/xero-sync             │
│ ├─ /api/cron/email-retry           │
│ ├─ /api/cron/maintenance           │
│ └─ /api/cron/cleanup               │
└─────────────────────────────────────┘

Batch Processing (Xero Only):
┌─────────────────────────────────────┐
│ BatchProcessor                      │
│ └─ Used by Xero sync operations    │
└─────────────────────────────────────┘
```

---

**Tech Stack**: Next.js 14, TypeScript, Tailwind CSS, Supabase, Stripe, Loops.so, Xero API
