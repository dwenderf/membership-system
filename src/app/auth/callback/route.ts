import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  // Debug logging
  console.log('🔍 Auth callback debug:', {
    origin,
    next,
    code: code ? 'present' : 'missing',
    forwardedHost: request.headers.get('x-forwarded-host'),
    host: request.headers.get('host'),
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_URL: process.env.VERCEL_URL
  })

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    const user = data?.user
    
    if (!error && user) {
      // Note: We no longer auto-create user records here.
      // The onboarding page will handle user record creation after collecting required info.

      const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
      const isLocalEnv = process.env.NODE_ENV === 'development'
      
      let redirectUrl = ''
      
      if (isLocalEnv) {
        // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
        redirectUrl = `${origin}${next}`
      } else if (forwardedHost) {
        redirectUrl = `https://${forwardedHost}${next}`
      } else {
        redirectUrl = `${origin}${next}`
      }
      
      console.log('✅ Auth success, redirecting to:', redirectUrl)
      return NextResponse.redirect(redirectUrl)
    } else {
      console.log('❌ Auth error:', error)
    }
  } else {
    console.log('❌ No auth code provided')
  }

  // return the user to an error page with instructions
  const errorUrl = `${origin}/auth/auth-code-error`
  console.log('❌ Auth failed, redirecting to:', errorUrl)
  return NextResponse.redirect(errorUrl)
}