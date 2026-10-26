/** #452: the account page's payoff submit - one POST in flight, refetch afterwards. */
import { submitEarlyPayoff } from '@/lib/payment-plans/early-payoff-client'

const okResponse = (body: unknown, ok = true) => ({ ok, json: async () => body }) as unknown as Response

describe('submitEarlyPayoff', () => {
  it('sends one request for a double click and refetches after success', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    const fetchImpl = jest.fn(() => new Promise<Response>(r => { resolveFetch = r }))
    const refetch = jest.fn(async () => {})
    const inFlight = { current: false }

    const first = submitEarlyPayoff({ planId: 'inv-1', inFlight, refetch, fetchImpl: fetchImpl as unknown as typeof fetch })
    const second = await submitEarlyPayoff({ planId: 'inv-1', inFlight, refetch, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(second).toEqual({ status: 'skipped' })

    resolveFetch(okResponse({ success: true }))
    expect(await first).toEqual({ status: 'success' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ planId: 'inv-1' })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(inFlight.current).toBe(false)
  })

  it('refetches after a failure too and returns the server message', async () => {
    const refetch = jest.fn()
    const result = await submitEarlyPayoff({
      planId: 'inv-1',
      inFlight: { current: false },
      refetch,
      fetchImpl: (async () => okResponse({ error: 'Payment failed: requires_action' }, false)) as unknown as typeof fetch
    })
    expect(result).toEqual({ status: 'error', message: 'Payment failed: requires_action' })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('releases the guard after a network error', async () => {
    const inFlight = { current: false }
    const result = await submitEarlyPayoff({
      planId: 'inv-1', inFlight, refetch: jest.fn(),
      fetchImpl: (async () => { throw new Error('offline') }) as unknown as typeof fetch
    })
    expect(result.status).toBe('error')
    expect(inFlight.current).toBe(false)
  })
})
