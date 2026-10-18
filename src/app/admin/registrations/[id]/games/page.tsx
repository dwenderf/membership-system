import { createClient } from '@/lib/supabase/server'
import { checkAlternatesAccess } from '@/lib/utils/alternates-access'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import RegistrationAlternatesSection from '@/components/RegistrationAlternatesSection'
import { logger } from '@/lib/logging/logger'

interface RegistrationGamesPageProps {
  params: Promise<{
    id: string
  }>
}

export default async function RegistrationGamesPage({ params }: RegistrationGamesPageProps) {
  const { id: registrationId } = await params

  const access = await checkAlternatesAccess()

  if (!access.isAdmin) {
    redirect('/admin')
  }

  const supabase = await createClient()

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
    .overrideTypes<{
      id: string
      name: string
      type: string
      allow_alternates: boolean
      alternate_price: number | null
      alternate_accounting_code: string | null
      is_active: boolean
      seasons: { id: string; name: string; end_date: string } | null
    }, { merge: false }>()

  if (error || !registration) {
    logger.logSystem(
      'admin-registration-games-fetch-registration-failed',
      'Error fetching registration',
      { registrationId, error: error?.message },
      'error'
    )
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-2">
            <Link
              href={`/admin/registrations/${registrationId}`}
              className="text-blue-600 hover:text-blue-500 text-sm font-medium"
            >
              ← Back to Registration
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Games & Alternate Selection
          </h1>
          <p className="text-gray-600 mt-1">
            Registration: <span className="font-medium">{registration.name}</span>
          </p>

          {!registration.allow_alternates && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-800">
                This registration does not allow alternates. Enable alternates in the registration settings to create games.
              </p>
            </div>
          )}
        </div>

        {registration.allow_alternates && (
          <RegistrationAlternatesSection
            registration={registration}
            userAccess={{
              hasAccess: true,
              isAdmin: true,
              isCaptain: access.isCaptain,
            }}
          />
        )}

        {/* Navigation - Bottom */}
        <div className="mt-6">
          <Link
            href={`/admin/registrations/${registrationId}`}
            className="text-blue-600 hover:text-blue-500 text-sm font-medium"
          >
            ← Back to Registration
          </Link>
        </div>
      </div>
    </div>
  )
}
