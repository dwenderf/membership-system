/**
 * Unit coverage for runAfterResponse (#395 / #368 pattern).
 */

const mockAfter = jest.fn((fn: () => void | Promise<void>) => {
  // Simulate Next.js registering the callback; run it immediately in tests.
  return Promise.resolve(fn())
})

jest.mock('next/server', () => ({
  after: (fn: () => void | Promise<void>) => mockAfter(fn),
}))

const mockLogSystem = jest.fn()
jest.mock('@/lib/logging/logger', () => ({
  logger: {
    logSystem: (...args: unknown[]) => mockLogSystem(...args),
  },
}))

import { runAfterResponse } from '@/lib/run-after-response'

describe('runAfterResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('schedules work through next/server after()', async () => {
    const work = jest.fn().mockResolvedValue(undefined)

    runAfterResponse('test-op', work, { foo: 'bar' })

    expect(mockAfter).toHaveBeenCalledTimes(1)
    // Let the scheduled promise settle
    await Promise.resolve()
    await Promise.resolve()
    expect(work).toHaveBeenCalledTimes(1)
    expect(mockLogSystem).not.toHaveBeenCalled()
  })

  it('catches and logs errors from deferred work instead of rejecting', async () => {
    const boom = new Error('deferred boom')
    const work = jest.fn().mockRejectedValue(boom)

    runAfterResponse('test-op-fail', work, { id: '1' })

    // Drain the after() callback + its internal try/catch
    await new Promise((r) => setImmediate(r))

    expect(mockLogSystem).toHaveBeenCalledWith(
      'test-op-fail',
      expect.stringContaining('Deferred post-response work failed'),
      expect.objectContaining({ id: '1', error: 'deferred boom' }),
      'error',
      boom
    )
  })

  it('falls back to running work inline when after() throws (no request scope)', async () => {
    mockAfter.mockImplementationOnce(() => {
      throw new Error('outside request scope')
    })
    const work = jest.fn().mockResolvedValue(undefined)

    runAfterResponse('test-op-fallback', work)
    await new Promise((r) => setImmediate(r))

    expect(work).toHaveBeenCalledTimes(1)
  })
})
