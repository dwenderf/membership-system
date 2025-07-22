'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

export default function SignOutButton() {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { showSuccess, showError } = useToast()

  const handleSignOut = async () => {
    setIsSigningOut(true)

    try {
      const { error } = await supabase.auth.signOut()
      
      if (error) {
        showError('Sign out failed', error.message)
        setIsSigningOut(false)
      } else {
        showSuccess('Signed out successfully', 'You have been signed out of your account')
        router.push('/auth/login')
      }
    } catch (error: any) {
      console.error('Sign out error:', error)
      showError('Sign out failed', 'An error occurred while signing out')
      setIsSigningOut(false)
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px] text-center"
    >
      {isSigningOut ? 'Signing Out...' : 'Sign Out'}
    </button>
  )
}