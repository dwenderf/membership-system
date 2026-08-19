import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logging/logger'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

type Role = 'member' | 'admin'

function notFound() {
  return NextResponse.json({}, { status: 404 })
}

function timingSafeMatch(provided: string, expected: string): boolean {
  const providedHash = crypto.createHash('sha256').update(provided).digest()
  const expectedHash = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(providedHash, expectedHash)
}

function credentialsForRole(role: Role): { email: string; password: string; defaultNext: string } | null {
  if (role === 'member') {
    const email = process.env.PREVIEW_TEST_USER_EMAIL
    const password = process.env.PREVIEW_TEST_USER_PASSWORD
    if (!email || !password) return null
    return { email, password, defaultNext: '/dashboard' }
  }

  if (role === 'admin') {
    const email = process.env.PREVIEW_TEST_ADMIN_EMAIL
    const password = process.env.PREVIEW_TEST_ADMIN_PASSWORD
    if (!email || !password) return null
    return { email, password, defaultNext: '/admin' }
  }

  return null
}

export async function GET(request: Request) {
  // Only ever active on Vercel preview deployments - never production.
  if (process.env.VERCEL_ENV !== 'preview') {
    return notFound()
  }

  const expectedSecret = process.env.PREVIEW_AUTH_SECRET
  if (!expectedSecret) {
    return notFound()
  }

  const { searchParams, origin } = new URL(request.url)
  const providedSecret = searchParams.get('secret')
  if (!providedSecret || !timingSafeMatch(providedSecret, expectedSecret)) {
    logger.warn('system', 'preview-auth-bypass', 'Rejected: missing or invalid secret')
    return notFound()
  }

  const role = searchParams.get('role')
  const credentials = role === 'member' || role === 'admin' ? credentialsForRole(role) : null
  if (!credentials) {
    logger.warn('system', 'preview-auth-bypass', 'Rejected: missing or unconfigured role', { role })
    return notFound()
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  })

  if (error || !data.session) {
    logger.error('system', 'preview-auth-bypass', 'Sign-in failed for preview test user', {
      role,
      errorMessage: error?.message,
    })
    return notFound()
  }

  logger.info('system', 'preview-auth-bypass', 'Preview test session established', { role }, data.user?.id)

  const next = searchParams.get('next') ?? credentials.defaultNext
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

  return NextResponse.redirect(redirectUrl)
}
