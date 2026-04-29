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
    // Store the auth code in an httpOnly cookie and redirect to the confirmation page
    // WITHOUT the code in the URL. This prevents the Supabase browser client's
    // detectSessionInUrl from auto-exchanging the code, and prevents Microsoft Defender
    // (and similar link scanners) from consuming the token by visiting the magic link.
    // The token is only exchanged when the real user clicks the button on the confirm page.
    const forwardedHost = request.headers.get('x-forwarded-host')
    const isLocalEnv = process.env.NODE_ENV === 'development'

    let baseUrl = ''
    if (isLocalEnv) {
      baseUrl = origin
    } else if (forwardedHost) {
      baseUrl = `https://${forwardedHost}`
    } else {
      baseUrl = origin
    }

    const confirmUrl = `${baseUrl}/auth/confirm`
    console.log('🔗 Redirecting to confirmation page:', confirmUrl)
    const response = NextResponse.redirect(confirmUrl)
    response.cookies.set('auth_code_pending', code, {
      httpOnly: true,
      secure: !isLocalEnv,
      sameSite: 'lax',
      maxAge: 300, // 5 minutes, matching Supabase token expiry
      path: '/auth/confirm',
    })
    response.cookies.set('auth_next_pending', next, {
      httpOnly: true,
      secure: !isLocalEnv,
      sameSite: 'lax',
      maxAge: 300,
      path: '/auth/confirm',
    })
    return response
  } else {
    console.log('❌ No auth code provided')
  }

  // return the user to an error page with instructions
  const errorUrl = `${origin}/auth/auth-code-error`
  console.log('❌ Auth failed, redirecting to:', errorUrl)
  return NextResponse.redirect(errorUrl)
}