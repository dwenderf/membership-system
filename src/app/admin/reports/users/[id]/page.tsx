import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AdminHeader from '@/components/AdminHeader'
import { formatAmount } from '@/lib/format-utils'
import { Logger } from '@/lib/logging/logger'
import { formatDate, formatDateTime } from '@/lib/date-utils'
import AdminToggleSection from './AdminToggleSection'
import DiscountUsage from '@/components/DiscountUsage'
import PaymentPlanSection from './PaymentPlanSection'

interface PageProps {
  params: {
    id: string
  }
  searchParams: {
    from?: string
  }
}

export default async function UserDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  const logger = Logger.getInstance()

  // Get current authenticated user
  const { data: { user: authUser } } = await supabase.auth.getUser()
  
  if (!authUser) {
    redirect('/admin/reports/users')
  }

  // Fetch user details
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', params.id)
    .single()

  if (userError || !user) {
    logger.logSystem('user-detail-error', 'Error fetching user details', { 
      userId: params.id,
      error: userError?.message 
    })
    redirect('/admin/reports/users')
  }

  // Check if current user is viewing their own profile
  const isViewingOwnProfile = authUser.id === params.id

  // Fetch user's consolidated memberships (both active and expired)
  const { data: userMemberships } = await adminSupabase
    .from('user_memberships_consolidated')
    .select('*')
    .eq('user_id', params.id)
    .order('latest_expiration', { ascending: false })

  // Fetch user's active registrations
  const { data: userRegistrations } = await supabase
    .from('user_registrations')
    .select(`
      *,
      registrations (
        name,
        description
      ),
      registration_categories (
        name
      )
    `)
    .eq('user_id', params.id)
    .eq('payment_status', 'paid')
    .order('created_at', { ascending: false })

  // Fetch user's payments and invoices
  let invoices: any[] = []
  
  // Fetch payments with related Xero invoice data and refunds (only original invoices, not credit notes)
  const { data: userPayments } = await adminSupabase
    .from('payments')
    .select(`
      *,
      xero_invoices!left (
        id,
        xero_invoice_id,
        invoice_number,
        invoice_status,
        total_amount,
        net_amount,
        created_at,
        invoice_type,
        sync_status,
        is_payment_plan,
        xero_invoice_line_items (
          id,
          description,
          line_amount,
          account_code
        )
      ),
      refunds!left (
        id,
        amount,
        status
      )
    `)
    .eq('user_id', params.id)
    .in('status', ['completed', 'refunded'])
    .order('created_at', { ascending: false })

  // Fetch credit notes for this user
  const { data: userCreditNotes } = await adminSupabase
    .from('xero_invoices')
    .select(`
      *,
      staging_metadata,
      payments!xero_invoices_payment_id_fkey (
        id,
        final_amount,
        completed_at,
        created_at
      )
    `)
    .eq('invoice_type', 'ACCRECCREDIT')
    .eq('sync_status', 'synced')
    .not('invoice_number', 'is', null)
    .order('created_at', { ascending: false })

  // Fetch payment plan statuses for payment plan invoices
  const paymentPlanStatuses = new Map<string, { isPaymentPlan: boolean, isFullyPaid: boolean, amountPaid: number }>()

  for (const payment of userPayments || []) {
    const originalInvoice = payment.xero_invoices?.find((inv: any) =>
      inv.invoice_type === 'ACCREC' && inv.is_payment_plan
    )

    if (originalInvoice) {
      // Check if all installments are completed and calculate amount paid
      const { data: installments } = await adminSupabase
        .from('xero_payments')
        .select('sync_status, payment_type, amount_paid')
        .eq('xero_invoice_id', originalInvoice.id)
        .eq('payment_type', 'installment')

      const isFullyPaid = installments?.every(inst => inst.sync_status === 'synced') ?? false
      const amountPaid = installments
        ?.filter(inst => inst.sync_status === 'synced')
        .reduce((sum, inst) => sum + inst.amount_paid, 0) ?? 0

      paymentPlanStatuses.set(payment.id, { isPaymentPlan: true, isFullyPaid, amountPaid })
    }
  }

  // Transform payments into invoice-like objects for display
  invoices = userPayments?.map(payment => {
    // Calculate refund information
    const completedRefunds = payment.refunds?.filter((refund: any) => refund.status === 'completed') || []
    const totalRefunded = completedRefunds.reduce((sum: number, refund: any) => sum + refund.amount, 0)

    // Filter to get synced or pending ACCREC invoices (exclude staged and credit notes)
    // Pending invoices are awaiting Xero sync (payment successful, just not synced yet)
    const validInvoices = payment.xero_invoices?.filter((invoice: any) =>
      invoice.invoice_type === 'ACCREC' &&
      (invoice.sync_status === 'synced' || invoice.sync_status === 'pending')
    ) || []

    // Prefer synced invoices with invoice numbers, then pending invoices
    const originalInvoice = validInvoices.find((inv: any) => inv.invoice_number && inv.sync_status === 'synced')
      || validInvoices.find((inv: any) => inv.sync_status === 'pending')
      || validInvoices[0]

    // Skip payments without a valid invoice (e.g., payment plan payoffs)
    // These payments are already reflected in the original invoice's payment status
    if (!originalInvoice) {
      return null
    }

    // Determine invoice number display (show "Pending Sync" for pending invoices)
    const invoiceNumber = originalInvoice?.invoice_number
      || (originalInvoice?.sync_status === 'pending' ? 'Pending Sync' : `PAY-${payment.id.slice(0, 8)}`)

    // For payment plans, use the full invoice amount; otherwise use the payment amount
    const invoiceAmount = originalInvoice?.net_amount ?? payment.final_amount
    const netAmount = invoiceAmount - totalRefunded
    const isPartiallyRefunded = totalRefunded > 0 && totalRefunded < invoiceAmount
    const isFullyRefunded = invoiceAmount > 0 && totalRefunded >= invoiceAmount

    // Get payment plan status
    const paymentPlanStatus = paymentPlanStatuses.get(payment.id)

    return {
      id: payment.id,
      paymentId: payment.id,
      number: invoiceNumber,
      date: payment.completed_at || payment.created_at,
      originalAmount: invoiceAmount,
      totalRefunded: totalRefunded,
      netAmount: netAmount,
      status: payment.status,
      isPartiallyRefunded: isPartiallyRefunded,
      isFullyRefunded: isFullyRefunded,
      hasXeroInvoice: !!originalInvoice,
      xeroInvoiceId: originalInvoice?.id,
      canRefund: payment.status === 'completed' && netAmount > 0,
      lineItems: originalInvoice?.xero_invoice_line_items || [],
      invoice_type: 'ACCREC',
      isPaymentPlan: paymentPlanStatus?.isPaymentPlan ?? false,
      isPaymentPlanFullyPaid: paymentPlanStatus?.isFullyPaid ?? false,
      paymentPlanAmountPaid: paymentPlanStatus?.amountPaid ?? 0
    }
  }).filter(invoice => invoice !== null) || []

  // Transform credit notes and add them to the invoices list
  const creditNoteInvoices = userCreditNotes?.filter(creditNote => {
    // Filter credit notes for this user by checking the staging metadata
    const metadata = creditNote.staging_metadata as any
    return metadata?.customer?.id === params.id
  }).map(creditNote => {
    const metadata = creditNote.staging_metadata as any
    return {
      id: creditNote.id,
      paymentId: creditNote.payment_id,
      number: creditNote.invoice_number,
      date: creditNote.created_at,
      originalAmount: Math.abs(creditNote.net_amount), // Credit notes are negative, show as positive
      totalRefunded: 0, // Credit notes don't have refunds
      netAmount: Math.abs(creditNote.net_amount),
      status: 'credited',
      isPartiallyRefunded: false,
      isFullyRefunded: false,
      hasXeroInvoice: true,
      xeroInvoiceId: creditNote.id,
      canRefund: false, // Credit notes cannot be refunded
      lineItems: [],
      invoice_type: 'ACCRECCREDIT'
    }
  }) || []

  // Combine invoices and credit notes, then sort by date
  invoices = [...invoices, ...creditNoteInvoices].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <Link
                  href={searchParams.from === 'payment-plans' ? '/admin/reports/payment-plans' : '/admin/reports/users'}
                  className="text-blue-600 hover:text-blue-500 text-sm font-medium mb-4 inline-block"
                >
                  ← {searchParams.from === 'payment-plans' ? 'Back to Payment Plans' : 'Back to Users'}
                </Link>
                <h1 className="text-3xl font-bold text-gray-900">
                  {user.first_name} {user.last_name}
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  User account details and management
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Profile Information */}
            <div className="lg:col-span-2">
              <div className="bg-white shadow rounded-lg mb-6">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-medium text-gray-900">Profile Information</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    User's personal details and contact information
                  </p>
                </div>
                <div className="px-6 py-4">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Membership Number</dt>
                      <dd className="mt-1">
                        {user.member_id ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-200">
                            #{user.member_id}
                          </span>
                        ) : (
                          <span className="text-gray-400">Not assigned</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Email Address</dt>
                      <dd className="mt-1 text-sm text-gray-900">{user.email}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Account Type</dt>
                      <dd className="mt-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.is_admin 
                            ? 'bg-purple-100 text-purple-800' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {user.is_admin ? 'Administrator' : 'Member'}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">First Name</dt>
                      <dd className="mt-1 text-sm text-gray-900">{user.first_name || 'Not provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Last Name</dt>
                      <dd className="mt-1 text-sm text-gray-900">{user.last_name || 'Not provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Phone Number</dt>
                      <dd className="mt-1 text-sm text-gray-900">{user.phone || 'Not provided'}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Plays Goalie</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {user.is_goalie === true ? 'Yes' : user.is_goalie === false ? 'No' : 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">LGBTQ+ Identity</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {user.is_lgbtq === true ? 'Yes' : user.is_lgbtq === false ? 'No' : user.is_lgbtq === null ? 'Prefer not to answer' : 'Not specified'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Member Tags</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {(() => {
                          const tags = []
                          
                          // Add existing tags from database
                          if (user.tags && user.tags.length > 0) {
                            tags.push(...user.tags)
                          }
                          
                          // Add attribute-based tags
                          if (user.is_goalie === true) {
                            tags.push('Goalie')
                          }
                          
                          if (user.is_lgbtq === true) {
                            tags.push('LGBTQ+')
                          }
                          
                          if (user.is_lgbtq === false) {
                            tags.push('Ally')
                          }
                          
                          if (tags.length > 0) {
                            return (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((tag: string, index: number) => {
                                  // Define colors for specific tags
                                  const getTagColors = (tagName: string) => {
                                    switch (tagName.toLowerCase()) {
                                      case 'goalie':
                                        return 'bg-blue-100 text-blue-800 border border-blue-200'
                                      case 'lgbtq+':
                                        return 'bg-purple-100 text-purple-800 border border-purple-200'
                                      case 'ally':
                                        return 'bg-green-100 text-green-800 border border-green-200'
                                      default:
                                        return 'bg-gray-100 text-gray-800 border border-gray-200'
                                    }
                                  }
                                  
                                  return (
                                    <span
                                      key={index}
                                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getTagColors(tag)}`}
                                    >
                                      {tag}
                                    </span>
                                  )
                                })}
                              </div>
                            )
                          } else {
                            return 'No tags assigned'
                          }
                        })()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Member Since</dt>
                      <dd className="mt-1 text-sm text-gray-900">
                        {user.created_at
                          ? formatDate(user.created_at)
                          : 'Unknown'
                        }
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* User Memberships */}
              <div className="bg-white shadow rounded-lg mb-6">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-medium text-gray-900">Memberships</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    All membership types for this user, including active and expired
                  </p>
                </div>
                <div className="px-6 py-4">
                  {userMemberships && userMemberships.length > 0 ? (
                    <div className="space-y-4">
                      {userMemberships.map((membership) => (
                        <div key={`${membership.user_id}-${membership.membership_id}`} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                          <div>
                            <div className="font-medium text-gray-900">
                              {membership.membership_name}
                            </div>
                            <div className="text-sm text-gray-500">
                              Expires: {formatDate(membership.latest_expiration)}
                            </div>
                            <div className="text-sm text-gray-500">
                              Member since: {formatDate(membership.member_since)}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              membership.is_active 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {membership.is_active ? 'Active' : 'Expired'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-500 text-sm">No memberships found.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Registrations */}
              {userRegistrations && userRegistrations.length > 0 && (
                <div className="bg-white shadow rounded-lg mb-6">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-medium text-gray-900">Active Registrations</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Current event and team registrations
                    </p>
                  </div>
                  <div className="px-6 py-4">
                    <div className="space-y-4">
                      {userRegistrations.map((registration) => (
                        <div key={registration.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                          <div>
                            <div className="font-medium text-gray-900">
                              {registration.registrations?.name || 'Unknown Registration'}
                            </div>
                            <div className="text-sm text-gray-500">
                              {registration.registration_categories?.name || 'No category'}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Registered {registration.registered_at ? formatDate(registration.registered_at) : 'Unknown date'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-green-600">
                              {registration.amount_paid ? formatAmount(registration.amount_paid) : 'Free'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {registration.payment_status}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Invoices Section */}
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="text-lg font-medium text-gray-900">Invoice History</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Payment history and invoice details
                  </p>
                </div>
                <div className="px-6 py-4">
                  {invoices.length > 0 ? (
                    <div className="space-y-4">
                      {invoices.map((invoice) => (
                        <div key={invoice.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                          <div>
                            <div className="font-medium text-gray-900">
                              {invoice.invoice_type === 'ACCRECCREDIT' ? 'Credit Note' : 'Invoice'} {invoice.number.replace(/^#/, '')}
                            </div>
                            <div className="text-sm text-gray-500">
                              {formatDateTime(invoice.date)}
                            </div>
                            <div className="flex items-center space-x-2 mt-1">
                              {invoice.invoice_type === 'ACCRECCREDIT' ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                  Credit Applied
                                </span>
                              ) : (
                                <>
                                  {invoice.isPaymentPlan ? (
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                      invoice.isPaymentPlanFullyPaid
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-purple-100 text-purple-800'
                                    }`}>
                                      {invoice.isPaymentPlanFullyPaid ? 'Paid' : 'Payment Plan'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      Paid
                                    </span>
                                  )}
                                  {invoice.isPartiallyRefunded && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                      Partially Refunded
                                    </span>
                                  )}
                                  {invoice.isFullyRefunded && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                      Fully Refunded
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            {invoice.lineItems.length > 0 && (
                              <div className="text-xs text-gray-400 mt-1">
                                {invoice.lineItems.map((item: any, index: number) => (
                                  <div key={item.id || index} className="truncate">
                                    {item.description}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="text-right">
                              <div className="text-sm font-medium text-gray-900">
                                {formatAmount(invoice.netAmount)}
                                {(invoice.isPartiallyRefunded || invoice.isFullyRefunded) && (
                                  <span className="text-xs text-gray-500 ml-1">Net</span>
                                )}
                              </div>
                              {(invoice.isPartiallyRefunded || invoice.isFullyRefunded) && (
                                <div className="text-xs text-gray-400">
                                  {formatAmount(invoice.originalAmount)} original
                                </div>
                              )}
                              {invoice.isPaymentPlan && !invoice.isPaymentPlanFullyPaid && (
                                <div className="text-xs text-gray-400">
                                  {formatAmount(invoice.paymentPlanAmountPaid)} paid
                                </div>
                              )}
                            </div>
                            <Link
                              href={`/admin/reports/users/${params.id}/invoices/${invoice.paymentId}`}
                              prefetch={false}
                              className="text-xs text-blue-600 hover:text-blue-500"
                            >
                              Details
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
                        <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Invoices Found</h3>
                      <p className="text-gray-600">
                        This user doesn't have any invoices yet.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              {/* Discount Usage */}
              <div className="mb-6">
                <DiscountUsage userId={params.id} />
              </div>

              {/* Quick Stats */}
              <div className="bg-white shadow rounded-lg mb-6">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">Quick Stats</h3>
                </div>
                <div className="px-6 py-4">
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Active Memberships</dt>
                      <dd className="mt-1 text-2xl font-semibold text-blue-600">
                        {userMemberships?.filter(m => m.is_active).length || 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Active Registrations</dt>
                      <dd className="mt-1 text-2xl font-semibold text-purple-600">
                        {userRegistrations?.length || 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm font-medium text-gray-500">Total Invoices</dt>
                      <dd className="mt-1 text-2xl font-semibold text-green-600">
                        {invoices.length}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Account Actions */}
              <AdminToggleSection
                userId={user.id}
                isAdmin={user.is_admin}
                isViewingOwnProfile={isViewingOwnProfile}
                userName={`${user.first_name} ${user.last_name}`}
              />

              {/* Payment Plans */}
              <PaymentPlanSection
                userId={user.id}
                initialPaymentPlanEnabled={user.payment_plan_enabled || false}
                userName={`${user.first_name} ${user.last_name}`}
              />

              {/* Account Status */}
              <div className="bg-white shadow rounded-lg">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">Account Status</h3>
                </div>
                <div className="px-6 py-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-500">Account Type</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.is_admin 
                          ? 'bg-purple-100 text-purple-800' 
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {user.is_admin ? 'Administrator' : 'Member'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-500">Member Since</span>
                      <span className="text-sm text-gray-900">
                        {user.created_at
                          ? formatDate(user.created_at)
                          : 'Unknown'
                        }
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-500">Onboarding</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        user.onboarding_completed_at 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {user.onboarding_completed_at ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
