import { createClient } from '@/lib/supabase/server'
import MembershipPurchase from '@/components/MembershipPurchase'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMembershipStatus } from '@/lib/membership-status'

interface PageProps {
  params: {
    id: string
  }
  searchParams: {
    from?: string
  }
}

export default async function MembershipDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return null // Layout will handle redirect
  }

  // Await params for Next.js 15 compatibility
  const { id } = await params
  const { from } = await searchParams

  // Get the specific membership
  const { data: membership, error } = await supabase
    .from('memberships')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !membership) {
    notFound()
  }

  // Get user's memberships for status display and purchase component
  const { data: userMemberships } = await supabase
    .from('user_memberships')
    .select(`
      *,
      membership:memberships(*)
    `)
    .eq('user_id', user.id)
    .order('valid_until', { ascending: false })

  const membershipStatus = getMembershipStatus(membership.id, userMemberships || [])

  // Parse the from param to determine breadcrumb behavior
  // Expected format: /user/browse-registrations/[registrationId]
  const isFromRegistration = from?.startsWith('/user/browse-registrations/')
  let registrationName: string | null = null

  if (isFromRegistration && from) {
    // Fetch registration name for better breadcrumb display
    const registrationId = from.split('/').pop()
    if (registrationId) {
      const { data: registration } = await supabase
        .from('registrations')
        .select('name')
        .eq('id', registrationId)
        .single()
      registrationName = registration?.name || null
    }
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      {/* Breadcrumb navigation */}
      <div className="mb-8">
        <nav className="flex items-center space-x-2 text-sm mb-4">
          <Link
            href="/user"
            className="text-blue-600 hover:text-blue-800"
          >
            Dashboard
          </Link>
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
          {isFromRegistration && from ? (
            <>
              <Link
                href="/user/browse-registrations"
                className="text-blue-600 hover:text-blue-800"
              >
                Browse Registrations
              </Link>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
              <Link
                href={from}
                className="text-blue-600 hover:text-blue-800 truncate max-w-[150px]"
              >
                {registrationName || 'Registration'}
              </Link>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </>
          ) : (
            <>
              <Link
                href="/user/browse-memberships"
                className="text-blue-600 hover:text-blue-800"
              >
                Browse Memberships
              </Link>
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
          <span className="text-gray-500 truncate max-w-[200px]">{membership.name}</span>
        </nav>
      </div>

      {/* Membership Card */}
      <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 max-w-2xl">
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h1 className="text-xl font-semibold text-gray-900">
                  {membership.name}
                </h1>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${membershipStatus.className}`}>
                  {membershipStatus.label}
                </span>
              </div>
              {membership.description && (
                <p className="mt-2 text-sm text-gray-600">
                  {membership.description}
                </p>
              )}
            </div>
          </div>

          {/* Pricing Display */}
          <div className="mt-4 border-t border-gray-200 pt-4">
            {membership.allow_monthly ? (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Monthly:</span>
                  <span className="font-medium text-gray-900">
                    ${(membership.price_monthly / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-gray-500">Annual:</span>
                  <div className="text-right">
                    <span className="font-medium text-gray-900">
                      ${(membership.price_annual / 100).toFixed(2)}
                    </span>
                    {membership.allow_monthly && membership.price_annual < membership.price_monthly * 12 && (
                      <div className="text-xs text-green-600">
                        Save ${((membership.price_monthly * 12 - membership.price_annual) / 100).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Annual Only:</span>
                <span className="font-medium text-gray-900">
                  ${(membership.price_annual / 100).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {/* Purchase Component */}
          <div className="mt-6">
            <MembershipPurchase
              membership={membership}
              userEmail={user.email || ''}
              userMemberships={userMemberships || []}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
