import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logging/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  logger.logSystem(
    'auth-callback-received',
    'Auth callback received',
    {
      origin,
      next,
      code: code ? 'present' : 'missing',
      forwardedHost: request.headers.get('x-forwarded-host'),
      host: request.headers.get('host'),
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_URL: process.env.VERCEL_URL
    },
    'debug'
  )

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    const user = data?.user

    if (!error && user) {
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'

      let redirectUrl = ''
      if (isLocalEnv) {
        redirectUrl = `${origin}${next}`
      } else if (forwardedHost) {
        redirectUrl = `https://${forwardedHost}${next}`
      } else {
        redirectUrl = `${origin}${next}`
      }

      logger.logSystem('auth-callback-success', 'Auth success, redirecting', { redirectUrl })
      return NextResponse.redirect(redirectUrl)
    } else {
      logger.logSystem(
        'auth-callback-exchange-failed',
        'Auth callback: failed to exchange code for session',
        { error: error?.message },
        'error'
      )
    }
  } else {
    logger.logSystem(
      'auth-callback-no-code',
      'Auth callback: no auth code provided',
      undefined,
      'warn'
    )
  }

  const errorUrl = `${origin}/auth/auth-code-error`
  return NextResponse.redirect(errorUrl)
}
