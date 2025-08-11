import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import AdminHeader from '@/components/AdminHeader'
import { formatAmount } from '@/lib/format-utils'
import { Logger } from '@/lib/logging/logger'
import AdminToggleSection from './AdminToggleSection'

interface PageProps {
  params: {
    id: string
  }
}

export default async function UserDetailPage({ params }: PageProps) {
  const supabase = await createClient()
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

  // Fetch user's active memberships
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      memberships (
        name,
        description
      )
    `)
    .eq('user_id', params.id)
    .gte('valid_until', new Date().toISOString().split('T')[0]) // Only active memberships
    .order('valid_until', { ascending: true })

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
  
  // Fetch payments with related Xero invoice data
  const { data: userPayments } = await supabase
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
        xero_invoice_line_items (
          id,
          description,
          line_amount,
          account_code
        )
      )
    `)
    .eq('user_id', params.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })

  // Transform payments into invoice-like objects for display
  invoices = userPayments?.map(payment => ({
    id: payment.id,
    paymentId: payment.id,
    number: payment.xero_invoices?.[0]?.invoice_number || `PAY-${payment.id.slice(0, 8)}`,
    date: payment.completed_at || payment.created_at,
    total: payment.final_amount,
    status: payment.status === 'refunded' ? 'Refunded' : 'Paid',
    hasXeroInvoice: !!payment.xero_invoices?.[0],
    xeroInvoiceId: payment.xero_invoices?.[0]?.id,
    canRefund: payment.status === 'completed' && payment.final_amount > 0
  })) || []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div>
                <Link 
                  href="/admin/reports/users"
                  className="text-blue-600 hover:text-blue-500 text-sm font-medium mb-4 inline-block"
                >
                  ← Back to Users
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
                          ? new Date(user.created_at).toLocaleDateString()
                          : 'Unknown'
                        }
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

              {/* Active Memberships */}
              {userMemberships && userMemberships.length > 0 && (
                <div className="bg-white shadow rounded-lg mb-6">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-medium text-gray-900">Active Memberships</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Current and future membership subscriptions
                    </p>
                  </div>
                  <div className="px-6 py-4">
                    <div className="space-y-4">
                      {userMemberships.map((membership) => (
                        <div key={membership.id} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-b-0">
                          <div>
                            <div className="font-medium text-gray-900">
                              {membership.memberships?.name || 'Unknown Membership'}
                            </div>
                            <div className="text-sm text-gray-500">
                              Valid until {new Date(membership.valid_until).toLocaleDateString()}
                            </div>
                            {membership.memberships?.description && (
                              <div className="text-xs text-gray-400 mt-1">
                                {membership.memberships.description}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium text-green-600">
                              {membership.amount_paid ? formatAmount(membership.amount_paid) : 'Free'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {membership.payment_status}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                              Registered {registration.registered_at ? new Date(registration.registered_at).toLocaleDateString() : 'Unknown date'}
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
                              Invoice #{invoice.number}
                            </div>
                            <div className="text-sm text-gray-500">
                              {new Date(invoice.date).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="text-right">
                              <div className="text-sm font-medium text-gray-900">
                                {formatAmount(invoice.total)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {invoice.status}
                              </div>
                            </div>
                            {invoice.canRefund && (
                              <Link
                                href={`/admin/reports/users/${params.id}/invoices/${invoice.paymentId}`}
                                prefetch={false}
                                className="inline-flex items-center px-3 py-1 border border-transparent text-xs font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                              >
                                Manage
                              </Link>
                            )}
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
                        {userMemberships?.length || 0}
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
                          ? new Date(user.created_at).toLocaleDateString()
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
