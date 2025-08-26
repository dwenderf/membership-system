'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { getSystemTitle } from '@/lib/organization'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [authMethod, setAuthMethod] = useState<'magic' | 'otp'>('magic')
  const [showMagicLinkWarning, setShowMagicLinkWarning] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const { showSuccess, showError } = useToast()

  // Email validation function
  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email.trim())
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Set loading state immediately
    setLoading(true)
    setMessage('')

    try {
      // Always send the same email (with both OTP and magic link)
      // The user's choice only affects the UI flow, not the email content
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }
      })

      if (error) {
        setMessage(error.message)
        showError('Login failed', error.message)
        setShowMagicLinkWarning(false) // Hide warning on error
      } else {
        const successMessage = authMethod === 'magic'
          ? 'Check your email for the login link!'
          : 'Check your email for your 6-digit code!'
          
        setMessage(successMessage)
        showSuccess('Email sent!', successMessage)
        
        // Always redirect to verification page, but store the user's preferred method
        sessionStorage.setItem('otp_email', email)
        sessionStorage.setItem('auth_method_preference', authMethod)
        router.push('/auth/verify-otp')
      }
    } catch (error: any) {
      console.error('Login error:', error)
      
      // Handle different types of network errors
      let errorMessage = 'An error occurred. Please try again.'
      
      if (error?.message) {
        if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else {
          errorMessage = error.message
        }
      }
      
      setMessage(errorMessage)
      showError('Login failed', errorMessage)
    } finally {
      // Always reset loading state
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    // Set loading state immediately
    setLoading(true)
    setMessage('')
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setMessage(error.message)
        showError('Login failed', error.message)
        setLoading(false) // Only reset on error
      }
      // Note: On success, user will be redirected to Google, so don't reset loading
    } catch (error: any) {
      console.error('Google login error:', error)
      
      // Handle different types of network errors
      let errorMessage = 'An error occurred. Please try again.'
      
      if (error?.message) {
        if (error.message.includes('Failed to fetch') || error.message.includes('network')) {
          errorMessage = 'Network error. Please check your connection and try again.'
        } else {
          errorMessage = error.message
        }
      }
      
      setMessage(errorMessage)
      showError('Login failed', errorMessage)
      setLoading(false) // Only reset on error
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center mb-6">
            <img 
              src="/images/NYCPHA_Wordmark_Horizontal_Black_Tide.png" 
              alt="NYC PHA" 
              className="h-12 w-auto"
            />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        
        <div className="mt-8 space-y-6">
          {message && (
            <div className={`p-3 rounded-md ${
              message.includes('Check your email') 
                ? 'bg-green-50 text-green-800' 
                : 'bg-red-50 text-red-800'
            }`}>
              {message}
            </div>
          )}
          
          {/* Magic link warning - only shows after successful magic link send */}
          {showMagicLinkWarning && (
            <div className="p-3 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium">Important:</h3>
                  <div className="mt-1 text-sm">
                    Magic links must be opened in the same browser where you requested them. If you have issues, try the 6-digit code option instead.
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Auth method toggle */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-3 block">
              Choose your login method:
            </label>
            <div className="flex rounded-md shadow-sm" role="group">
              <button 
                type="button"
                onClick={() => setAuthMethod('magic')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-l-lg border transition-colors ${
                  authMethod === 'magic' 
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' 
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span>Magic Link</span>
                </div>
                <div className="text-xs mt-1 opacity-75">Click link in email</div>
              </button>
              <button
                type="button" 
                onClick={() => setAuthMethod('otp')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-r-lg border-t border-r border-b transition-colors ${
                  authMethod === 'otp'
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <span>6-Digit Code</span>
                </div>
                <div className="text-xs mt-1 opacity-75">Enter code from email</div>
              </button>
            </div>
          </div>
          
          <form className="space-y-4" onSubmit={handleEmailAuth}>
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || !isValidEmail(email)}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading 
                  ? 'Sending...' 
                  : authMethod === 'magic' 
                    ? 'Send Magic Link' 
                    : 'Send 6-Digit Code'
                }
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-6">
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  'Connecting...'
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <span className="ml-2">Sign in with Google</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}