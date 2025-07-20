import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getOrganizationName } from '@/lib/organization'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          {getOrganizationName('long')}
        </h1>
        <p className="mt-2 text-center text-lg text-gray-600">
          Membership System
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="space-y-6">
            <div>
              <h2 className="text-center text-xl font-medium text-gray-900">
                Welcome
              </h2>
              <p className="mt-2 text-center text-sm text-gray-600">
                Manage your hockey memberships and team registrations
              </p>
            </div>

            <div>
              <Link
                href="/auth/login"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Sign In
              </Link>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-500">
                New to our system? Sign in to create your account.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
