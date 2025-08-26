'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'
import { getSystemTitle } from '@/lib/organization'
import Link from 'next/link'

export default function VerifyOTPPage() {
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const { showSuccess, showError } = useToast()
  
  // Refs for OTP inputs
  const otpInputs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    // Get email from sessionStorage
    const storedEmail = sessionStorage.getItem('otp_email')
    if (storedEmail) {
      setEmail(storedEmail)
    } else {
      // Redirect back to login if no email stored
      router.push('/auth/login')
    }
    
    // Focus first input on mount
    if (otpInputs.current[0]) {
      otpInputs.current[0].focus()
    }
  }, [router])

  // Handle OTP input changes
  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste - split the pasted value across inputs
      const pastedValue = value.slice(0, 6)
      const newOtp = [...otp]
      for (let i = 0; i < pastedValue.length && i + index < 6; i++) {
        newOtp[index + i] = pastedValue[i]
      }
      setOtp(newOtp)
      
      // Focus the next empty input or last input
      const nextIndex = Math.min(index + pastedValue.length, 5)
      if (otpInputs.current[nextIndex]) {
        otpInputs.current[nextIndex].focus()
      }
      return
    }

    // Single character input
    if (!/^\d*$/.test(value)) return // Only allow digits
    
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)

    // Move to next input if value entered
    if (value && index < 5) {
      otpInputs.current[index + 1]?.focus()
    }
  }

  // Handle backspace
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        // If current input is empty, move to previous input
        otpInputs.current[index - 1]?.focus()
      } else {
        // Clear current input
        const newOtp = [...otp]
        newOtp[index] = ''
        setOtp(newOtp)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const otpCode = otp.join('')
    if (otpCode.length !== 6) {
      setMessage('Please enter all 6 digits')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'email'
      })

      if (error) {
        setMessage(error.message)
        showError('Verification failed', error.message)
      } else {
        showSuccess('Success!', 'You have been logged in')
        // Clear stored email
        sessionStorage.removeItem('otp_email')
        // Redirect to dashboard or intended page
        router.push('/user')
      }
    } catch (error: any) {
      console.error('OTP verification error:', error)
      const errorMessage = error?.message || 'An error occurred. Please try again.'
      setMessage(errorMessage)
      showError('Verification failed', errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    setResendLoading(true)
    setMessage('')

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {} // Empty options = OTP code
      })

      if (error) {
        setMessage(error.message)
        showError('Resend failed', error.message)
      } else {
        setMessage('New code sent to your email!')
        showSuccess('Code sent!', 'Check your email for the new 6-digit code')
        // Clear current OTP inputs
        setOtp(['', '', '', '', '', ''])
        // Focus first input
        otpInputs.current[0]?.focus()
      }
    } catch (error: any) {
      console.error('Resend error:', error)
      const errorMessage = error?.message || 'An error occurred. Please try again.'
      setMessage(errorMessage)
      showError('Resend failed', errorMessage)
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Enter your verification code
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {getSystemTitle()}
          </p>
          <p className="mt-2 text-center text-sm text-gray-500">
            We sent a 6-digit code to <span className="font-medium text-gray-900">{email}</span>
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          {message && (
            <div className={`p-3 rounded-md ${
              message.includes('sent') || message.includes('Success')
                ? 'bg-green-50 text-green-800' 
                : 'bg-red-50 text-red-800'
            }`}>
              {message}
            </div>
          )}
          
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700 text-center mb-4">
                Enter 6-digit code
              </label>
              <div className="flex justify-center space-x-2">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      otpInputs.current[index] = el
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6} // Allow paste of full code
                    className="w-12 h-12 text-center text-lg font-semibold border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 text-center mt-2">
                You can paste the entire code into any field
              </p>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || otp.join('').length !== 6}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
            </div>
          </form>

          <div className="flex flex-col space-y-3">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendLoading}
              className="text-center text-sm text-blue-600 hover:text-blue-500 disabled:opacity-50"
            >
              {resendLoading ? 'Sending...' : "Didn't receive the code? Send again"}
            </button>
            
            <Link
              href="/auth/login"
              className="text-center text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}