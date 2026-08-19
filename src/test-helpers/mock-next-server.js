// Shared next/server mock for tests that need real cookie/redirect/header
// behavior beyond what the global jest.setup.js stub provides (json() + status
// only). Used via jest.mock('next/server', () => require('...mock-next-server'))
// in individual test files — this does not replace the global mock everywhere,
// only in files that opt in.

function parseCookies(headerValue) {
  const cookies = new Map()
  if (!headerValue) return cookies
  for (const part of headerValue.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (!name) continue
    cookies.set(name, rest.join('='))
  }
  return cookies
}

class MockHeaders {
  constructor(init = {}) {
    this._map = new Map()
    for (const [key, value] of Object.entries(init)) {
      this._map.set(key.toLowerCase(), value)
    }
  }
  get(name) {
    return this._map.get(name.toLowerCase()) ?? null
  }
  set(name, value) {
    this._map.set(name.toLowerCase(), value)
  }
}

class MockCookieJar {
  constructor(initial = new Map()) {
    this._map = initial
  }
  get(name) {
    const value = this._map.get(name)
    if (value === undefined) return undefined
    return typeof value === 'string' ? { name, value } : value
  }
  set(name, value, options = {}) {
    this._map.set(name, { name, value, ...options })
  }
}

class MockNextRequest {
  constructor(url, options = {}) {
    this.url = url
    this.method = options.method || 'GET'
    this.headers = new MockHeaders(options.headers || {})
    this._body = options.body
    this.cookies = new MockCookieJar(parseCookies(this.headers.get('cookie')))
  }

  async json() {
    return JSON.parse(this._body || '{}')
  }
}

function makeResponse(status, headerInit = {}) {
  return {
    status,
    headers: new MockHeaders(headerInit),
    cookies: new MockCookieJar(),
  }
}

const NextResponse = {
  json: (data, options = {}) => {
    const response = makeResponse(options.status || 200)
    response.json = () => Promise.resolve(data)
    return response
  },
  redirect: (url, options = {}) => {
    const status = (options && options.status) || 307
    return makeResponse(status, { location: String(url) })
  },
}

module.exports = { NextRequest: MockNextRequest, NextResponse }
