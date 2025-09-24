// Jest setup file for testing configuration

// Mock environment variables
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.STRIPE_SECRET_KEY = 'sk_test_123'
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'
process.env.STRIPE_API_VERSION = '2023-10-16'

// Mock Next.js modules that might cause issues
jest.mock('next/server', () => ({
  NextRequest: class MockNextRequest {
    constructor(url, options = {}) {
      this.url = url
      this.method = options.method || 'GET'
      this.headers = new Map()
      this._body = options.body
    }
    
    async json() {
      return JSON.parse(this._body || '{}')
    }
  },
  NextResponse: {
    json: (data, options = {}) => ({
      json: () => Promise.resolve(data),
      status: options.status || 200,
    }),
  },
}))

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}