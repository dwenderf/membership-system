'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCopyrightText, getOrganizationContact, getOrganizationBranding, getOrganizationName } from '@/lib/organization'

export default function Footer() {
  const pathname = usePathname()
  const [canAccessDashboard, setCanAccessDashboard] = useState(false)
  const contact = getOrganizationContact()
  const branding = getOrganizationBranding()

  // Check if user can access dashboard (authenticated + onboarding complete)
  useEffect(() => {
    const checkUserAccess = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setCanAccessDashboard(false)
        return
      }

      const { data: userProfile } = await supabase
        .from('users')
        .select('onboarding_completed_at')
        .eq('id', user.id)
        .single()

      // User can access dashboard if they exist and have completed onboarding
      setCanAccessDashboard(!!userProfile?.onboarding_completed_at)
    }

    checkUserAccess()
  }, [pathname])

  // Show "Back to Dashboard" link only on legal pages AND if user can access dashboard
  const isOnLegalPage = ['/terms', '/privacy-policy', '/code-of-conduct'].includes(pathname)
  const showBackToDashboard = isOnLegalPage && canAccessDashboard

  return (
    <footer className="bg-white border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:justify-between gap-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 flex-1">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Useful Links</h3>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://nycpha.org/code-of-conduct/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Code of Conduct
                  </a>
                </li>
                <li>
                  <a
                    href="https://nycpha.org/concussion-information/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Concussion Policy
                  </a>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Terms & Conditions
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy-policy"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Social Media</h3>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://www.facebook.com/nycpha/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Facebook
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.instagram.com/nycpha/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Instagram
                  </a>
                </li>
                <li>
                  <a
                    href="https://linktr.ee/nycgha"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
                  >
                    Linktree
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Contact Us</h3>
              <p className="text-sm text-gray-500">
                {contact.address.line1}
                <br />
                {contact.address.line2}
              </p>
              <a
                href={`mailto:${contact.email}`}
                className="text-sm text-gray-500 hover:text-gray-700 underline transition-colors duration-200"
              >
                {contact.email}
              </a>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end lg:flex-shrink-0">
            <Image
              src={branding.logo.crest}
              alt={`${getOrganizationName('short')} crest`}
              width={140}
              height={181}
              className="h-32 w-auto lg:h-40"
            />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          <div className="text-sm text-gray-500">
            {getCopyrightText()}
          </div>

          {showBackToDashboard && (
            <Link
              href="/user"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors duration-200"
            >
              ← Back to Dashboard
            </Link>
          )}
        </div>
      </div>
    </footer>
  )
}
