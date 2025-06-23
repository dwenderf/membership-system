'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Footer() {
  const currentYear = new Date().getFullYear()
  const pathname = usePathname()
  
  // Show "Back to Dashboard" link only on legal pages
  const showBackToDashboard = ['/terms', '/privacy-policy', '/code-of-conduct'].includes(pathname)

  return (
    <footer className="bg-white border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          {/* Copyright */}
          <div className="text-sm text-gray-500">
            © {currentYear} Hockey Association. All rights reserved.
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