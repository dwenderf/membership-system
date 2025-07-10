import { createClient } from '@/lib/supabase/server'
import SignOutButton from '@/components/SignOutButton'
import DeleteAccountSection from '@/components/DeleteAccountSection'

export default async function AccountPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null // Layout will handle redirect
  }

  const { data: userProfile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

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
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Profile Information</h2>
          <p className="mt-1 text-sm text-gray-600">
            Your personal details and contact information
          </p>
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
              <dt className="text-sm font-medium text-gray-500">Member Tags</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {userProfile?.tags && userProfile.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {userProfile.tags.map((tag: string, index: number) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  'No tags assigned'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Member Since</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {userProfile?.created_at 
                  ? new Date(userProfile.created_at).toLocaleDateString()
                  : 'Unknown'
                }
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Account Actions */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Account Actions</h2>
          <p className="mt-1 text-sm text-gray-600">
            Manage your account settings and preferences
          </p>
        </div>
        <div className="px-6 py-4">
          <div className="space-y-4">
            {/* Edit Profile - Coming Soon */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-900">Edit Profile</h3>
                <p className="text-sm text-gray-500">Update your personal information</p>
              </div>
              <button
                disabled
                className="bg-gray-300 text-gray-500 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>

            {/* Email Preferences - Coming Soon */}
            <div className="flex items-center justify-between border-t pt-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900">Email Preferences</h3>
                <p className="text-sm text-gray-500">Manage your notification settings</p>
              </div>
              <button
                disabled
                className="bg-gray-300 text-gray-500 px-4 py-2 rounded-md text-sm font-medium cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>

            {/* Sign Out */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">Sign Out</h3>
                  <p className="text-sm text-gray-500">Sign out of your account</p>
                </div>
                <SignOutButton />
              </div>
            </div>

            {/* Delete Account */}
            <DeleteAccountSection user={userProfile} />
          </div>
        </div>
      </div>

      {/* Security Information */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              Account Security
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                Your account is secured with passwordless authentication. 
                You sign in using magic links or OAuth providers like Google.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}