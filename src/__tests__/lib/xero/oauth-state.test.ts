/**
 * Unit tests for src/lib/xero/oauth-state.ts CSRF state cookie helpers
 */

jest.mock('next/server', () => jest.requireActual('../../../test-helpers/mock-next-server'))

import { NextRequest, NextResponse } from 'next/server'
import {
  XERO_OAUTH_STATE_COOKIE,
  generateXeroOAuthState,
  setXeroOAuthStateCookie,
  clearXeroOAuthStateCookie,
  readXeroOAuthStateCookie
} from '@/lib/xero/oauth-state'

describe('generateXeroOAuthState', () => {
  it('generates a sufficiently long, url-safe token', () => {
    const state = generateXeroOAuthState()
    expect(state.length).toBeGreaterThanOrEqual(32)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generates unique tokens on each call', () => {
    const a = generateXeroOAuthState()
    const b = generateXeroOAuthState()
    expect(a).not.toBe(b)
  })
})

describe('setXeroOAuthStateCookie / readXeroOAuthStateCookie', () => {
  it('round-trips the state value through a response and request cookie', () => {
    const state = generateXeroOAuthState()
    const response = NextResponse.json({ ok: true })
    setXeroOAuthStateCookie(response, state)

    const setCookieHeader = response.cookies.get(XERO_OAUTH_STATE_COOKIE)
    expect(setCookieHeader?.value).toBe(state)
    expect(setCookieHeader?.httpOnly).toBe(true)
    expect(setCookieHeader?.sameSite).toBe('lax')
    expect(setCookieHeader?.path).toBe('/api/xero/callback')

    const request = new NextRequest('http://localhost/api/xero/callback', {
      headers: { cookie: `${XERO_OAUTH_STATE_COOKIE}=${state}` }
    })
    expect(readXeroOAuthStateCookie(request)).toBe(state)
  })

  it('returns undefined when no cookie is present', () => {
    const request = new NextRequest('http://localhost/api/xero/callback')
    expect(readXeroOAuthStateCookie(request)).toBeUndefined()
  })
})

describe('clearXeroOAuthStateCookie', () => {
  it('sets an expired cookie', () => {
    const response = NextResponse.redirect('http://localhost/admin/accounting/xero')
    clearXeroOAuthStateCookie(response)

    const cookie = response.cookies.get(XERO_OAUTH_STATE_COOKIE)
    expect(cookie?.value).toBe('')
    expect(cookie?.maxAge).toBe(0)
  })
})
