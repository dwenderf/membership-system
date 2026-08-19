import { randomBytes } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'

export const XERO_OAUTH_STATE_COOKIE = 'xero_oauth_state'
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60 // enough time to complete Xero's consent screen

export function generateXeroOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax' as const,
    path: '/api/xero/callback',
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  }
}

export function setXeroOAuthStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(XERO_OAUTH_STATE_COOKIE, state, cookieOptions())
}

export function clearXeroOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(XERO_OAUTH_STATE_COOKIE, '', { ...cookieOptions(), maxAge: 0 })
}

export function readXeroOAuthStateCookie(request: NextRequest): string | undefined {
  return request.cookies.get(XERO_OAUTH_STATE_COOKIE)?.value
}
