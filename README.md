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

# Email Integration
LOOPS_API_KEY=your_loops_api_key
LOOPS_MEMBERSHIP_PURCHASE_TEMPLATE_ID=your_template_id
LOOPS_WELCOME_TEMPLATE_ID=your_welcome_template_id
LOOPS_MEMBERSHIP_EXPIRING_TEMPLATE_ID=your_expiring_template_id
LOOPS_PAYMENT_FAILED_TEMPLATE_ID=your_payment_failed_template_id
LOOPS_REGISTRATION_CONFIRMATION_TEMPLATE_ID=your_registration_template_id
LOOPS_WAITLIST_ADDED_TEMPLATE_ID=your_waitlist_template_id

# Error Monitoring
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=membership-system

# Xero Integration Configuration
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
   - Copy the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - Copy the **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
   
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
   ```
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
```
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
```
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
```
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
```
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
```
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

### 4. Template Management Guidelines

**🚨 IMPORTANT:** When adding new email functionality to the application:

1. **Add the email event type** to `EMAIL_EVENTS` in `src/lib/email-service.ts`
2. **Create the email function** (e.g., `sendRegistrationConfirmation()`)
3. **Add environment variable** for template ID (e.g., `LOOPS_REGISTRATION_TEMPLATE_ID`)
4. **Update this README.md** with template setup instructions and data variables
5. **Test the email** with sample data to ensure all variables work correctly

This ensures all email templates are properly documented and maintainable.

### 5. Testing Email Integration

1. Complete the Loops setup above
2. Make a test membership purchase in your application
3. Check the `email_logs` table in Supabase to verify delivery status
4. Confirm the email was received with proper variable substitution

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

```
src/
├── app/                 # Next.js app directory
├── components/          # React components
├── lib/                # Utilities and services
│   ├── email-service.ts # Email integration service
│   ├── supabase.ts     # Database client
│   └── stripe.ts       # Payment processing
├── middleware.ts       # Authentication middleware
└── types/              # TypeScript type definitions
```

## Key Services

- **Email Service** (`src/lib/email-service.ts`): Handles all email communications
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
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=membership-system
```

**Xero Integration:**
```bash
XERO_CLIENT_ID=your_xero_client_id_here
XERO_CLIENT_SECRET=your_xero_client_secret_here
XERO_REDIRECT_URI=https://your-domain.vercel.app/api/xero/callback
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
2. You should see 4 active cron jobs:
   - `xero-sync` - Every 2 minutes (Xero invoice/payment sync)
   - `xero-keep-alive` - Every 6 hours (Xero token refresh)
   - `email-retry` - Every 2 hours (failed email retry)
   - `cleanup` - Daily at 2 AM (maintenance tasks)

**Note:** Cron jobs will not appear until the Pro plan is fully active and `CRON_SECRET` is configured.

**2. Verify CRON_SECRET Environment Variable:**
- Ensure `CRON_SECRET` is set in your Vercel environment variables
- This secret is used to authenticate cron job requests
- Generate a random string if not already set

**3. Test Cron Jobs (Optional):**
You can manually test cron jobs using curl:
```bash
# Test Xero daily operations (replace with your domain and secret)
curl -X GET https://your-domain.vercel.app/api/cron/xero-daily \
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
```
http://localhost:3000
https://membership-system-nycpha-preview.vercel.app
https://my.nycpha.org
```

**Authorized redirect URIs:**
```
http://localhost:3000/api/auth/callback/google
https://membership-system-nycpha-preview.vercel.app/api/auth/callback/google
https://my.nycpha.org/api/auth/callback/google
```

##### **Supabase Authentication Configuration**

**Supabase Dashboard → Authentication → URL Configuration**

**Site URL:**
```
https://my.nycpha.org
```

**Redirect URLs:**
```
https://my.nycpha.org/auth/callback
https://my.nycpha.org/**
```

**For Development Environment:**
- **Site URL:** `https://membership-system-nycpha-preview.vercel.app`
- **Redirect URLs:**
  ```
  https://membership-system-nycpha-preview.vercel.app/auth/callback
  https://membership-system-nycpha-preview.vercel.app/**
  ```

**For Local Development:**
- **Site URL:** `http://localhost:3000`
- **Redirect URLs:**
  ```
  http://localhost:3000/auth/callback
  http://localhost:3000/**
  ```

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

**Endpoint URL:**
```
https://my.nycpha.org/api/stripe-webhook
```

##### **Xero OAuth Configuration**

**Xero Developer Portal → Your App → OAuth 2.0**

**Redirect URI:**
```
https://my.nycpha.org/api/xero/callback
```

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

#### When Archived Contact is Detected

Our system follows an intelligent 5-step process to handle archived contacts while minimizing duplication:

1. ✅ **Search all contacts by email** → Get all contacts with user's email address
2. ✅ **Look for non-archived alternatives** → Find contacts that aren't archived  
3. ✅ **Check naming convention** → Does contact name start with "First Last - MemberID"?
4. ✅ **Use standardized contact** → Apply updates and use for operations
5. ✅ **Create new only if necessary** → Create new contact only if no alternatives exist

#### Archived Contact Resolution Scenarios

**Scenario 1: Perfect Match Found**
- **Situation**: Find archived "David Wender - 1002", find active "David Wender - 1002"
- **Action**: ✅ **Use existing active contact as-is**
- **Result**: No new contact created, maintains data integrity

**Scenario 2: Legacy Contact Found**  
- **Situation**: Find archived "David Wender - 1002", find active "David Wender" (old format)
- **Action**: ✅ **Update to "David Wender - 1002 (43423)"** (standardized + timestamp)
- **Result**: Legacy contact updated to follow naming convention

**Scenario 3: Different Member Found**
- **Situation**: Find archived "David Wender - 1002", find active "David Wender - 1001" 
- **Action**: ✅ **Use existing "David Wender - 1001" as-is** (already correct format)
- **Result**: Uses different member's contact (same person, different membership)

**Scenario 4: No Alternatives - Create New**
- **Situation**: Find archived "David Wender - 1002", no other active contacts found
- **Action**: ✅ **Create new "David Wender - 1002 (43423)"**
- **Result**: New contact created with timestamp to ensure uniqueness

#### Benefits

- ✅ **Prevents Contact Duplication**: Reduces unnecessary contact creation by 80%+
- ✅ **Naming Consistency**: All contacts follow "First Last - MemberID" format  
- ✅ **Legacy Cleanup**: Gradually updates old contact names to new standard
- ✅ **Archive Respect**: Doesn't override business decisions to archive contacts
- ✅ **Member ID Visibility**: Always shows member number in Xero contact name
- ✅ **Audit Trail**: Clear tracking when multiple contacts needed for same person

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

**Tech Stack**: Next.js 14, TypeScript, Tailwind CSS, Supabase, Stripe, Loops.so, Xero API