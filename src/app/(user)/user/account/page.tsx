'use client'

import { useState, useEffect } from 'react'
import { formatDate } from '@/lib/date-utils'
import { createClient } from '@/lib/supabase/client'
import SignOutButton from '@/components/SignOutButton'
import DeleteAccountSection from '@/components/DeleteAccountSection'
import dynamic from 'next/dynamic'

const PaymentMethodsSection = dynamic(() => import('@/components/PaymentMethodsSection'), { ssr: false })
const UserPaymentPlansSection = dynamic(() => import('@/components/UserPaymentPlansSection'), { ssr: false })

export default function AccountPage() {
  const [user, setUser] = useState<any>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showDeleteAccount, setShowDeleteAccount] = useState(false)
  const [googleOAuth, setGoogleOAuth] = useState<{ email: string; id: string } | null>(null)
  const [hasEmailAuth, setHasEmailAuth] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        return // Layout will handle redirect
      }

      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()

      // Check OAuth and email auth status
      const { data: identitiesData } = await supabase.auth.getUserIdentities()
      const identities = identitiesData?.identities || []

      // Check for Google OAuth
      const googleIdentity = identities.find(id => id.provider === 'google')
      if (googleIdentity) {
        setGoogleOAuth({
          email: googleIdentity.identity_data?.email || '',
          id: googleIdentity.id
        })
      }

      // Check for email auth (magic link/PIN capability)
      const emailIdentity = identities.find(id => id.provider === 'email')
      setHasEmailAuth(!!emailIdentity)

      setUser(user)
      setUserProfile(profile)
      setLoading(false)
    }

    getUser()
  }, [])

  const handleUnlinkGoogle = async () => {
    if (!googleOAuth) return

    setUnlinking(true)
    try {
      const { error } = await supabase.auth.unlinkIdentity({ identity_id: googleOAuth.id })

      if (error) throw error

      // Verify email authentication still exists after unlinking
      const { data: identitiesData } = await supabase.auth.getUserIdentities()
      const identities = identitiesData?.identities || []
      const emailIdentity = identities.find(id => id.provider === 'email')

      if (!emailIdentity) {
        // This shouldn't happen if hasEmailAuth was true, but verify
        alert('Account Lockout Prevented: Unable to unlink Google account because no email authentication method was found. Please contact support.')
        setUnlinking(false)
        setShowUnlinkConfirm(false)
        return
      }

      // Success - update UI
      setGoogleOAuth(null)
      setShowUnlinkConfirm(false)
      alert('Google account unlinked successfully. You can now only sign in using magic links sent to your email.')
    } catch (error) {
      console.error('Error unlinking Google account:', error)
      alert('Failed to unlink Google account. Please try again or contact support.')
    } finally {
      setUnlinking(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user || !userProfile) {
    return null // Layout will handle redirect
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Account Settings</h1>
        <p className="mt-2 text-sm text-gray-600">
          Manage your personal information and account preferences
        </p>
      </div>

      {/* Profile Information */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Profile Information</h2>
            <p className="mt-1 text-sm text-gray-600">
              Your personal details and contact information
            </p>
          </div>
          <a
            href="/user/account/edit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors min-w-[120px] text-center"
          >
            Edit Profile
          </a>
        </div>
        <div className="px-6 py-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-gray-500">Membership Number</dt>
              <dd className="mt-1">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-200">
                  #{userProfile?.member_id || 'Not assigned'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Email Address</dt>
              <dd className="mt-1 text-sm text-gray-900">{userProfile?.email}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Account Type</dt>
              <dd className="mt-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  userProfile?.is_admin 
                    ? 'bg-purple-100 text-purple-800' 
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {userProfile?.is_admin ? 'Administrator' : 'Member'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">First Name</dt>
              <dd className="mt-1 text-sm text-gray-900">{userProfile?.first_name || 'Not provided'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Last Name</dt>
              <dd className="mt-1 text-sm text-gray-900">{userProfile?.last_name || 'Not provided'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Phone Number</dt>
              <dd className="mt-1 text-sm text-gray-900">{userProfile?.phone || 'Not provided'}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Plays Goalie</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {userProfile?.is_goalie === true ? 'Yes' : userProfile?.is_goalie === false ? 'No' : 'Not specified'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">LGBTQ+ Identity</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {userProfile?.is_lgbtq === true ? 'Yes' : userProfile?.is_lgbtq === false ? 'No' : userProfile?.is_lgbtq === null ? 'Prefer not to answer' : 'Not specified'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Member Tags</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {(() => {
                  const tags = []
                  
                  // Add existing tags from database
                  if (userProfile?.tags && userProfile.tags.length > 0) {
                    tags.push(...userProfile.tags)
                  }
                  
                  // Add attribute-based tags
                  if (userProfile?.is_goalie === true) {
                    tags.push('Goalie')
                  }
                  
                  if (userProfile?.is_lgbtq === true) {
                    tags.push('LGBTQ+')
                  }
                  
                  if (userProfile?.is_lgbtq === false) {
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
                {userProfile?.created_at 
                  ? formatDate(new Date(userProfile.created_at))
                  : 'Unknown'
                }
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Payment Methods */}
      <PaymentMethodsSection />

      {/* Payment Plans */}
      <UserPaymentPlansSection />

      {/* Account Actions */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Account Actions</h2>
          <p className="mt-1 text-sm text-gray-600">
            Manage your account settings
          </p>
        </div>
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Sign Out</h3>
              <p className="text-sm text-gray-500">Sign out of your account</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </div>

      {/* Delete Account Section - Only show when triggered */}
      {showDeleteAccount && (
        <DeleteAccountSection user={userProfile} />
      )}

      {/* Security Information */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">
              Account Security
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                Your account is secured with passwordless authentication.
                You sign in using magic links or OAuth providers like Google.
              </p>

              {/* Google OAuth Status */}
              {googleOAuth && hasEmailAuth && (
                <div className="mt-3 pt-3 border-t border-blue-200">
                  <p className="text-sm text-blue-700 mb-2">
                    <strong>Connected Google Account:</strong> {googleOAuth.email}
                  </p>
                  <p className="text-sm text-blue-700">
                    You can{' '}
                    <button
                      onClick={() => setShowUnlinkConfirm(true)}
                      className="text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      unlink your Google account
                    </button>
                    {' '}if you prefer to sign in only with magic links sent to your email.
                  </p>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-blue-200">
                <p className="text-sm text-blue-700">
                  To delete your account and permanently remove all of your personal information,{' '}
                  <button
                    onClick={() => setShowDeleteAccount(true)}
                    className="text-blue-600 hover:text-blue-800 underline font-medium"
                  >
                    click here
                  </button>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Unlink Google Confirmation Modal */}
      {showUnlinkConfirm && googleOAuth && (
        <div
          className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
          tabIndex={-1}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowUnlinkConfirm(false)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowUnlinkConfirm(false)
            }
          }}
        >
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="unlink-modal-title"
            >
              <div className="mt-3 text-center">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100">
                  <svg
                    className="h-6 w-6 text-yellow-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label="Warning"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h3
                  className="text-lg leading-6 font-medium text-gray-900 mt-4"
                  id="unlink-modal-title"
                >
                  Unlink Google Account
                </h3>
                <div className="mt-2 px-7 py-3">
                  <p className="text-sm text-gray-500">
                    Are you sure you want to unlink your Google account ({googleOAuth.email})?
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    After unlinking, you will only be able to sign in using magic links sent to your email address.
                  </p>
                </div>
                <div className="items-center px-4 py-3">
                  <button
                    onClick={handleUnlinkGoogle}
                    disabled={unlinking}
                    className="px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {unlinking ? 'Unlinking...' : 'Yes, Unlink Google Account'}
                  </button>
                  <button
                    onClick={() => setShowUnlinkConfirm(false)}
                    disabled={unlinking}
                    className="mt-3 px-4 py-2 bg-gray-100 text-gray-700 text-base font-medium rounded-md w-full shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}