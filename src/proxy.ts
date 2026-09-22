import { createServerClient, type SetAllCookies } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isRefreshTokenAlreadyUsedError,
  REFRESH_RETRY_GUARD_COOKIE,
  REFRESH_RETRY_GUARD_MAX_AGE_SECONDS,
} from '@/lib/supabase/refresh-token-race'

export async function proxy(request: NextRequest) {
  // Handle CORS preflight requests early
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // This will refresh session if expired - required for Server Components
  const { data: { user }, error } = await supabase.auth.getUser()

  // A refresh-token rotation race (see refresh-token-race.ts) isn't a real
  // logout: give this navigation one soft retry against the browser's
  // current cookies before treating it as unauthenticated.
  if (error && isRefreshTokenAlreadyUsedError(error)) {
    const alreadyRetried = request.cookies.get(REFRESH_RETRY_GUARD_COOKIE)

    if (!alreadyRetried) {
      const retryResponse = NextResponse.redirect(request.url)
      retryResponse.cookies.set(REFRESH_RETRY_GUARD_COOKIE, '1', {
        maxAge: REFRESH_RETRY_GUARD_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
      return retryResponse
    }

    // Retried once and still racing - fall through as unauthenticated
    // (matches today's behavior) and clear the guard so it doesn't linger.
    response.cookies.set(REFRESH_RETRY_GUARD_COOKIE, '', { maxAge: 0, path: '/' })
  } else if (request.cookies.get(REFRESH_RETRY_GUARD_COOKIE)) {
    // Succeeded (on retry or otherwise) - clear a leftover guard cookie.
    response.cookies.set(REFRESH_RETRY_GUARD_COOKIE, '', { maxAge: 0, path: '/' })
  }

  // Pages that don't require onboarding (whitelist approach for security)
  const allowedWithoutOnboarding = [
    '/auth/login',
    '/auth/callback',
    '/onboarding',
    '/', // home page
  ]

  // `startsWith` is deliberate for '/auth/login' etc. (so nested paths are covered too),
  // but '/' must match exactly - `startsWith('/')` is true for every path and would
  // disable this whole check.
  const isAllowedWithoutOnboarding = allowedWithoutOnboarding.some(path =>
    path === '/' ? request.nextUrl.pathname === '/' : request.nextUrl.pathname.startsWith(path)
  )

  // Check onboarding/deletion status for all authenticated users except whitelisted pages
  if (user && !isAllowedWithoutOnboarding) {
    const { data: userProfile } = await supabase
      .from('users')
      .select('onboarding_completed_at, deleted_at')
      .eq('id', user.id)
      .single()

    // Defense in depth: public.users.deleted_at is set only once the linked
    // auth.users record has already been deleted (see src/app/api/delete-account/route.ts),
    // so a live session should never see it set here. If one ever does - stale
    // auth data, a bug, manual DB edits - force it out rather than trusting the
    // session. See issue #295.
    if (userProfile?.deleted_at) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // If user doesn't exist in our users table OR hasn't completed onboarding, redirect to onboarding
    if (!userProfile || !userProfile.onboarding_completed_at) {
      return NextResponse.redirect(new URL('/onboarding', request.url))
    }
  }

  // Protect admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
    
    // Check if user is admin
    const { data: userProfile } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    
    if (!userProfile?.is_admin) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  // Protect dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!user) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}