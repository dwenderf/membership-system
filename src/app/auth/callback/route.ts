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
    // Redirect to a confirmation page rather than exchanging the code immediately.
    // This prevents Microsoft Defender (and similar link-scanning tools) from consuming
    // the auth token by auto-visiting the magic link URL, which would invalidate the
    // OTP as well. The token is only exchanged when the real user clicks the button.
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

    const confirmUrl = new URL(`${baseUrl}/auth/confirm`)
    confirmUrl.searchParams.set('code', code)
    confirmUrl.searchParams.set('next', next)
    console.log('🔗 Redirecting to confirmation page:', confirmUrl.toString())
    return NextResponse.redirect(confirmUrl.toString())
  } else {
    console.log('❌ No auth code provided')
  }

  // return the user to an error page with instructions
  const errorUrl = `${origin}/auth/auth-code-error`
  console.log('❌ Auth failed, redirecting to:', errorUrl)
  return NextResponse.redirect(errorUrl)
}