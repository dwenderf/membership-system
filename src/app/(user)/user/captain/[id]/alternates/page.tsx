import { createClient } from '@/lib/supabase/server'
import { checkCaptainAccess } from '@/lib/utils/alternates-access'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import RegistrationAlternatesSection from '@/components/RegistrationAlternatesSection'

interface CaptainAlternatesPageProps {
  params: {
    id: string
  }
}

export default async function CaptainAlternatesPage({ params }: CaptainAlternatesPageProps) {
  const registrationId = params.id

  // Check if user has captain access to this registration
  const access = await checkCaptainAccess(registrationId)

  if (!access.hasAccess) {
    redirect('/user/captain')
  }

  const supabase = await createClient()

  // Fetch the registration details
  const { data: registration, error } = await supabase
    .from('registrations')
    .select(`
      id,
      name,
      type,
      allow_alternates,
      alternate_price,
      alternate_accounting_code,
      is_active,
      seasons (
        id,
        name,
        end_date
      )
    `)
    .eq('id', registrationId)
    .single()

  if (error || !registration) {
    console.error('Error fetching registration:', error)
    notFound()
  }

  // Check if alternates are enabled for this registration
  if (!registration.allow_alternates) {
    redirect(`/user/captain/${registrationId}/roster`)
  }

  // Create userAccess object for the component
  const userAccess = {
    hasAccess: true,
    isAdmin: access.isAdmin,
    isCaptain: access.isCaptain,
    accessibleRegistrations: [registrationId]
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Manage Alternates</h1>
            <p className="mt-2 text-sm text-gray-600">
              Select alternates for upcoming games
            </p>
          </div>

          {/* Main Content */}
          <RegistrationAlternatesSection
            registration={registration}
            userAccess={userAccess}
          />

          {/* Navigation */}
          <div className="mt-6 flex gap-4">
            <Link
              href={`/user/captain/${registrationId}/roster`}
              className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
            >
              ← View Roster
            </Link>
            <Link
              href="/user/captain"
              className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
            >
              ← Back to My Teams
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
