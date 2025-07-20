'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCopyrightText } from '@/lib/organization'

export default function Footer() {
  const currentYear = new Date().getFullYear()
  const pathname = usePathname()
  const [canAccessDashboard, setCanAccessDashboard] = useState(false)
  
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
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          {/* Copyright */}
          <div className="text-sm text-gray-500">
            {getCopyrightText()}
          </div>

          {/* Navigation and Legal Links */}
          <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-6">
            {showBackToDashboard && (
              <>
                <Link 
                  href="/user" 
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors duration-200"
                >
                  ← Back to Dashboard
                </Link>
                <div className="hidden sm:block w-px h-4 bg-gray-300"></div>
              </>
            )}
            <div className="flex space-x-4 sm:space-x-6">
              <Link 
                href="/terms" 
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
              >
                Terms & Conditions
              </Link>
              <Link 
                href="/privacy-policy" 
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
              >
                Privacy Policy
              </Link>
              <Link 
                href="/code-of-conduct" 
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors duration-200"
              >
                Code of Conduct
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}